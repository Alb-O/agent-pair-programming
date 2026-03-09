import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
	CONVERSATION_START_FRESH_NOW_MESSAGE,
	CONVERSATION_START_FRESH_SOON_MESSAGE,
	conversationCapBlockedLines,
	conversationLengthState,
	conversationLengthWarningLines,
	sendGate,
} = require("../../dist/navigator/limits/conversation_limits.js");

test("conversationLengthState enters warn and critical levels", () => {
	const baseline = conversationLengthState(0);
	const warnState = conversationLengthState(baseline.warnAt);
	const criticalState = conversationLengthState(baseline.criticalAt);

	assert.equal(
		warnState.level === "warn" ||
			warnState.level === "critical" ||
			warnState.level === "cap",
		true,
	);
	assert.equal(
		criticalState.level === "critical" || criticalState.level === "cap",
		true,
	);
});

test("conversationLengthState caps at hard limit and blocks send", () => {
	const baseline = conversationLengthState(0);
	const capState = conversationLengthState(baseline.effectiveLimit);
	const gate = sendGate(capState);

	assert.equal(capState.level, "cap");
	assert.equal(capState.atOrOverCap, true);
	assert.equal(capState.percent, 100);
	assert.equal(gate.allowed, false);
	assert.equal(gate.blocked, true);
	assert.equal(gate.mustStartNew, true);
	assert.equal(gate.reason, "conversation_cap_reached");
});

test("conversationLengthWarningLines mirrors warn/critical/cap copy", () => {
	const baseline = conversationLengthState(0);

	const warnState = conversationLengthState(baseline.warnAt);
	const warnLines = conversationLengthWarningLines(warnState);
	assert.deepEqual(warnLines, [
		`⚠️ Conversation is getting large: ${warnState.chars} chars (approx ${warnState.percent}% of safe limit ${warnState.effectiveLimit}).`,
		CONVERSATION_START_FRESH_SOON_MESSAGE,
	]);

	const criticalState = conversationLengthState(baseline.criticalAt);
	const criticalLines = conversationLengthWarningLines(criticalState);
	assert.deepEqual(criticalLines, [
		`⚠  Conversation is very large: ${criticalState.chars} chars (approx ${criticalState.percent}% of safe limit ${criticalState.effectiveLimit}).`,
		CONVERSATION_START_FRESH_NOW_MESSAGE,
	]);

	const capState = conversationLengthState(baseline.effectiveLimit);
	const capLines = conversationLengthWarningLines(capState);
	assert.deepEqual(capLines, [
		`⛔ Conversation reached hard cap: ${capState.chars} chars (100% of cap ${capState.effectiveLimit}).`,
		CONVERSATION_START_FRESH_NOW_MESSAGE,
	]);
});

test("conversationCapBlockedLines emits send-disabled cap guidance", () => {
	const belowCap = conversationLengthState(1000);
	assert.deepEqual(conversationCapBlockedLines(belowCap), []);

	const baseline = conversationLengthState(0);
	const capState = conversationLengthState(baseline.effectiveLimit);
	assert.deepEqual(conversationCapBlockedLines(capState), [
		`⛔ Send is disabled at the conversation hard cap (100% of ${capState.effectiveLimit} chars).`,
		CONVERSATION_START_FRESH_NOW_MESSAGE,
	]);
});
