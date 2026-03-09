/**
 * Conversation budget math for navigator send gating.
 * Uses a flat hard cap independent of OS/process argument limits.
 */
export const CONVERSATION_CHAR_LIMIT = 573_440;
export const CONVERSATION_HARD_CAP_PCT = 100;
export const CONVERSATION_WARN_PCT = 70;
export const CONVERSATION_CRITICAL_PCT = 85;
export const CONVERSATION_START_FRESH_NOW_MESSAGE =
	"Start a fresh chat now: pp new, briefing with summary of work up until this point.";
export const CONVERSATION_START_FRESH_SOON_MESSAGE =
	"Consider starting a fresh chat soon (pp new) at a good breakpoint, briefing with summary of work up until this point.";

export type ConversationLengthLevel = "ok" | "warn" | "critical" | "cap";

export type ConversationLengthState = {
	chars: number;
	effectiveLimit: number;
	warnAt: number;
	criticalAt: number;
	percentRaw: number;
	percent: number;
	hardCapPct: number;
	atOrOverCap: boolean;
	level: ConversationLengthLevel;
	warned: boolean;
};

export const conversationLengthState = (chars: number): ConversationLengthState => {
	const normalizedChars = Math.max(0, Math.trunc(chars));
	const effectiveLimit = CONVERSATION_CHAR_LIMIT;
	const warnAt = Math.trunc((effectiveLimit * CONVERSATION_WARN_PCT) / 100);
	const criticalAt = Math.trunc(
		(effectiveLimit * CONVERSATION_CRITICAL_PCT) / 100,
	);
	const percentRaw =
		effectiveLimit > 0
			? Math.trunc((normalizedChars * 100) / effectiveLimit)
			: 0;
	const percent =
		percentRaw > CONVERSATION_HARD_CAP_PCT
			? CONVERSATION_HARD_CAP_PCT
			: percentRaw;
	const atOrOverCap =
		effectiveLimit > 0 ? normalizedChars >= effectiveLimit : false;

	let level: ConversationLengthLevel = "ok";
	if (atOrOverCap) {
		level = "cap";
	} else if (normalizedChars >= criticalAt) {
		level = "critical";
	} else if (normalizedChars >= warnAt) {
		level = "warn";
	}

	return {
		chars: normalizedChars,
		effectiveLimit,
		warnAt,
		criticalAt,
		percentRaw,
		percent,
		hardCapPct: CONVERSATION_HARD_CAP_PCT,
		atOrOverCap,
		level,
		warned: level !== "ok",
	};
};

export type SendGate = {
	allowed: boolean;
	blocked: boolean;
	reason: "conversation_cap_reached" | null;
	mustStartNew: boolean;
	state: ConversationLengthState;
};

export const sendGate = (state: ConversationLengthState): SendGate => {
	if (state.atOrOverCap) {
		return {
			allowed: false,
			blocked: true,
			reason: "conversation_cap_reached",
			mustStartNew: true,
			state,
		};
	}

	return {
		allowed: true,
		blocked: false,
		reason: null,
		mustStartNew: false,
		state,
	};
};

/**
 * Human-facing warning copy that mirrors pp nushell guidance at warn/critical/cap.
 */
export const conversationLengthWarningLines = (
	state: ConversationLengthState,
): string[] => {
	if (state.level === "cap") {
		return [
			`⛔ Conversation reached hard cap: ${state.chars} chars (100% of cap ${state.effectiveLimit}).`,
			CONVERSATION_START_FRESH_NOW_MESSAGE,
		];
	}
	if (state.level === "critical") {
		return [
			`⚠  Conversation is very large: ${state.chars} chars (approx ${state.percent}% of safe limit ${state.effectiveLimit}).`,
			CONVERSATION_START_FRESH_NOW_MESSAGE,
		];
	}
	if (state.level === "warn") {
		return [
			`⚠️ Conversation is getting large: ${state.chars} chars (approx ${state.percent}% of safe limit ${state.effectiveLimit}).`,
			CONVERSATION_START_FRESH_SOON_MESSAGE,
		];
	}
	return [];
};

/**
 * Hard-cap send-blocked copy that mirrors pp nushell guidance.
 */
export const conversationCapBlockedLines = (
	state: ConversationLengthState,
): string[] => {
	if (!state.atOrOverCap) {
		return [];
	}
	return [
		`⛔ Send is disabled at the conversation hard cap (100% of ${state.effectiveLimit} chars).`,
		CONVERSATION_START_FRESH_NOW_MESSAGE,
	];
};
