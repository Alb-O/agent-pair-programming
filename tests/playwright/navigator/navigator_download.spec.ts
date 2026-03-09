import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
	downloadNavigatorArtifact,
	listNavigatorArtifacts,
} from "../../../src/navigator/browser/download";

const CONVERSATION_ID = "699519d6-6080-839b-9f52-7e900f4b8217";
const CONVERSATION_URL = `https://chatgpt.com/c/${CONVERSATION_ID}`;
const DOWNLOAD_URL = "https://files.example.test/download/beta.txt";

const CONVERSATION_HTML = [
	"<!doctype html>",
	"<html>",
	"<body>",
	'<div id="prompt-textarea" contenteditable="true"></div>',
	'<div data-message-author-role="assistant" data-message-id="msg-alpha">',
	'<a class="cursor-pointer" href="sandbox:/mnt/data/alpha.txt">alpha.txt</a>',
	"</div>",
	'<div data-message-author-role="assistant" data-message-id="msg-beta">',
	'<a class="cursor-pointer" href="sandbox:/mnt/data/beta.txt">beta.txt</a>',
	"</div>",
	"</body>",
	"</html>",
].join("");

const installConversationRoutes = async (page: Page): Promise<void> => {
	await page.route("**/*", async (route) => {
		const requestUrl = new URL(route.request().url());

		if (
			requestUrl.origin === "https://chatgpt.com" &&
			requestUrl.pathname === `/c/${CONVERSATION_ID}`
		) {
			await route.fulfill({
				status: 200,
				contentType: "text/html",
				body: CONVERSATION_HTML,
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
			requestUrl.pathname ===
				`/backend-api/conversation/${CONVERSATION_ID}/interpreter/download`
		) {
			expect(requestUrl.searchParams.get("message_id")).toBe("msg-beta");
			expect(requestUrl.searchParams.get("sandbox_path")).toBe(
				"/mnt/data/beta.txt",
			);
			expect(route.request().headers().authorization).toBe(
				"Bearer pp-test-token",
			);

			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					download_url: DOWNLOAD_URL,
				}),
			});
			return;
		}

		if (
			requestUrl.origin === "https://files.example.test" &&
			requestUrl.pathname === "/download/beta.txt"
		) {
			await route.fulfill({
				status: 200,
				contentType: "text/plain",
				body: "artifact payload",
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

test("listNavigatorArtifacts returns conversation sandbox links", async ({
	page,
}) => {
	await installConversationRoutes(page);
	await page.goto(CONVERSATION_URL);

	const links = await listNavigatorArtifacts(page);
	expect(links).toEqual([
		{
			index: 0,
			messageId: "msg-alpha",
			sandboxPath: "/mnt/data/alpha.txt",
			file: "alpha.txt",
			label: "alpha.txt",
		},
		{
			index: 1,
			messageId: "msg-beta",
			sandboxPath: "/mnt/data/beta.txt",
			file: "beta.txt",
			label: "beta.txt",
		},
	]);
});

test("downloadNavigatorArtifact saves selected artifact to disk", async ({
	page,
}) => {
	await installConversationRoutes(page);
	await page.goto(CONVERSATION_URL);

	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pp-nav-download-"));
	try {
		const result = await downloadNavigatorArtifact(page, {
			index: 1,
			outputPath: "artifacts/beta.txt",
			cwd: tmpDir,
		});

		expect(result.mode).toBe("saved");
		expect(result.link.index).toBe(1);
		expect(result.link.file).toBe("beta.txt");
		expect(result.size).toBe(Buffer.byteLength("artifact payload"));
		expect(result.savedPath).toBe(path.resolve(tmpDir, "artifacts/beta.txt"));
		expect(fs.readFileSync(result.savedPath, "utf8")).toBe("artifact payload");
	} finally {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	}
});
