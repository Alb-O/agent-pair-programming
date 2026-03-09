import { expect, test } from "@playwright/test";
import { insertComposerText } from "../../../src/navigator/browser/composer";

const normalizeContentEditable = (value: string): string => {
	let normalized = value.replace(/\r/g, "");
	while (normalized.includes("\n\n\n")) {
		normalized = normalized.replaceAll("\n\n\n", "\n\n");
	}
	return normalized;
};

test("insertComposerText preserves newlines for contenteditable inputs", async ({
	page,
}) => {
	await page.setContent(
		'<div id="prompt-textarea" contenteditable="true"></div>',
	);
	const input = "one\n\ntwo\nthree";

	const result = await insertComposerText(page, input, { clear: true });

	expect(normalizeContentEditable(result.value)).toBe(input);
	expect(result.inserted).toBe(input.length);
});

test("insertComposerText preserves newlines for textarea inputs", async ({
	page,
}) => {
	await page.setContent('<textarea id="prompt-textarea"></textarea>');
	const input = "first\n\nthird\nfourth";

	const result = await insertComposerText(page, input, { clear: true });

	expect(result.value).toBe(input);
	expect(result.inserted).toBe(input.length);
});
