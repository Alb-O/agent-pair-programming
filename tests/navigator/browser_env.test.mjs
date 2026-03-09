import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
	NAVIGATOR_BROWSER_ENV,
	parseNavigatorBrowser,
	resolveNavigatorBrowser,
} = require("../../dist/navigator/runtime/chatgpt_session/browser_env.js");

test("parseNavigatorBrowser normalizes supported browser aliases", () => {
	assert.equal(parseNavigatorBrowser("chromium"), "chromium");
	assert.equal(parseNavigatorBrowser("chrome"), "chromium");
	assert.equal(parseNavigatorBrowser("firefox"), "firefox");
});

test("resolveNavigatorBrowser resolves browser from env", () => {
	const resolved = resolveNavigatorBrowser({
		env: {
			[NAVIGATOR_BROWSER_ENV]: "firefox",
		},
	});
	assert.equal(resolved?.source, "env");
	assert.equal(resolved?.browser, "firefox");
});

test("resolveNavigatorBrowser prefers option over env", () => {
	const resolved = resolveNavigatorBrowser({
		browser: "chromium",
		env: {
			[NAVIGATOR_BROWSER_ENV]: "firefox",
		},
	});
	assert.equal(resolved?.source, "option");
	assert.equal(resolved?.browser, "chromium");
});

test("resolveNavigatorBrowser rejects invalid browser values", () => {
	assert.throws(
		() =>
			resolveNavigatorBrowser({
				env: {
					[NAVIGATOR_BROWSER_ENV]: "netscape",
				},
			}),
		/Invalid browser selection/,
	);
});
