import {
	conversationLengthState,
	sendGate,
	type ConversationLengthState,
	type SendGate,
} from "../limits/conversation_limits";
import { insertComposerText, type BrowserPage } from "./composer";
import {
	getCurrentModel,
	getLastDriverMessage,
	conversationCharLength,
} from "./session";
import {
	readAssistantCursor,
	waitForAssistantResponseAfterCursor,
	type WaitForAssistantResponseOptions,
} from "./messaging";
import type { AssistantResponse } from "./response";

/**
 * End-to-end send flow with dedupe checks, limit gating, button dispatch, and optional wait.
 */
type SleepPage = BrowserPage & {
	waitForTimeout: (timeout: number) => Promise<void>;
};

export type SendNavigatorMessageOptions = WaitForAssistantResponseOptions & {
	force?: boolean;
	waitForResponse?: boolean;
	echoMessage?: boolean;
};

export type SendNavigatorMessageResult = {
	success: boolean;
	sent: boolean;
	alreadySent: boolean;
	blocked: boolean;
	mustStartNew: boolean;
	reason: "conversation_cap_reached" | null;
	model: string | null;
	chars: number;
	limitState: ConversationLengthState;
	gate: SendGate;
	message?: string;
	response?: AssistantResponse;
};

type SendButtonResult = {
	sent?: true;
	error?: string;
};

const sleep = async (page: SleepPage, timeout: number): Promise<void> =>
	page.waitForTimeout(timeout);

const clickSendButton = async (page: BrowserPage): Promise<void> => {
	const result = await page.evaluate(() => {
		const browserGlobal = globalThis as unknown as {
			document: {
				querySelector: (selector: string) => {
					disabled?: boolean;
					click: () => void;
				} | null;
			};
		};

		const button = browserGlobal.document.querySelector(
			'[data-testid="send-button"]',
		);
		if (button === null) {
			return { error: "send button not found" };
		}
		if (button.disabled === true) {
			return { error: "send button disabled" };
		}
		button.click();
		return { sent: true };
	});

	const typed = result as SendButtonResult;
	if (typeof typed.error === "string") {
		throw new Error(typed.error);
	}
	if (typed.sent !== true) {
		throw new Error("send button click did not report success");
	}
};

const emptyMessageError =
	"No message provided (use --message, --message-file, or stdin)";

const buildGateState = async (page: BrowserPage) => {
	const chars = await conversationCharLength(page);
	const state = conversationLengthState(chars);
	return {
		state,
		gate: sendGate(state),
	};
};

export const sendNavigatorMessage = async (
	page: BrowserPage,
	message: string,
	{
		force = false,
		waitForResponse = true,
		timeoutMs,
		pollMs,
		echoMessage = false,
	}: SendNavigatorMessageOptions = {},
): Promise<SendNavigatorMessageResult> => {
	if (message.trim() === "") {
		throw new Error(emptyMessageError);
	}

	if (!force) {
		const last = await getLastDriverMessage(page);
		if (last !== null && last.trim() === message.trim()) {
			const gateState = await buildGateState(page);
			const out: SendNavigatorMessageResult = {
				success: true,
				sent: false,
				alreadySent: true,
				blocked: false,
				mustStartNew: false,
				reason: null,
				model: await getCurrentModel(page),
				chars: message.length,
				limitState: gateState.state,
				gate: gateState.gate,
			};
			if (echoMessage) {
				out.message = message;
			}
			return out;
		}
	}

	const gateState = await buildGateState(page);
	if (!gateState.gate.allowed) {
		const out: SendNavigatorMessageResult = {
			success: false,
			sent: false,
			alreadySent: false,
			blocked: true,
			mustStartNew: true,
			reason: "conversation_cap_reached",
			model: await getCurrentModel(page),
			chars: message.length,
			limitState: gateState.state,
			gate: gateState.gate,
		};
		if (echoMessage) {
			out.message = message;
		}
		return out;
	}

	await insertComposerText(page, message, { clear: true });
	const maybeSleepPage = page as Partial<SleepPage>;
	if (typeof maybeSleepPage.waitForTimeout === "function") {
		await sleep(maybeSleepPage as SleepPage, 100);
	}
	const responseBaseline = waitForResponse
		? await readAssistantCursor(page)
		: null;
	await clickSendButton(page);

	const out: SendNavigatorMessageResult = {
		success: true,
		sent: true,
		alreadySent: false,
		blocked: false,
		mustStartNew: false,
		reason: null,
		model: await getCurrentModel(page),
		chars: message.length,
		limitState: gateState.state,
		gate: gateState.gate,
	};
	if (echoMessage) {
		out.message = message;
	}

	if (!waitForResponse) {
		return out;
	}

	out.response = await waitForAssistantResponseAfterCursor(
		page,
		responseBaseline ?? (await readAssistantCursor(page)),
		{
			timeoutMs,
			pollMs,
		},
	);
	return out;
};

export { clickSendButton };
