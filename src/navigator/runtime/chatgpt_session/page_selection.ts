import { parseProjectId, urlInProject } from "../../project/project_ref";
import type { RuntimeContext, RuntimePage } from "./types";

const isNonEmpty = (value?: string): value is string =>
	value !== undefined && value.trim() !== "";

const CHATGPT_HOST_RE = /^(?:www\.)?chatgpt\.com$/i;

const isChatgptHost = (url: string): boolean => {
	try {
		return CHATGPT_HOST_RE.test(new URL(url).hostname);
	} catch {
		return false;
	}
};

type PageCandidate = {
	page: RuntimePage;
	url: string;
	focused: boolean;
	visible: boolean;
	visibilityState: string;
	isChatgpt: boolean;
	isProjectOrConversation: boolean;
	inTargetProject: boolean;
};

type PageAttention = {
	hasFocus: boolean;
	visibilityState: string;
};

const readPageAttention = async (page: RuntimePage): Promise<PageAttention> => {
	try {
		return await page.evaluate(() => {
			const browserGlobal = globalThis as unknown as {
				document: {
					hasFocus?: () => boolean;
					visibilityState?: string;
				};
			};

			const hasFocus =
				typeof browserGlobal.document.hasFocus === "function"
					? browserGlobal.document.hasFocus()
					: false;

			const visibilityState =
				typeof browserGlobal.document.visibilityState === "string"
					? browserGlobal.document.visibilityState
					: "hidden";

			return {
				hasFocus,
				visibilityState,
			};
		});
	} catch {
		return {
			hasFocus: false,
			visibilityState: "hidden",
		};
	}
};

