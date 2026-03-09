import { expect, test } from "@playwright/test";
import { sendNavigatorMessage } from "../../../src/navigator/browser/send";

test("sendNavigatorMessage deduplicates when last user message matches", async ({
	page,
}) => {
	await page.setContent(
		[
			'<div id="prompt-textarea" contenteditable="true"></div>',
			'<div data-message-author-role="user">already sent</div>',
			'<button data-testid="send-button">Send</button>',
		].join(""),
	);

	const result = await sendNavigatorMessage(page, "already sent", {
		waitForResponse: false,
	});

	expect(result.success).toBe(true);
	expect(result.sent).toBe(false);
	expect(result.alreadySent).toBe(true);
});

test("sendNavigatorMessage clicks send button and inserts message", async ({
	page,
}) => {
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

	const result = await sendNavigatorMessage(page, "send this now", {
		waitForResponse: false,
	});

	expect(result.success).toBe(true);
	expect(result.sent).toBe(true);
	expect(result.alreadySent).toBe(false);
	await expect(
		page.locator("[data-message-author-role='user']").last(),
	).toHaveText("send this now");
});

test("sendNavigatorMessage waits for placeholder response that fills after send", async ({
	page,
}) => {
	await page.setContent(
		[
			'<div id="prompt-textarea" contenteditable="true"></div>',
			'<button data-testid="send-button" onclick="',
			"const composer = document.querySelector('#prompt-textarea');",
			"const user = document.createElement('div');",
			"user.setAttribute('data-message-author-role', 'user');",
			"user.innerText = composer.innerText || '';",
			"document.body.appendChild(user);",
			"const assistant = document.createElement('div');",
			"assistant.setAttribute('data-message-author-role', 'assistant');",
			"assistant.setAttribute('data-message-id', 'a2');",
			"assistant.innerText = '';",
			"document.body.appendChild(assistant);",
			"setTimeout(() => { assistant.innerText = 'new response after placeholder'; }, 300);",
			'">Send</button>',
		].join(""),
	);

	const result = await sendNavigatorMessage(page, "send this", {
		force: true,
		waitForResponse: true,
		timeoutMs: 5_000,
		pollMs: 50,
	});

	expect(result.success).toBe(true);
	expect(result.sent).toBe(true);
	expect(result.response?.text).toBe("new response after placeholder");
});
