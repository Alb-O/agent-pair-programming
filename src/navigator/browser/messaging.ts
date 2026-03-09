import type { BrowserPage } from "./composer";
import { cleanResponseText, getAssistantResponseText } from "./response";

/**
 * Messaging helpers for polling generation state and extracting chat history.
 */
export type HistoryMessage = {
	index: number;
	role: string;
	text: string;
};

export type WaitForAssistantResponseOptions = {
	timeoutMs?: number;
	pollMs?: number;
};

export type WaitForAssistantResponseOrLatestOptions =
	WaitForAssistantResponseOptions & {
		startGraceMs?: number;
	};

export type AssistantCursor = {
	assistantCount: number;
	lastAssistantMessageId: string | null;
	lastMessageRole: string | null;
	lastAssistantText: string;
};

type AssistantTail = {
	assistantCount: number;
	lastAssistantMessageId: string | null;
	lastMessageRole: string | null;
	lastAssistantTextRaw: string;
};

type HistoryDomMessage = {
	index: number;
	role: string;
	text: string;
	messageId: string | null;
	markdownViaReact: string | null;
};

const sleep = async (ms: number): Promise<void> =>
	new Promise((resolve) => {
		setTimeout(resolve, ms);
	});

const pollDelayMs = (pollMs: number): number => Math.max(100, Math.min(250, pollMs));

const readAssistantTail = async (page: BrowserPage): Promise<AssistantTail> =>
	page.evaluate(() => {
		const browserGlobal = globalThis as unknown as {
			document: {
				querySelectorAll: (selector: string) => ArrayLike<{
					dataset?: {
						messageAuthorRole?: string;
						messageId?: string;
					};
					innerText?: string;
				}>;
			};
		};

		const allMessages = Array.from(
			browserGlobal.document.querySelectorAll("[data-message-author-role]"),
		) as Array<{
			dataset?: {
				messageAuthorRole?: string;
			};
		}>;
		const assistants = Array.from(
			browserGlobal.document.querySelectorAll(
				"[data-message-author-role='assistant']",
			),
		) as Array<{
			dataset?: {
				messageId?: string;
			};
			innerText?: string;
		}>;
		const lastMessage = allMessages[allMessages.length - 1];
		const lastAssistant = assistants[assistants.length - 1];
		return {
			assistantCount: assistants.length,
			lastAssistantMessageId: lastAssistant?.dataset?.messageId ?? null,
			lastAssistantTextRaw: lastAssistant?.innerText ?? "",
			lastMessageRole: lastMessage?.dataset?.messageAuthorRole ?? null,
		};
	});

const cursorAdvanced = (
	tail: Pick<AssistantTail, "assistantCount" | "lastAssistantMessageId">,
	baseline: AssistantCursor,
): boolean =>
	tail.assistantCount > baseline.assistantCount ||
	(tail.lastAssistantMessageId !== null &&
		tail.lastAssistantMessageId !== baseline.lastAssistantMessageId);

const cleanedAssistantText = (tail: AssistantTail): string =>
	cleanResponseText(tail.lastAssistantTextRaw);

const assistantTextChanged = (
	tail: AssistantTail,
	baseline: AssistantCursor,
): boolean => {
	const cleaned = cleanedAssistantText(tail);
	return cleaned !== "" && cleaned !== baseline.lastAssistantText;
};

const outputAdvanced = (
	tail: AssistantTail,
	baseline: AssistantCursor,
): boolean =>
	(cursorAdvanced(tail, baseline) && cleanedAssistantText(tail) !== "") ||
	assistantTextChanged(tail, baseline);

export const assistantMessageCount = async (
	page: BrowserPage,
): Promise<number> => (await readAssistantTail(page)).assistantCount;

export const readAssistantCursor = async (
	page: BrowserPage,
): Promise<AssistantCursor> => {
	const tail = await readAssistantTail(page);
	return {
		assistantCount: tail.assistantCount,
		lastAssistantMessageId: tail.lastAssistantMessageId,
		lastMessageRole: tail.lastMessageRole,
		lastAssistantText: cleanedAssistantText(tail),
	};
};

/**
 * Detects active assistant generation from resilient UI signals only.
 * Filters out inactive stop controls (disabled/hidden) to avoid stale "in progress" reads.
 */