const isProjectOrConversationUrl = (url: string): boolean => {
	const trimmed = url.trim();
	return (
		/^https?:\/\/(?:www\.)?chatgpt\.com\/g\/g-p-[A-Za-z0-9-]+(?:\/(?:project|c\/[A-Za-z0-9-]+))?(?:[/?#].*)?$/.test(
			trimmed,
		) ||
		/^https?:\/\/(?:www\.)?chatgpt\.com\/c\/[A-Za-z0-9-]+(?:[/?#].*)?$/.test(
			trimmed,
		)
	);
};

const parseTargetProjectId = (targetUrl?: string): string | undefined => {
	if (!isNonEmpty(targetUrl)) {
		return undefined;
	}
	try {
		return parseProjectId(targetUrl);
	} catch {
		return undefined;
	}
};

const pickNewest = (
	candidates: readonly PageCandidate[],
): RuntimePage | undefined => {
	if (candidates.length === 0) {
		return undefined;
	}
	return candidates[candidates.length - 1]?.page;
};

const describeCandidate = (candidate: PageCandidate): string => {
	const state = isNonEmpty(candidate.visibilityState)
		? candidate.visibilityState
		: candidate.visible
			? "visible"
			: "hidden";
	const focused = candidate.focused ? ",focused" : "";
	return `${candidate.url} [${state}${focused}]`;
};

export const pickSessionPage = async ({
	context,
	targetUrl,
	strictTabTargeting = false,
}: {
	context: RuntimeContext;
	targetUrl?: string;
	strictTabTargeting?: boolean;
}): Promise<RuntimePage | undefined> => {
	const pages = context.pages();
	if (pages.length === 0) {
		return undefined;
	}

	const targetProjectId = parseTargetProjectId(targetUrl);
	const candidates: PageCandidate[] = [];
	for (const page of pages) {
		const url = page.url();
		const attention = await readPageAttention(page);
		const isChatgpt = isChatgptHost(url);
		const inTargetProject =
			targetProjectId === undefined
				? false
				: urlInProject(url, targetProjectId);
		candidates.push({
			page,
			url,
			focused: attention.hasFocus,
			visible: attention.visibilityState === "visible",
			visibilityState: attention.visibilityState,
			isChatgpt,
			isProjectOrConversation: isProjectOrConversationUrl(url),
			inTargetProject,
		});
	}

	let pool = candidates;
	if (targetProjectId !== undefined) {
		const inTargetProject = candidates.filter(
			(candidate) => candidate.inTargetProject,
		);
		if (inTargetProject.length > 0) {
			pool = inTargetProject;
		}
	}

	if (strictTabTargeting && targetProjectId !== undefined) {
		const matchingTargetProjectTabs = candidates.filter(
			(candidate) =>
				candidate.inTargetProject && candidate.isProjectOrConversation,
		);
		if (
			matchingTargetProjectTabs.length > 0 &&
			matchingTargetProjectTabs.every((candidate) => !candidate.visible)
		) {
			throw new Error(
				`strict tab targeting did not find a visible tab in target project ${targetProjectId}; matching tabs were hidden: ${matchingTargetProjectTabs.map(describeCandidate).join(", ")}`,
			);
		}
	}

	const visibleFocusedProject = pool.filter(
		(candidate) =>
			candidate.visible &&
			candidate.focused &&
			candidate.isProjectOrConversation,
	);
	if (visibleFocusedProject.length > 0) {
		if (strictTabTargeting && visibleFocusedProject.length !== 1) {
			throw new Error(
				`strict tab targeting matched ${visibleFocusedProject.length} visible project/conversation tabs: ${visibleFocusedProject.map(describeCandidate).join(", ")}`,
			);
		}
		return pickNewest(visibleFocusedProject);
	}

	const visibleProject = pool.filter(
		(candidate) => candidate.visible && candidate.isProjectOrConversation,
	);
	if (visibleProject.length > 0) {
		if (strictTabTargeting && visibleProject.length !== 1) {
			throw new Error(
				`strict tab targeting matched ${visibleProject.length} visible project/conversation tabs: ${visibleProject.map(describeCandidate).join(", ")}`,
			);
		}
		return pickNewest(visibleProject);
	}

	const focusedProject = pool.filter(
		(candidate) => candidate.focused && candidate.isProjectOrConversation,
	);
	if (focusedProject.length > 0) {
		if (strictTabTargeting && focusedProject.length !== 1) {
			throw new Error(
				`strict tab targeting matched ${focusedProject.length} focused project/conversation tabs: ${focusedProject.map(describeCandidate).join(", ")}`,
			);
		}
		return pickNewest(focusedProject);
	}

	const visibleFocusedChatgpt = pool.filter(
		(candidate) => candidate.visible && candidate.focused && candidate.isChatgpt,
	);
	if (visibleFocusedChatgpt.length > 0) {
		if (strictTabTargeting && visibleFocusedChatgpt.length !== 1) {
			throw new Error(
				`strict tab targeting matched ${visibleFocusedChatgpt.length} visible ChatGPT tabs: ${visibleFocusedChatgpt.map(describeCandidate).join(", ")}`,
			);
		}
		return pickNewest(visibleFocusedChatgpt);
	}

	const visibleChatgpt = pool.filter(
		(candidate) => candidate.visible && candidate.isChatgpt,
	);
	if (visibleChatgpt.length > 0) {
		if (strictTabTargeting && visibleChatgpt.length !== 1) {
			throw new Error(
				`strict tab targeting matched ${visibleChatgpt.length} visible ChatGPT tabs: ${visibleChatgpt.map(describeCandidate).join(", ")}`,
			);
		}
		return pickNewest(visibleChatgpt);
	}

	const focusedChatgpt = pool.filter(
		(candidate) => candidate.focused && candidate.isChatgpt,
	);
	if (focusedChatgpt.length > 0) {
		if (strictTabTargeting && focusedChatgpt.length !== 1) {
			throw new Error(
				`strict tab targeting matched ${focusedChatgpt.length} focused ChatGPT tabs: ${focusedChatgpt.map(describeCandidate).join(", ")}`,
			);
		}
		return pickNewest(focusedChatgpt);
	}

	const projectPages = pool.filter(
		(candidate) => candidate.isProjectOrConversation,
	);
	if (projectPages.length > 0) {
		if (strictTabTargeting && projectPages.length !== 1) {
			throw new Error(
				`strict tab targeting matched ${projectPages.length} project/conversation tabs: ${projectPages.map(describeCandidate).join(", ")}`,
			);
		}
		return pickNewest(projectPages);
	}

	const chatgptPages = pool.filter((candidate) => candidate.isChatgpt);
	if (chatgptPages.length > 0) {
		if (strictTabTargeting && chatgptPages.length !== 1) {
			throw new Error(
				`strict tab targeting matched ${chatgptPages.length} ChatGPT tabs: ${chatgptPages.map(describeCandidate).join(", ")}`,
			);
		}
		return pickNewest(chatgptPages);
	}

	const visibleFocusedAny = pool.filter(
		(candidate) => candidate.visible && candidate.focused,
	);
	if (visibleFocusedAny.length > 0) {
		if (strictTabTargeting && visibleFocusedAny.length !== 1) {
			throw new Error(
				`strict tab targeting matched ${visibleFocusedAny.length} visible focused tabs: ${visibleFocusedAny.map(describeCandidate).join(", ")}`,
			);
		}
		return pickNewest(visibleFocusedAny);
	}

	const visibleAny = pool.filter((candidate) => candidate.visible);
	if (visibleAny.length > 0) {
		if (strictTabTargeting && visibleAny.length !== 1) {
			throw new Error(
				`strict tab targeting matched ${visibleAny.length} visible tabs: ${visibleAny.map(describeCandidate).join(", ")}`,
			);
		}
		return pickNewest(visibleAny);
	}

	const focusedAny = pool.filter((candidate) => candidate.focused);
	if (focusedAny.length > 0) {
		if (strictTabTargeting && focusedAny.length !== 1) {
			throw new Error(
				`strict tab targeting matched ${focusedAny.length} focused tabs: ${focusedAny.map(describeCandidate).join(", ")}`,
			);
		}
		return pickNewest(focusedAny);
	}

	if (strictTabTargeting && pool.length !== 1) {
		throw new Error(
			`strict tab targeting matched ${pool.length} non-ChatGPT tabs: ${pool.map(describeCandidate).join(", ")}`,
		);
	}

	return pickNewest(pool);
};

export const ensureComposerReady = async (
	page: RuntimePage,
	selector: string,
	timeoutMs: number,
): Promise<void> => {
	try {
		await page.waitForSelector(selector, { timeout: timeoutMs });
	} catch {
		throw new Error(
			`composer '${selector}' not found within ${timeoutMs}ms at ${page.url()} (session likely needs login)`,
		);
	}
};

const STARTUP_SETTLE_POLL_MS = 150;
const STARTUP_SETTLE_REQUIRED_POLLS = 2;
const STARTUP_SETTLE_BUFFER_MS = 450;

type ComposerStartupState = {
	hasComposer: boolean;
	readyState: string;
	hasSendButton: boolean;
};

const readComposerStartupState = async (
	page: RuntimePage,
	selector: string,
): Promise<ComposerStartupState> =>
	page.evaluate((inputSelector) => {
		const browserGlobal = globalThis as unknown as {
			document: {
				querySelector: (selector: string) => unknown;
				readyState?: string;
			};
		};
		const hasComposer =
			browserGlobal.document.querySelector(inputSelector) !== null;
		const hasSendButton =
			browserGlobal.document.querySelector('[data-testid="send-button"]') !==
			null;
		const readyState =
			typeof browserGlobal.document.readyState === "string"
				? browserGlobal.document.readyState
				: "";
		return {
			hasComposer,
			readyState,
			hasSendButton,
		};
	}, selector);

const composerStartupReady = (state: ComposerStartupState): boolean => {
	if (!state.hasComposer) {
		return false;
	}
	if (state.readyState === "complete") {
		return true;
	}
	return state.readyState === "interactive" && state.hasSendButton;
};

/**
 * Fresh browser launches can expose the composer before app hydration finishes.
 * Poll for stable composer+page readiness before command handlers interact with it.
 */
export const ensureComposerStartupSettled = async (
	page: RuntimePage,
	selector: string,
	timeoutMs: number,
): Promise<void> => {
	let stablePolls = 0;
	let elapsedMs = 0;
	while (elapsedMs <= timeoutMs) {
		const state = await readComposerStartupState(page, selector);
		if (composerStartupReady(state)) {
			stablePolls += 1;
			if (stablePolls >= STARTUP_SETTLE_REQUIRED_POLLS) {
				await page.waitForTimeout(STARTUP_SETTLE_BUFFER_MS);
				return;
			}
		} else {
			stablePolls = 0;
		}
		await page.waitForTimeout(STARTUP_SETTLE_POLL_MS);
		elapsedMs += STARTUP_SETTLE_POLL_MS;
	}
	throw new Error(
		`composer '${selector}' did not settle within ${timeoutMs}ms at ${page.url()} (browser startup still in progress)`,
	);
};
