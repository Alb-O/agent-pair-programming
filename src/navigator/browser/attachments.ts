import fs from "node:fs";
import path from "node:path";
import {
	conversationLengthState,
	sendGate,
	type ConversationLengthState,
	type SendGate,
} from "../limits/conversation_limits";
import { insertComposerText, type BrowserPage } from "./composer";
import { conversationCharLength } from "./session";
import { clickSendButton } from "./send";
import {
	waitForAssistantResponse,
	type WaitForAssistantResponseOptions,
} from "./messaging";
import type { AssistantResponse } from "./response";

/**
 * Attachment pipeline for navigator browser sessions.
 * Builds payloads from files/text, dispatches paste/upload, and can optionally send/wait.
 */
export type AttachmentPayload = {
	name: string;
	mime: string;
	base64: string;
	size: number;
};

export type AttachmentMeta = {
	name: string;
	type: string;
	size: number;
};

export type PasteAttachmentsResult = {
	attached: true;
	filenames: string[];
	attachments: AttachmentMeta[];
	size: number;
};

export type AttachNavigatorOptions = WaitForAssistantResponseOptions & {
	selector?: string;
	prompt?: string;
	send?: boolean;
	waitForResponse?: boolean;
};

export type AttachNavigatorResult = PasteAttachmentsResult & {
	sent: boolean;
	blocked: boolean;
	mustStartNew: boolean;
	reason: "conversation_cap_reached" | null;
	limitState: ConversationLengthState;
	gate: SendGate;
	response?: AssistantResponse;
};

type WaitablePage = BrowserPage & {
	waitForTimeout: (timeout: number) => Promise<void>;
};

const DEFAULT_SELECTOR = "#prompt-textarea";

const MIME_MAP: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	svg: "image/svg+xml",
	bmp: "image/bmp",
	ico: "image/x-icon",
	avif: "image/avif",
	heic: "image/heic",
	heif: "image/heif",
	txt: "text/plain",
	md: "text/markdown",
	json: "application/json",
	csv: "text/csv",
	pdf: "application/pdf",
};

const sleep = async (page: WaitablePage, timeout: number): Promise<void> =>
	page.waitForTimeout(timeout);

const toBase64 = (bytes: Buffer): string => bytes.toString("base64");

export const attachmentMime = (name: string, fallback: string): string => {
	const parsed = path.parse(name);
	const extension = parsed.ext.replace(".", "").toLowerCase();
	if (extension === "") {
		return fallback;
	}
	return MIME_MAP[extension] ?? fallback;
};

export const binaryAttachment = (
	name: string,
	bytes: Buffer,
	fallbackMime: string,
): AttachmentPayload => ({
	name,
	mime: attachmentMime(name, fallbackMime),
	base64: toBase64(bytes),
	size: bytes.length,
});

export const fileAttachment = (filePath: string): AttachmentPayload => {
	const bytes = fs.readFileSync(filePath);
	return binaryAttachment(
		path.basename(filePath),
		bytes,
		"application/octet-stream",
	);
};

export const textAttachment = (
	text: string,
	name: string = "document.txt",
): AttachmentPayload =>
	binaryAttachment(name, Buffer.from(text, "utf8"), "text/plain");

export const collectAttachments = (
	filePaths: readonly string[],
	pipelineText?: string,
	pipelineName?: string,
): AttachmentPayload[] => {
	const attachments: AttachmentPayload[] = [];

	for (const filePath of filePaths) {
		attachments.push(fileAttachment(filePath));
	}

	if (pipelineText !== undefined && pipelineText !== "") {
		attachments.push(
			textAttachment(pipelineText, pipelineName ?? "document.txt"),
		);
	}

	if (attachments.length === 0) {
		throw new Error(
			"navigator attach requires files (--files) or text input (--text/--text-file)",
		);
	}
	if (attachments.length > 10) {
		throw new Error("Maximum 10 attachments allowed per command");
	}

	return attachments;
};