export const isGenerating = async (page: BrowserPage): Promise<boolean> =>
	page.evaluate(() => {
		const browserGlobal = globalThis as unknown as {
			document: {
				querySelector: (selector: string) => unknown;
				querySelectorAll: (selector: string) => ArrayLike<{
					textContent?: string;
					dataset?: { testid?: string };
					disabled?: boolean;
					getAttribute?: (name: string) => string | null;
				}>;
			};
		};

		if (browserGlobal.document.querySelector(".result-thinking") !== null) {
			return true;
		}

		const allButtons = Array.from(
			browserGlobal.document.querySelectorAll("button"),
		) as Array<{
			textContent?: string;
			dataset?: { testid?: string };
			disabled?: boolean;
			getAttribute?: (name: string) => string | null;
		}>;
		for (const button of allButtons) {
			if (button.disabled === true) {
				continue;
			}
			const ariaHidden = (button.getAttribute?.("aria-hidden") || "")
				.trim()
				.toLowerCase();
			if (ariaHidden === "true") {
				continue;
			}
			const aria = (button.getAttribute?.("aria-label") || "")
				.trim()
				.toLowerCase();
			const text = (button.textContent || "").trim().toLowerCase();
			const testId = (button.dataset?.testid || "").trim().toLowerCase();
			if (
				aria === "stop streaming" ||
				aria === "stop generating" ||
				aria === "stop generating response" ||
				text === "stop streaming" ||
				text === "stop generating" ||
				text === "stop generating response" ||
				testId === "stop-button" ||
				testId === "composer-stop-button"
			) {
				return true;
			}
		}

		const spansAndButtons = Array.from(
			browserGlobal.document.querySelectorAll("span, button"),
		) as Array<{ textContent?: string }>;
		if (
			spansAndButtons.some(
				(element) => (element.textContent || "").trim() === "Answer now",
			)
		) {
			return true;
		}

		return false;
	});

export const waitForAssistantResponse = async (
	page: BrowserPage,
	{ timeoutMs, pollMs = 300 }: WaitForAssistantResponseOptions = {},
) => {
	const baseline = await readAssistantCursor(page);
	return waitForAssistantResponseAfterCursor(page, baseline, {
		timeoutMs,
		pollMs,
	});
};

const DEFAULT_WAIT_START_GRACE_MS = 2_500;
const DEFAULT_WAIT_START_TIMEOUT_MS = 60_000;
const ASSISTANT_TEXT_STABLE_MS = 350;

const waitForAdvancedAssistantText = async ({
	page,
	baseline,
	deadlineMs,
	pollMs,
}: {
	page: BrowserPage;
	baseline: AssistantCursor;
	deadlineMs?: number;
	pollMs: number;
}): Promise<void> => {
	while (true) {
		const tail = await readAssistantTail(page);
		if (outputAdvanced(tail, baseline)) {
			return;
		}
		if (deadlineMs !== undefined && Date.now() > deadlineMs) {
			throw new Error("streaming timeout");
		}
		await sleep(pollDelayMs(pollMs));
	}
};

const waitForStableAdvancedAssistantText = async ({
	page,
	baseline,
	deadlineMs,
	pollMs,
}: {
	page: BrowserPage;
	baseline: AssistantCursor;
	deadlineMs?: number;
	pollMs: number;
}): Promise<void> => {
	let stableAt: number | null = null;
	let stableMessageId: string | null = null;
	let stableText = "";

	while (true) {
		const tail = await readAssistantTail(page);
		if (outputAdvanced(tail, baseline)) {
			const cleaned = cleanedAssistantText(tail);
			if (
				stableAt !== null &&
				stableMessageId === tail.lastAssistantMessageId &&
				stableText === cleaned
			) {
				if (Date.now() - stableAt >= ASSISTANT_TEXT_STABLE_MS) {
					return;
				}
			} else {
				stableAt = Date.now();
				stableMessageId = tail.lastAssistantMessageId;
				stableText = cleaned;
			}
		} else {
			stableAt = null;
			stableMessageId = null;
			stableText = "";
		}
		if (deadlineMs !== undefined && Date.now() > deadlineMs) {
			throw new Error("streaming timeout");
		}
		await sleep(pollDelayMs(pollMs));
	}
};

/**
 * Waits for assistant output newer than the provided cursor.
 * Handles both normal stream completion and stuck-generating UI states by
 * returning advanced assistant text if stream-complete signal never arrives.
 */
