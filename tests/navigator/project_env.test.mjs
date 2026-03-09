import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
	NAVIGATOR_PROJECT_ENV,
	resolveNavigatorProject,
} = require("../../dist/navigator/project/project_env.js");

test("resolveNavigatorProject normalizes env project urls", () => {
	const resolved = resolveNavigatorProject({
		env: {
			[NAVIGATOR_PROJECT_ENV]:
				"https://chatgpt.com/g/g-p-6996975794048191b2a7e2b02d2afb77-nusim/project",
		},
	});

	assert.equal(resolved.source, "env");
	assert.equal(resolved.projectId, "g-p-6996975794048191b2a7e2b02d2afb77");
	assert.equal(
		resolved.projectUrl,
		"https://chatgpt.com/g/g-p-6996975794048191b2a7e2b02d2afb77/project",
	);
});

test("resolveNavigatorProject fails loudly on invalid env value", () => {
	assert.throws(
		() =>
			resolveNavigatorProject({
				env: {
					[NAVIGATOR_PROJECT_ENV]: "not-a-project",
				},
			}),
		/Invalid project reference/,
	);
});