export const pasteAttachments = async (
	page: BrowserPage,
	attachments: readonly AttachmentPayload[],
	selector: string = DEFAULT_SELECTOR,
): Promise<PasteAttachmentsResult> => {
	const result = await page.evaluate(
		({ payload, inputSelector }) => {
			const browserGlobal = globalThis as unknown as {
				document: {
					querySelector: (selector: string) => {
						focus: () => void;
						dispatchEvent: (event: unknown) => void;
					} | null;
				};
				DataTransfer: {
					new (): {
						items: {
							add: (file: unknown) => void;
						};
					};
				};
				File: {
					new (
						fileBits: Array<Uint8Array>,
						fileName: string,
						options: { type: string },
					): {
						name: string;
						size: number;
						type: string;
					};
				};
				ClipboardEvent: {
					new (
						type: string,
						options: {
							bubbles: boolean;
							cancelable: boolean;
							clipboardData: unknown;
						},
					): unknown;
				};
				atob: (value: string) => string;
			};

			const composer = browserGlobal.document.querySelector(inputSelector);
			if (composer === null) {
				return { error: "composer not found" };
			}

			composer.focus();

			const decodeBase64 = (value: string): Uint8Array => {
				const raw = browserGlobal.atob(value);
				const out = new Uint8Array(raw.length);
				for (let index = 0; index < raw.length; index += 1) {
					out[index] = raw.charCodeAt(index);
				}
				return out;
			};

			const filenames: string[] = [];
			const metas: Array<{ name: string; type: string; size: number }> = [];
			let totalSize = 0;

			for (const item of payload) {
				const transfer = new browserGlobal.DataTransfer();
				const bytes = decodeBase64(item.base64);
				const mime = item.mime || "application/octet-stream";
				const file = new browserGlobal.File([bytes], item.name, { type: mime });
				transfer.items.add(file);
				const event = new browserGlobal.ClipboardEvent("paste", {
					bubbles: true,
					cancelable: true,
					clipboardData: transfer,
				});
				composer.dispatchEvent(event);
				filenames.push(file.name);
				metas.push({
					name: file.name,
					type: file.type || mime,
					size: file.size,
				});
				totalSize += file.size;
			}

			return {
				attached: true,
				filenames,
				attachments: metas,
				size: totalSize,
			};
		},
		{
			payload: attachments,
			inputSelector: selector,
		},
	);

	if (
		typeof result === "object" &&
		result !== null &&
		"error" in result &&
		typeof result.error === "string"
	) {
		throw new Error(result.error);
	}

	return result as PasteAttachmentsResult;
};

const sendButtonEnabled = async (page: BrowserPage): Promise<boolean> => {
	const result = await page.evaluate(() => {
		const browserGlobal = globalThis as unknown as {
			document: {
				querySelector: (selector: string) => { disabled?: boolean } | null;
			};
		};
		const button = browserGlobal.document.querySelector(
			'[data-testid="send-button"]',
		);
		if (button === null) {
			return false;
		}
		return button.disabled !== true;
	});
	return result === true;
};

const readGateState = async (page: BrowserPage) => {
	const chars = await conversationCharLength(page);
	const state = conversationLengthState(chars);
	return {
		state,
		gate: sendGate(state),
	};
};

export const attachToNavigator = async (
	page: BrowserPage,
	attachments: readonly AttachmentPayload[],
	{
		selector = DEFAULT_SELECTOR,
		prompt,
		send = false,
		waitForResponse = false,
		timeoutMs,
		pollMs,
	}: AttachNavigatorOptions = {},
): Promise<AttachNavigatorResult> => {
	const pasted = await pasteAttachments(page, attachments, selector);
	const gateState = await readGateState(page);

	if (prompt !== undefined && prompt !== "") {
		await insertComposerText(page, prompt);
	}

	if (!send) {
		return {
			...pasted,
			sent: false,
			blocked: false,
			mustStartNew: false,
			reason: null,
			limitState: gateState.state,
			gate: gateState.gate,
		};
	}

	if (!gateState.gate.allowed) {
		return {
			...pasted,
			sent: false,
			blocked: true,
			mustStartNew: true,
			reason: "conversation_cap_reached",
			limitState: gateState.state,
			gate: gateState.gate,
		};
	}

	const maybeWaitable = page as Partial<WaitablePage>;
	if (typeof maybeWaitable.waitForTimeout !== "function") {
		throw new Error(
			"attachToNavigator requires a Playwright page with waitForTimeout support when send=true",
		);
	}

	let ready = false;
	for (let index = 0; index < 60; index += 1) {
		if (await sendButtonEnabled(page)) {
			ready = true;
			break;
		}
		await sleep(maybeWaitable as WaitablePage, 500);
	}
	if (!ready) {
		throw new Error("send button did not enable (attachment still uploading?)");
	}

	await clickSendButton(page);

	const out: AttachNavigatorResult = {
		...pasted,
		sent: true,
		blocked: false,
		mustStartNew: false,
		reason: null,
		limitState: gateState.state,
		gate: gateState.gate,
	};

	if (waitForResponse) {
		out.response = await waitForAssistantResponse(page, { timeoutMs, pollMs });
	}

	return out;
};