export const waitForAssistantResponseAfterCursor = async (
	page: BrowserPage,
	baseline: AssistantCursor,
	{ timeoutMs, pollMs = 300 }: WaitForAssistantResponseOptions = {},
) => {
	const startedAt = Date.now();
	const overallDeadlineMs =
		timeoutMs !== undefined ? startedAt + timeoutMs : undefined;
	const startDeadlineMs =
		overallDeadlineMs ?? startedAt + DEFAULT_WAIT_START_TIMEOUT_MS;
	let sawGenerating = false;
	let startObserved = false;

	while (!startObserved) {
		const generating = await isGenerating(page);
		const tail = await readAssistantTail(page);
		if (generating || outputAdvanced(tail, baseline)) {
			startObserved = true;
			sawGenerating = generating;
			break;
		}
		if (Date.now() > startDeadlineMs) {
			if (timeoutMs !== undefined) {
				throw new Error("streaming timeout");
			}
			throw new Error("streaming never started");
		}
		await sleep(pollDelayMs(pollMs));
	}

	// Once streaming is observed, default behavior is to wait until completion.
	// A render deadline applies only when caller explicitly supplies timeoutMs.
	const renderDeadlineMs = overallDeadlineMs;
	let timeoutFallback:
		| Awaited<ReturnType<typeof getAssistantResponseText>>
		| null = null;
	const captureTimeoutFallback = async (): Promise<boolean> => {
		const tail = await readAssistantTail(page);
		if (!outputAdvanced(tail, baseline)) {
			return false;
		}
		timeoutFallback = await getAssistantResponseText(page);
		return true;
	};
	const waitForGeneratingCompletion = async (): Promise<void> => {
		while (true) {
			if (!(await isGenerating(page))) {
				return;
			}
			if (renderDeadlineMs !== undefined && Date.now() > renderDeadlineMs) {
				if (await captureTimeoutFallback()) {
					return;
				}
				throw new Error("streaming timeout");
			}
			await sleep(pollDelayMs(pollMs));
		}
	};

	if (sawGenerating) {
		await waitForGeneratingCompletion();
		if (timeoutFallback !== null) {
			return timeoutFallback;
		}
		const tail = await readAssistantTail(page);
		if (cleanedAssistantText(tail) === "") {
			await waitForAdvancedAssistantText({
				page,
				baseline,
				deadlineMs: renderDeadlineMs,
				pollMs,
			});
		}
		return getAssistantResponseText(page);
	}

	while (true) {
		if (await isGenerating(page)) {
			sawGenerating = true;
			break;
		}
		const tail = await readAssistantTail(page);
		if (outputAdvanced(tail, baseline)) {
			break;
		}
		if (renderDeadlineMs !== undefined && Date.now() > renderDeadlineMs) {
			throw new Error("streaming timeout");
		}
		await sleep(pollDelayMs(pollMs));
	}

	if (sawGenerating) {
		await waitForGeneratingCompletion();
		if (timeoutFallback !== null) {
			return timeoutFallback;
		}
		const tail = await readAssistantTail(page);
		if (cleanedAssistantText(tail) === "") {
			await waitForAdvancedAssistantText({
				page,
				baseline,
				deadlineMs: renderDeadlineMs,
				pollMs,
			});
		}
		return getAssistantResponseText(page);
	}

	await waitForStableAdvancedAssistantText({
		page,
		baseline,
		deadlineMs: renderDeadlineMs,
		pollMs,
	});
	return getAssistantResponseText(page);
};

/**
 * Waits for an in-flight response when generation starts shortly after invocation.
 * Falls back to latest available assistant response if no new generation starts.
 */
export const waitForAssistantResponseOrLatest = async (
	page: BrowserPage,
	{
		timeoutMs,
		pollMs = 300,
		startGraceMs = DEFAULT_WAIT_START_GRACE_MS,
	}: WaitForAssistantResponseOrLatestOptions = {},
) => {
	if (await isGenerating(page)) {
		return waitForAssistantResponse(page, {
			timeoutMs,
			pollMs,
		});
	}

	const baseline = await readAssistantCursor(page);
	if (
		baseline.lastMessageRole === "user" ||
		(baseline.lastMessageRole === "assistant" &&
			baseline.assistantCount > 0 &&
			baseline.lastAssistantText === "")
	) {
		return waitForAssistantResponseAfterCursor(page, baseline, {
			timeoutMs,
			pollMs,
		});
	}

	const startedAt = Date.now();
	const graceBudgetMs =
		timeoutMs === undefined ? startGraceMs : Math.min(timeoutMs, startGraceMs);

	while (Date.now() - startedAt <= graceBudgetMs) {
		if (await isGenerating(page)) {
			return waitForAssistantResponseAfterCursor(page, baseline, {
				timeoutMs,
				pollMs,
			});
		}
		if (cursorAdvanced(await readAssistantTail(page), baseline)) {
			return waitForAssistantResponseAfterCursor(page, baseline, {
				timeoutMs,
				pollMs,
			});
		}
		await sleep(pollDelayMs(pollMs));
	}

	return getAssistantResponseText(page);
};

