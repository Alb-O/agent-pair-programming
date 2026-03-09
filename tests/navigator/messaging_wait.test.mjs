import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
	waitForAssistantResponseAfterCursor,
} = require("../../dist/navigator/browser/messaging.js");

const waitPage = ({
	generatingStates,
	tailStates,
	renderedText,
}) => {
	let generatingIndex = 0;
	let tailIndex = 0;
	return {
		evaluate: async (fn) => {
			const source = String(fn);
			if (source.includes(".result-thinking")) {
				const current =
					generatingStates[Math.min(generatingIndex, generatingStates.length - 1)];
				generatingIndex += 1;
				return current;
			}
			if (source.includes("lastAssistantTextRaw")) {
				const current = tailStates[Math.min(tailIndex, tailStates.length - 1)];
				tailIndex += 1;
				return current;
			}
			if (source.includes("/api/auth/session")) {
				return null;
			}
			if (source.includes("__reactProps")) {
				return null;
			}
			if (source.includes("[data-message-author-role='assistant']")) {
				return [renderedText];
			}
			throw new Error(`unexpected evaluate call: ${source.slice(0, 120)}`);
		},
	};
};

test("waitForAssistantResponseAfterCursor resolves when generation finishes with baseline-equal final text", async () => {
	const baseline = {
		assistantCount: 1,
		lastAssistantMessageId: "a1",
		lastMessageRole: "assistant",
		lastAssistantText: "final answer",
	};
	const tail = {
		assistantCount: 1,
		lastAssistantMessageId: "a1",
		lastMessageRole: "assistant",
		lastAssistantTextRaw: "final answer",
	};
	const page = waitPage({
		generatingStates: [true, false],
		tailStates: [tail, tail],
		renderedText: "final answer",
	});

	const response = await waitForAssistantResponseAfterCursor(page, baseline, {
		timeoutMs: 200,
		pollMs: 10,
	});
	assert.equal(response.text, "final answer");
	assert.equal(response.source, "rendered");
});

test("waitForAssistantResponseAfterCursor returns advanced response when generating signal never clears", async () => {
	const baseline = {
		assistantCount: 1,
		lastAssistantMessageId: "a1",
		lastMessageRole: "assistant",
		lastAssistantText: "previous",
	};
	const advancedTail = {
		assistantCount: 2,
		lastAssistantMessageId: "a2",
		lastMessageRole: "assistant",
		lastAssistantTextRaw: "fresh response",
	};
	const page = waitPage({
		generatingStates: [true, true, true, true, true],
		tailStates: [advancedTail, advancedTail, advancedTail, advancedTail],
		renderedText: "fresh response",
	});

	const response = await waitForAssistantResponseAfterCursor(page, baseline, {
		timeoutMs: 200,
		pollMs: 10,
	});
	assert.equal(response.text, "fresh response");
	assert.equal(response.source, "rendered");
});

test("waitForAssistantResponseAfterCursor does not apply implicit render timeout once streaming is observed", async () => {
	const baseline = {
		assistantCount: 1,
		lastAssistantMessageId: "a1",
		lastMessageRole: "assistant",
		lastAssistantText: "previous",
	};
	const advancedTail = {
		assistantCount: 2,
		lastAssistantMessageId: "a2",
		lastMessageRole: "assistant",
		lastAssistantTextRaw: "fresh response",
	};
	const page = waitPage({
		generatingStates: [true, true, true, true, false],
		tailStates: [advancedTail, advancedTail, advancedTail],
		renderedText: "fresh response",
	});

	const originalNow = Date.now;
	let syntheticNow = originalNow();
	Date.now = () => {
		syntheticNow += 10_000;
		return syntheticNow;
	};
	try {
		const response = await waitForAssistantResponseAfterCursor(page, baseline, {
			pollMs: 10,
		});
		assert.equal(response.text, "fresh response");
		assert.equal(response.source, "rendered");
	} finally {
		Date.now = originalNow;
	}
});
