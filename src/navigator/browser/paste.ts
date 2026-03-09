import {
	conversationLengthState,
	sendGate,
} from "../limits/conversation_limits";
import { insertComposerText, type BrowserPage } from "./composer";
import { conversationCharLength } from "./session";
import { clickSendButton } from "./send";

/**
 * Paste helper for inline composer text, with optional send/cap gating.
 * Used by pp paste runtime and browser-level tests.
 */
export type PasteNavigatorTextOptions = {
	clear?: boolean;
	send?: boolean;
};

export type PasteNavigatorTextResult = {
	pasted: boolean;
	sent: boolean;
	blocked: boolean;
	must_start_new: boolean;
	reason: "conversation_cap_reached" | null;
	length: number;
};

const readGateState = async (page: BrowserPage) => {
	const chars = await conversationCharLength(page);
	const limitState = conversationLengthState(chars);
	return {
		limitState,
		gate: sendGate(limitState),
	};
};

export const pasteNavigatorText = async (
	page: BrowserPage,
	text: string,
	{ clear = false, send = false }: PasteNavigatorTextOptions = {},
): Promise<PasteNavigatorTextResult> => {
	if (text.trim() === "") {
		throw new Error("No text provided on stdin for pp paste");
	}

	if (send) {
		const gateState = await readGateState(page);
		if (!gateState.gate.allowed) {
			return {
				pasted: false,
				sent: false,
				blocked: true,
				must_start_new: true,
				reason: "conversation_cap_reached",
				length: 0,
			};
		}
	}

	const inserted = await insertComposerText(page, text, {
		clear,
	});

	if (send) {
		await clickSendButton(page);
		return {
			pasted: true,
			sent: true,
			blocked: false,
			must_start_new: false,
			reason: null,
			length: inserted.inserted,
		};
	}

	return {
		pasted: true,
		sent: false,
		blocked: false,
		must_start_new: false,
		reason: null,
		length: inserted.inserted,
	};
};
