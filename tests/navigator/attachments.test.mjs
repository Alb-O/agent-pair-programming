import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
	collectAttachments,
	fileAttachment,
} = require("../../dist/navigator/browser/attachments.js");

const PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2O7NwAAAAASUVORK5CYII=";

const withPngFixture = (fn) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pp-attachments-"));
	const fixturePath = path.join(dir, "pixel.png");
	try {
		fs.writeFileSync(fixturePath, Buffer.from(PNG_BASE64, "base64"));
		fn({ dir, fixturePath });
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
};

test("fileAttachment preserves png bytes and mime", () => {
	withPngFixture(({ fixturePath }) => {
		const payload = fileAttachment(fixturePath);

		assert.equal(payload.name, "pixel.png");
		assert.equal(payload.mime, "image/png");
		assert.equal(payload.size, 68);
		assert.equal(payload.base64, PNG_BASE64);
	});
});

test("collectAttachments supports text input payload", () => {
	const text = "hello\nworld";
	const expectedBase64 = Buffer.from(text, "utf8").toString("base64");

	const payload = collectAttachments([], text, "note.txt");
	assert.equal(payload.length, 1);
	assert.equal(payload[0].name, "note.txt");
	assert.equal(payload[0].mime, "text/plain");
	assert.equal(payload[0].size, 11);
	assert.equal(payload[0].base64, expectedBase64);
});

test("collectAttachments fails loudly when no input is provided", () => {
	assert.throws(
		() => collectAttachments([], undefined, undefined),
		/navigator attach requires files/,
	);
});
