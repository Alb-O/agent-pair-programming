import { expect, test, type Page } from "@playwright/test";
import {
	getConversationHistory,
	isGenerating,
	waitForAssistantResponseOrLatest,
} from "../../../src/navigator/browser/messaging";
import { getAssistantResponseText } from "../../../src/navigator/browser/response";

const CONVERSATION_ID = "699519d6-6080-839b-9f52-7e900f4b8217";
const CONVERSATION_URL = `https://chatgpt.com/c/${CONVERSATION_ID}`;

const HISTORY_CONVERSATION_HTML = [
	"<!doctype html>",
	"<html>",
	"<body>",
	'<div id="prompt-textarea" contenteditable="true"></div>',
	'<div data-message-author-role="user" data-message-id="msg-driver">driver rendered</div>',
	'<div data-message-author-role="assistant" data-message-id="msg-nav">navigator rendered</div>',
	"</body>",
	"</html>",
].join("");

const installHistoryConversationRoutes = async (page: Page): Promise<void> => {
	await page.route("**/*", async (route) => {
		const requestUrl = new URL(route.request().url());

		if (
			requestUrl.origin === "https://chatgpt.com" &&
			requestUrl.pathname === `/c/${CONVERSATION_ID}`
		) {
			await route.fulfill({
				status: 200,
				contentType: "text/html",
				body: HISTORY_CONVERSATION_HTML,
			});
			return;
		}

		if (
			requestUrl.origin === "https://chatgpt.com" &&
			requestUrl.pathname === "/api/auth/session"
		) {
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					accessToken: "pp-test-token",
				}),
			});
			return;
		}

		if (
			requestUrl.origin === "https://chatgpt.com" &&
			requestUrl.pathname === `/backend-api/conversation/${CONVERSATION_ID}`
		) {
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					mapping: {
						"node-driver": {
							message: {
								id: "msg-driver",
								author: { role: "user" },
								content: {
									parts: ["### Driver Prompt\n\n* review src/cli.ts"],
								},
							},
						},
						"node-nav": {
							message: {
								id: "msg-nav",
								author: { role: "assistant" },
								content: {
									parts: ["## Navigator Plan\n\n* step 1\n* step 2\n\n`code`"],
								},
							},
						},
					},
				}),
			});
			return;
		}

		await route.fulfill({
			status: 404,
			contentType: "text/plain",
			body: "not found",
		});
	});
};

test("response extraction falls back to rendered text", async ({ page }) => {
	await page.setContent(
		[
			'<div id="prompt-textarea" contenteditable="true"></div>',
			'<div id="msg" data-message-author-role="assistant"></div>',
			"<script>",
			"const msg = document.querySelector('#msg');",
			"msg.innerText = 'line1\\n\\nline2';",
			"</script>",
		].join(""),
	);

	const response = await getAssistantResponseText(page);
	expect(response.source).toBe("rendered");
	expect(response.text).toBe("line1\nline2");
});

test("response extraction skips trailing empty assistant placeholders", async ({
	page,
}) => {
	await page.setContent(
		[
			'<div id="prompt-textarea" contenteditable="true"></div>',
			'<div data-message-author-role="assistant">prior non-empty response</div>',
			'<div data-message-author-role="assistant"></div>',
		].join(""),
	);

	const response = await getAssistantResponseText(page);
	expect(response.source).toBe("rendered");
	expect(response.text).toBe("prior non-empty response");
});

test("response extraction preserves markdown via react fallback", async ({
	page,
}) => {
	await page.setContent(
		[
			'<div id="prompt-textarea" contenteditable="true"></div>',
			'<div id="msg" data-message-author-role="assistant"></div>',
			"<script>",
			"const msg = document.querySelector('#msg');",
			"msg.innerText = 'rendered heading\\nrendered bullet';",
			"msg.__reactPropsFake = { children: [{ props: { parts: ['## Heading\\n\\n- alpha\\n- `code`'] } }] };",
			"</script>",
		].join(""),
	);

	const response = await getAssistantResponseText(page);
	expect(response.source).toBe("react");
	expect(response.text).toBe("## Heading\n\n- alpha\n- `code`");
});

test("history extraction preserves markdown via conversation API", async ({
	page,
}) => {
	await installHistoryConversationRoutes(page);
	await page.goto(CONVERSATION_URL);

	const history = await getConversationHistory(page);
	expect(history).toEqual([
		{
			index: 0,
			role: "user",
			text: "### Driver Prompt\n\n* review src/cli.ts",
		},
		{
			index: 1,
			role: "assistant",
			text: "## Navigator Plan\n\n* step 1\n* step 2\n\n`code`",
		},
	]);
});

