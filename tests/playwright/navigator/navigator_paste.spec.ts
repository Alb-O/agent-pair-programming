import { expect, test } from "@playwright/test";
import { pasteNavigatorText } from "../../../src/navigator/browser/paste";

test("pasteNavigatorText inserts and sends composer text", async ({ page }) => {
	await page.setContent(
		[
			'<div id="prompt-textarea" contenteditable="true"></div>',
			'<button data-testid="send-button" onclick="',
			"const composer = document.querySelector('#prompt-textarea');",
			"const user = document.createElement('div');",
			"user.setAttribute('data-message-author-role', 'user');",
			"user.innerText = composer.innerText || '';",
			"document.body.appendChild(user);",
			'">Send</button>',
		].join(""),
	);

	const result = await pasteNavigatorText(page, "paste this", {
		clear: true,
		send: true,
	});

	expect(result).toEqual({
		pasted: true,
		sent: true,
		blocked: false,
		must_start_new: false,
		reason: null,
		length: "paste this".length,
	});
	await expect(
		page.locator("[data-message-author-role='user']").last(),
	).toHaveText("paste this");
});

test("pasteNavigatorText blocks send at hard conversation cap", async ({
	page,
}) => {
	await page.setContent(
		[
			'<div id="prompt-textarea" contenteditable="true"></div>',
			'<button data-testid="send-button">Send</button>',
		].join(""),
	);

	await page.evaluate(() => {
		const existing = document.createElement("div");
		existing.setAttribute("data-message-author-role", "assistant");
		existing.innerText = "x".repeat(500_000);
		document.body.appendChild(existing);
	});

	const result = await pasteNavigatorText(page, "blocked", {
		send: true,
	});

	expect(result).toEqual({
		pasted: false,
		sent: false,
		blocked: true,
		must_start_new: true,
		reason: "conversation_cap_reached",
		length: 0,
	});
	await expect(page.locator("#prompt-textarea")).toHaveText("");
});
