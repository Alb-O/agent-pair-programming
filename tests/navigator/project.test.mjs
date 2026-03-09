import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
	parseProjectId,
	parseProjectRef,
	urlInProject,
} = require("../../dist/navigator/project/project_ref.js");

const PROJECT_HEX = "6996975794048191b2a7e2b02d2afb77";
const PROJECT_HEX_WITH_NAME = `${PROJECT_HEX}-nusim`;

test("parseProjectId normalizes representative project references", () => {
	const expected = `g-p-${PROJECT_HEX}`;
	assert.equal(parseProjectId(PROJECT_HEX_WITH_NAME), expected);
	assert.equal(
		parseProjectId(
			`https://chatgpt.com/g/g-p-${PROJECT_HEX_WITH_NAME}/c/699519d6-6080-839b-9f52-7e900f4b8217`,
		),
		expected,
	);
	assert.equal(
		parseProjectId(`chatgpt.com/g/g-p-${PROJECT_HEX_WITH_NAME}`),
		expected,
	);
});

test("parseProjectRef returns canonical project root and project urls", () => {
	const parsed = parseProjectRef(
		`https://chatgpt.com/g/g-p-${PROJECT_HEX_WITH_NAME}/project`,
	);
	assert.equal(parsed.projectId, `g-p-${PROJECT_HEX}`);
	assert.equal(
		parsed.projectRootUrl,
		`https://chatgpt.com/g/g-p-${PROJECT_HEX}`,
	);
	assert.equal(
		parsed.projectUrl,
		`https://chatgpt.com/g/g-p-${PROJECT_HEX}/project`,
	);
});

test("urlInProject matches only the requested project", () => {
	assert.equal(
		urlInProject(
			`https://chatgpt.com/g/g-p-${PROJECT_HEX_WITH_NAME}/c/699519d6-6080-839b-9f52-7e900f4b8217`,
			`g-p-${PROJECT_HEX}`,
		),
		true,
	);
	assert.equal(
		urlInProject(
			"https://chatgpt.com/g/g-p-other/project",
			`g-p-${PROJECT_HEX}`,
		),
		false,
	);
});

test("parseProjectId rejects invalid values", () => {
	assert.throws(
		() => parseProjectId("https://example.com/not-chatgpt"),
		/Invalid project reference/,
	);
	assert.throws(() => parseProjectId(""), /Project value is empty/);
});
