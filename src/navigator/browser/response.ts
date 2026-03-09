import type { BrowserPage } from "./composer";

/**
 * Assistant response extraction chain.
 * Uses conversation API when available, then React internals, then rendered text.
 */
export type AssistantResponseSource = "conversation" | "react" | "rendered";

export type AssistantResponse = {
	text: string;
	source: AssistantResponseSource;
};

export const cleanResponseText = (text: string): string =>
	text
		.split(/\r?\n/)
		.map((line) => line.trimEnd())
		.filter((line) => line.trim() !== "")
		.join("\n");

export const getLastAssistantRenderedText = async (
	page: BrowserPage,
): Promise<string> => {
	const renderedMessages = await page.evaluate(() => {
		const browserGlobal = globalThis as unknown as {
			document: {
				querySelectorAll: (
					selector: string,
				) => ArrayLike<{ innerText?: string }>;
			};
		};
		const messages = Array.from(
			browserGlobal.document.querySelectorAll(
				"[data-message-author-role='assistant']",
			),
		) as Array<{ innerText?: string }>;
		if (messages.length === 0) {
			return [] as string[];
		}
		return messages.map((message) => message.innerText || "");
	});

	for (let index = renderedMessages.length - 1; index >= 0; index -= 1) {
		const cleaned = cleanResponseText(renderedMessages[index] ?? "");
		if (cleaned !== "") {
			return cleaned;
		}
	}

	return "";
};

export const getLastAssistantMarkdownViaReact = async (
	page: BrowserPage,
): Promise<string | null> => {
	const result = await page.evaluate(() => {
		const browserGlobal = globalThis as unknown as {
			document: {
				querySelectorAll: (
					selector: string,
				) => ArrayLike<Record<string, unknown>>;
			};
		};
		const messages = Array.from(
			browserGlobal.document.querySelectorAll(
				"[data-message-author-role='assistant']",
			),
		) as Record<string, unknown>[];
		if (messages.length === 0) {
			return null;
		}

		const last = messages[messages.length - 1];
		const roots: unknown[] = [];

		const reactPropsKey = Object.keys(last).find((key) =>
			key.startsWith("__reactProps"),
		);
		if (reactPropsKey !== undefined) {
			roots.push(last[reactPropsKey]);
		}

		const reactFiberKey = Object.keys(last).find((key) =>
			key.startsWith("__reactFiber"),
		);
		if (reactFiberKey !== undefined) {
			const fiber = last[reactFiberKey] as
				| { memoizedProps?: unknown; pendingProps?: unknown }
				| undefined;
			if (fiber?.memoizedProps !== undefined) {
				roots.push(fiber.memoizedProps);
			}
			if (fiber?.pendingProps !== undefined) {
				roots.push(fiber.pendingProps);
			}
		}

		if (roots.length === 0) {
			return null;
		}

		const queue: unknown[] = [...roots];
		const seen = new WeakSet<object>();

		while (queue.length > 0) {
			const node = queue.shift();
			if (node === null || node === undefined) {
				continue;
			}
			if (typeof node !== "object") {
				continue;
			}
			if (seen.has(node)) {
				continue;
			}
			seen.add(node);

			const nodeRecord = node as Record<string, unknown>;
			const parts = nodeRecord.parts;
			if (Array.isArray(parts)) {
				const direct = parts.find(
					(part) => typeof part === "string" && part.length > 0,
				);
				if (typeof direct === "string") {
					return direct;
				}
			}

			const displayParts = nodeRecord.displayParts;
			if (Array.isArray(displayParts)) {
				const rendered = displayParts
					.map((part) => {
						if (typeof part === "string" && part.length > 0) {
							return part;
						}
						if (
							typeof part === "object" &&
							part !== null &&
							typeof (part as { text?: unknown }).text === "string"
						) {
							return (part as { text: string }).text;
						}
						return null;
					})
					.find((part) => typeof part === "string" && part.length > 0);
				if (typeof rendered === "string") {
					return rendered;
				}
			}

			if (Array.isArray(node)) {
				for (const child of node) {
					queue.push(child);
				}
				continue;
			}

			for (const key of Object.keys(nodeRecord).slice(0, 120)) {
				queue.push(nodeRecord[key]);
			}
		}

		return null;
	});

	if (result === null || result.trim() === "") {
		return null;
	}
	return result;
};

