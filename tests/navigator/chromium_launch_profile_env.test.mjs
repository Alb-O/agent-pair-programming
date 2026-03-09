import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
	NAVIGATOR_CHROMIUM_LAUNCH_PROFILE_ENV,
	parseNavigatorChromiumLaunchProfile,
	resolveNavigatorChromiumLaunchProfile,
} = require("../../dist/navigator/runtime/chatgpt_session/chromium_launch_profile_env.js");

test("parseNavigatorChromiumLaunchProfile normalizes supported aliases", () => {
	assert.equal(parseNavigatorChromiumLaunchProfile("low-detection"), "low-detection");
	assert.equal(parseNavigatorChromiumLaunchProfile("low_detection"), "low-detection");
	assert.equal(parseNavigatorChromiumLaunchProfile("low"), "low-detection");
	assert.equal(parseNavigatorChromiumLaunchProfile("strict"), "strict");
});

test("resolveNavigatorChromiumLaunchProfile resolves profile from env", () => {
	const resolved = resolveNavigatorChromiumLaunchProfile({
		env: {
			[NAVIGATOR_CHROMIUM_LAUNCH_PROFILE_ENV]: "strict",
		},
	});
	assert.equal(resolved?.source, "env");
	assert.equal(resolved?.chromiumLaunchProfile, "strict");
});

test("resolveNavigatorChromiumLaunchProfile prefers option over env", () => {
	const resolved = resolveNavigatorChromiumLaunchProfile({
		chromiumLaunchProfile: "low-detection",
		env: {
			[NAVIGATOR_CHROMIUM_LAUNCH_PROFILE_ENV]: "strict",
		},
	});
	assert.equal(resolved?.source, "option");
	assert.equal(resolved?.chromiumLaunchProfile, "low-detection");
});

test("resolveNavigatorChromiumLaunchProfile rejects invalid values", () => {
	assert.throws(
		() =>
			resolveNavigatorChromiumLaunchProfile({
				env: {
					[NAVIGATOR_CHROMIUM_LAUNCH_PROFILE_ENV]: "aggressive",
				},
			}),
		/Invalid chromium launch profile/,
	);
});