test("history extraction preserves markdown via react fallback", async ({
	page,
}) => {
	await page.setContent(
		[
			'<div id="prompt-textarea" contenteditable="true"></div>',
			'<div data-message-author-role="user">driver rendered</div>',
			'<div id="msg" data-message-author-role="assistant"></div>',
			"<script>",
			"const msg = document.querySelector('#msg');",
			"msg.innerText = 'rendered heading\\nrendered bullet';",
			"msg.__reactPropsFake = { children: [{ props: { parts: ['## Heading\\n\\n- alpha\\n- `code`'] } }] };",
			"</script>",
		].join(""),
	);

	const history = await getConversationHistory(page);
	expect(history).toEqual([
		{ index: 0, role: "user", text: "driver rendered" },
		{ index: 1, role: "assistant", text: "## Heading\n\n- alpha\n- `code`" },
	]);
});

test("history and generation helpers read chat-like DOM", async ({ page }) => {
	await page.setContent(
		[
			'<div id="prompt-textarea" contenteditable="true"></div>',
			'<div data-message-author-role="user">driver question</div>',
			'<div data-message-author-role="assistant">navigator answer</div>',
			'<button data-testid="stop-button">Stop</button>',
		].join(""),
	);

	const history = await getConversationHistory(page);
	expect(history).toEqual([
		{ index: 0, role: "user", text: "driver question" },
		{ index: 1, role: "assistant", text: "navigator answer" },
	]);
	expect(await isGenerating(page)).toBe(true);

	await page.evaluate(() => {
		const stop = document.querySelector('[data-testid="stop-button"]');
		stop?.remove();
	});
	expect(await isGenerating(page)).toBe(false);
});

test("isGenerating ignores unrelated stop controls", async ({ page }) => {
	await page.setContent(
		[
			'<div id="prompt-textarea" contenteditable="true"></div>',
			'<div data-message-author-role="assistant">navigator answer</div>',
			'<button data-testid="download-stop">Stop</button>',
			'<button aria-label="Stop">Stop</button>',
		].join(""),
	);

	expect(await isGenerating(page)).toBe(false);
});

test("isGenerating ignores disabled stop-generation controls", async ({ page }) => {
	await page.setContent(
		[
			'<div id="prompt-textarea" contenteditable="true"></div>',
			'<button aria-label="Stop generating" disabled>Stop generating</button>',
			'<button data-testid="composer-stop-button" disabled>Stop</button>',
		].join(""),
	);

	expect(await isGenerating(page)).toBe(false);
});

test("waitForAssistantResponseOrLatest waits through short idle-to-start gaps", async ({
	page,
}) => {
	await page.setContent(
		[
			'<div id="prompt-textarea" contenteditable="true"></div>',
			'<div data-message-author-role="assistant">previous response</div>',
		].join(""),
	);

	await page.evaluate(() => {
		setTimeout(() => {
			const stop = document.createElement("button");
			stop.setAttribute("data-testid", "stop-button");
			stop.textContent = "Stop";
			document.body.appendChild(stop);
		}, 200);
		setTimeout(() => {
			const next = document.createElement("div");
			next.setAttribute("data-message-author-role", "assistant");
			next.innerText = "new response after brief idle";
			document.body.appendChild(next);
			const stop = document.querySelector('[data-testid="stop-button"]');
			stop?.remove();
		}, 450);
	});

	const response = await waitForAssistantResponseOrLatest(page, {
		timeoutMs: 5_000,
		pollMs: 50,
		startGraceMs: 1_000,
	});

	expect(response.text).toBe("new response after brief idle");
});

test("waitForAssistantResponseOrLatest does not fall back to stale response when last message is user", async ({
	page,
}) => {
	await page.setContent(
		[
			'<div id="prompt-textarea" contenteditable="true"></div>',
			'<div data-message-author-role="assistant">previous response</div>',
			'<div data-message-author-role="user">pending question</div>',
		].join(""),
	);

	await page.evaluate(() => {
		setTimeout(() => {
			const next = document.createElement("div");
			next.setAttribute("data-message-author-role", "assistant");
			next.innerText = "new response after pending user";
			document.body.appendChild(next);
		}, 450);
	});

	const response = await waitForAssistantResponseOrLatest(page, {
		timeoutMs: 5_000,
		pollMs: 50,
		startGraceMs: 100,
	});

	expect(response.text).toBe("new response after pending user");
});
