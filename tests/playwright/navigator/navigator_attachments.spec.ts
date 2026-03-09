import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
	collectAttachments,
	pasteAttachments,
} from "../../../src/navigator/browser/attachments";

const PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2O7NwAAAAASUVORK5CYII=";

test("attachment paste returns browser metadata", async ({ page }) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pp-nav-attach-"));
	const fixturePath = path.join(dir, "pixel.png");

	try {
		fs.writeFileSync(fixturePath, Buffer.from(PNG_BASE64, "base64"));
		await page.setContent(
			'<div id="prompt-textarea" contenteditable="true"></div>',
		);

		const attachments = collectAttachments([fixturePath]);
		const result = await pasteAttachments(page, attachments);

		expect(result.attached).toBe(true);
		expect(result.filenames).toEqual(["pixel.png"]);
		expect(result.attachments).toEqual([
			{ name: "pixel.png", type: "image/png", size: 68 },
		]);
		expect(result.size).toBe(68);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});