export const getLastAssistantMarkdownViaConversationApi = async (
	page: BrowserPage,
): Promise<string | null> => {
	const result = await page.evaluate(() => {
		const browserGlobal = globalThis as unknown as {
			document: {
				querySelectorAll: (selector: string) => ArrayLike<{
					dataset?: { messageId?: string };
				}>;
			};
			location: { pathname: string };
			XMLHttpRequest: {
				new (): {
					status: number;
					responseText: string;
					withCredentials: boolean;
					open: (method: string, url: string, async?: boolean) => void;
					setRequestHeader: (name: string, value: string) => void;
					send: () => void;
				};
			};
		};

		const messages = Array.from(
			browserGlobal.document.querySelectorAll(
				"[data-message-author-role='assistant']",
			),
		) as Array<{ dataset?: { messageId?: string } }>;
		if (messages.length === 0) {
			return null;
		}

		const lastVisibleId =
			messages[messages.length - 1].dataset?.messageId ?? null;
		const convMatch =
			browserGlobal.location.pathname.match(/\/c\/([a-f0-9-]+)/);
		const conversationId = convMatch?.[1] ?? null;
		if (conversationId === null) {
			return null;
		}

		const sessionRequest = new browserGlobal.XMLHttpRequest();
		sessionRequest.open("GET", "/api/auth/session", false);
		sessionRequest.withCredentials = true;
		sessionRequest.send();
		if (sessionRequest.status !== 200) {
			return null;
		}

		let token: string | null = null;
		try {
			const session = JSON.parse(sessionRequest.responseText || "{}");
			token = session.accessToken || null;
		} catch {
			return null;
		}
		if (token === null || token === "") {
			return null;
		}

		const conversationRequest = new browserGlobal.XMLHttpRequest();
		conversationRequest.open(
			"GET",
			`/backend-api/conversation/${conversationId}`,
			false,
		);
		conversationRequest.setRequestHeader("Authorization", `Bearer ${token}`);
		conversationRequest.withCredentials = true;
		conversationRequest.send();
		if (conversationRequest.status !== 200) {
			return null;
		}

		let conversation: { mapping?: Record<string, unknown> };
		try {
			conversation = JSON.parse(conversationRequest.responseText || "{}");
		} catch {
			return null;
		}

		const mappingEntries = Object.values(conversation.mapping || {});
		const assistantMessages = mappingEntries
			.map((entry) =>
				typeof entry === "object" && entry !== null
					? (entry as { message?: unknown }).message
					: null,
			)
			.filter((message): message is Record<string, unknown> => {
				if (typeof message !== "object" || message === null) {
					return false;
				}
				const role =
					(message as { author?: { role?: string } }).author?.role ?? "";
				return role === "assistant";
			});
		if (assistantMessages.length === 0) {
			return null;
		}

		let target = assistantMessages[assistantMessages.length - 1];
		if (lastVisibleId !== null) {
			const matching = assistantMessages.find(
				(message) => (message as { id?: unknown }).id === lastVisibleId,
			);
			if (matching !== undefined) {
				target = matching;
			}
		}

		const content = (target as { content?: Record<string, unknown> }).content;
		const parts = Array.isArray(content?.parts) ? content.parts : [];
		const textPart = parts.find(
			(part) => typeof part === "string" && part.length > 0,
		);
		if (typeof textPart === "string") {
			return textPart;
		}

		const objectParts = parts
			.map((part) => {
				if (typeof part !== "object" || part === null) {
					return null;
				}
				const candidate = part as {
					text?: unknown;
					content?: unknown;
					value?: unknown;
				};
				if (typeof candidate.text === "string" && candidate.text.length > 0) {
					return candidate.text;
				}
				if (
					typeof candidate.content === "string" &&
					candidate.content.length > 0
				) {
					return candidate.content;
				}
				if (typeof candidate.value === "string" && candidate.value.length > 0) {
					return candidate.value;
				}
				return null;
			})
			.filter((value): value is string => value !== null);
		if (objectParts.length > 0) {
			return objectParts.join("\n\n");
		}

		return null;
	});

	if (result === null || result.trim() === "") {
		return null;
	}
	return result;
};

export const getAssistantResponseText = async (
	page: BrowserPage,
): Promise<AssistantResponse> => {
	const fromConversation =
		await getLastAssistantMarkdownViaConversationApi(page);
	if (fromConversation !== null) {
		return {
			text: fromConversation,
			source: "conversation",
		};
	}

	const fromReact = await getLastAssistantMarkdownViaReact(page);
	if (fromReact !== null) {
		return {
			text: fromReact,
			source: "react",
		};
	}

	return {
		text: await getLastAssistantRenderedText(page),
		source: "rendered",
	};
};
