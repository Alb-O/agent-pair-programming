import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
	NAVIGATOR_PROFILE_ENV,
	resolveNavigatorProfile,
} = require("../../dist/navigator/profile/profile_env.js");

test("resolveNavigatorProfile resolves env profile into managed state dir", () => {
	const stateHome = "/tmp/pp-state";
	const resolved = resolveNavigatorProfile({
		env: {
			[NAVIGATOR_PROFILE_ENV]: "team-a",
			XDG_STATE_HOME: stateHome,
		},
	});

	assert.equal(resolved.source, "env");
	assert.equal(resolved.profile, "team-a");
	assert.equal(
		resolved.userDataDir,
		path.resolve(stateHome, "pp", "profiles", "team-a"),
	);
});

test("resolveNavigatorProfile fails loudly on invalid profile values", () => {
	assert.throws(
		() =>
			resolveNavigatorProfile({
				env: {
					[NAVIGATOR_PROFILE_ENV]: "bad/name",
				},
			}),
		/Invalid profile reference/,
	);
});
