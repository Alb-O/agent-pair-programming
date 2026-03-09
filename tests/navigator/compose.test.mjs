import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
	composeNavigatorMessage,
} = require("../../dist/navigator/compose/composer.js");

const createFixture = () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pp-compose-"));
	const prompt = path.join(dir, "prompt.txt");
	const code = path.join(dir, "code.rs");
	fs.writeFileSync(prompt, "review this carefully", "utf8");
	fs.writeFileSync(code, "line1\nline2\nline3\nline4\n", "utf8");
	return { dir, prompt, code };
};

const withFixture = (fn) => {
	const fixture = createFixture();
	try {
		fn(fixture);
	} finally {
		fs.rmSync(fixture.dir, { recursive: true, force: true });
	}
};

test("compose includes full file blocks", () => {
	withFixture((fixture) => {
		const output = composeNavigatorMessage({
			preambleFile: fixture.prompt,
			entries: [fixture.code],
		});
		const outputPrefixed = composeNavigatorMessage({
			preambleFile: fixture.prompt,
			entries: [`file:${fixture.code}`],
		});

		assert.equal(output.startsWith("review this carefully"), true);
		assert.equal(output.includes(`[FILE: ${fixture.code}]`), true);
		assert.equal(output.includes("line1\nline2\nline3\nline4"), true);
		assert.equal(outputPrefixed.includes(`[FILE: ${fixture.code}]`), true);
	});
});

test("compose supports slice entries", () => {
	withFixture((fixture) => {
		const output = composeNavigatorMessage({
			preambleFile: fixture.prompt,
			entries: [`slice:${fixture.code}:2:3:focus area`],
		});

		assert.equal(
			output.includes(`[FILE: ${fixture.code} | lines 2-3 | focus area]`),
			true,
		);
		assert.equal(output.includes("line2\nline3"), true);
	});
});

test("compose supports shorthand ranges", () => {
	withFixture((fixture) => {
		const output = composeNavigatorMessage({
			preambleFile: fixture.prompt,
			entries: [`${fixture.code}:2-3`],
		});
		const outputMulti = composeNavigatorMessage({
			preambleFile: fixture.prompt,
			entries: [`${fixture.code}:1-1,4-4`],
		});
		const outputClamped = composeNavigatorMessage({
			preambleFile: fixture.prompt,
			entries: [`${fixture.code}:3-99`],
		});

		assert.equal(output.includes(`[FILE: ${fixture.code} | lines 2-3]`), true);
		assert.equal(output.includes("line2\nline3"), true);
		assert.equal(
			outputMulti.includes(`[FILE: ${fixture.code} | line 1]`),
			true,
		);
		assert.equal(
			outputMulti.includes(`[FILE: ${fixture.code} | line 4]`),
			true,
		);
		assert.equal(
			outputClamped.includes(`[FILE: ${fixture.code} | lines 3-4]`),
			true,
		);
	});
});

test("compose emits warning for standalone backslash entries", () => {
	withFixture((fixture) => {
		const warnings = [];
		const output = composeNavigatorMessage({
			preambleFile: fixture.prompt,
			entries: ["\\", fixture.code],
			onWarning: (warning) => {
				warnings.push(warning);
			},
		});

		assert.equal(warnings.length, 1);
		assert.match(warnings[0], /ignoring standalone '\\\\' entry/i);
		assert.equal(output.includes(`[FILE: ${fixture.code}]`), true);
	});
});

test("compose rejects invalid slice ranges", () => {
	withFixture((fixture) => {
		assert.throws(
			() =>
				composeNavigatorMessage({
					preambleFile: fixture.prompt,
					entries: [`slice:${fixture.code}:4:2`],
				}),
			/Slice end must be >= start/,
		);
	});
});

test("compose rejects out of bounds slice start", () => {
	withFixture((fixture) => {
		assert.throws(
			() =>
				composeNavigatorMessage({
					preambleFile: fixture.prompt,
					entries: [`slice:${fixture.code}:99:99`],
				}),
			/Slice start \(99\) exceeds file length/,
		);
	});
});

test("compose rejects directory entries", () => {
	withFixture((fixture) => {
		const notesDir = path.join(fixture.dir, "notes");
		fs.mkdirSync(notesDir);
		assert.throws(
			() =>
				composeNavigatorMessage({
					preambleFile: fixture.prompt,
					entries: [notesDir],
				}),
			/File entry is not a file: .*type=dir/,
		);
	});
});