const getConversationTextByMessageId = async (
	page: BrowserPage,
): Promise<Record<string, string> | null> =>
	page.evaluate(() => {
		const browserGlobal = globalThis as unknown as {
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

		const resolveText = (parts: unknown[]): string | null => {
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
					if (
						typeof candidate.value === "string" &&
						candidate.value.length > 0
					) {
						return candidate.value;
					}
					return null;
				})
				.filter((value): value is string => value !== null);
			if (objectParts.length > 0) {
				return objectParts.join("\n\n");
			}

			return null;
		};

		const output: Record<string, string> = {};
		for (const entry of Object.values(conversation.mapping || {})) {
			if (typeof entry !== "object" || entry === null) {
				continue;
			}
			const message = (entry as { message?: unknown }).message;
			if (typeof message !== "object" || message === null) {
				continue;
			}

			const id = (message as { id?: unknown }).id;
			if (typeof id !== "string" || id.trim() === "") {
				continue;
			}

			const content = (message as { content?: { parts?: unknown } }).content;
			const parts = Array.isArray(content?.parts) ? content.parts : [];
			const resolved = resolveText(parts);
			if (resolved !== null) {
				output[id] = resolved;
			}
		}

		return output;
	});

const getHistoryDomMessages = async (
	page: BrowserPage,
): Promise<HistoryDomMessage[]> =>
	page.evaluate(() => {
		const browserGlobal = globalThis as unknown as {
			document: {
				querySelectorAll: (selector: string) => ArrayLike<{
					dataset?: { messageAuthorRole?: string; messageId?: string };
					innerText?: string;
				}>;
			};
		};

		const readMarkdownFromReact = (
			messageNode: Record<string, unknown>,
		): string | null => {
			const roots: unknown[] = [];
			const reactPropsKey = Object.keys(messageNode).find((key) =>
				key.startsWith("__reactProps"),
			);
			if (reactPropsKey !== undefined) {
				roots.push(messageNode[reactPropsKey]);
			}

			const reactFiberKey = Object.keys(messageNode).find((key) =>
				key.startsWith("__reactFiber"),
			);
			if (reactFiberKey !== undefined) {
				const fiber = messageNode[reactFiberKey] as
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

			const findPartsText = (root: unknown): string | null => {
				const queue: unknown[] = [root];
				const seen = new WeakSet<object>();

				while (queue.length > 0) {
					const node = queue.shift();
					if (node === null || node === undefined) {
						continue;
					}
					const nodeType = typeof node;
					if (nodeType !== "object" && nodeType !== "function") {
						continue;
					}
					const visitable = node as object;
					if (seen.has(visitable)) {
						continue;
					}
					seen.add(visitable);

					const nodeRecord = node as Record<string, unknown>;

					if (Array.isArray(nodeRecord.parts)) {
						const direct = nodeRecord.parts.find(
							(part) => typeof part === "string" && part.length > 0,
						);
						if (typeof direct === "string") {
							return direct;
						}
					}

					if (Array.isArray(nodeRecord.displayParts)) {
						const display = nodeRecord.displayParts
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
							.find(
								(part): part is string =>
									typeof part === "string" && part.length > 0,
							);
						if (display !== undefined) {
							return display;
						}
					}

					if (Array.isArray(nodeRecord)) {
						for (const child of nodeRecord) {
							queue.push(child);
						}
						continue;
					}

					for (const key of Object.keys(nodeRecord).slice(0, 120)) {
						let child: unknown;
						try {
							child = nodeRecord[key];
						} catch {
							child = null;
						}
						queue.push(child);
					}
				}

				return null;
			};

			for (const root of roots) {
				const text = findPartsText(root);
				if (typeof text === "string" && text.trim() !== "") {
					return text;
				}
			}

			return null;
		};

		const elements = Array.from(
			browserGlobal.document.querySelectorAll("[data-message-author-role]"),
		) as Array<
			Record<string, unknown> & {
				dataset?: { messageAuthorRole?: string; messageId?: string };
				innerText?: string;
			}
		>;

		return elements.map((element, index) => ({
			index,
			role: element.dataset?.messageAuthorRole || "",
			text: element.innerText || "",
			messageId: element.dataset?.messageId ?? null,
			markdownViaReact: readMarkdownFromReact(element),
		}));
	});

export const getConversationHistory = async (
	page: BrowserPage,
	last?: number,
): Promise<HistoryMessage[]> => {
	const [messages, conversationTextById] = await Promise.all([
		getHistoryDomMessages(page),
		getConversationTextByMessageId(page),
	]);

	const bounded =
		typeof last === "number" && Number.isInteger(last) && last > 0
			? messages.slice(-last)
			: messages;

	return bounded.map((message) => {
		const byConversationId =
			message.messageId !== null
				? conversationTextById?.[message.messageId]
				: undefined;
		const text =
			typeof byConversationId === "string" && byConversationId.trim() !== ""
				? byConversationId
				: typeof message.markdownViaReact === "string" &&
						message.markdownViaReact.trim() !== ""
					? message.markdownViaReact
					: cleanResponseText(message.text);

		return {
			index: message.index,
			role: message.role,
			text,
		};
	});
};
