import { expect, test } from "@playwright/test";
import { openChatgptSession } from "../../../src/navigator/runtime/chatgpt_session";
import { sendNavigatorMessage } from "../../../src/navigator/browser/send";

const liveEnabled = process.env.PP_CHATGPT_LIVE === "1";

test.describe("chatgpt live roundtrip", () => {
	test.skip(
		!liveEnabled,
		"set PP_CHATGPT_LIVE=1 with a logged-in profile to run live ChatGPT verification",
	);

	test("cli-equivalent send/receive roundtrip succeeds", async () => {
		test.setTimeout(600_000);

		const cdpUrl = process.env.PP_CHATGPT_CDP_URL;
		const chromiumBin =
			process.env.PP_CHATGPT_CHROMIUM_BIN ?? process.env.CHROMIUM_BIN;
		const userDataDir = process.env.PP_CHATGPT_PROFILE_DIR;
		const targetUrl = process.env.PP_CHATGPT_URL ?? "https://chatgpt.com";

		if (
			(cdpUrl === undefined || cdpUrl === "") &&
			(chromiumBin === undefined ||
				chromiumBin === "" ||
				userDataDir === undefined ||
				userDataDir === "")
		) {
			throw new Error(
				"live roundtrip needs either PP_CHATGPT_CDP_URL or both PP_CHATGPT_CHROMIUM_BIN/CHROMIUM_BIN and PP_CHATGPT_PROFILE_DIR",
			);
		}

		const session = await openChatgptSession({
			cdpUrl,
			chromiumBin,
			userDataDir,
			headless: false,
			targetUrl,
			navigate: true,
			composerTimeoutMs: 300_000,
		});

		try {
			const marker = `PP_NAV_OK_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
			const prompt = `Reply with exactly this token on a single line: ${marker}`;
			const result = await sendNavigatorMessage(session.page, prompt, {
				waitForResponse: true,
				timeoutMs: 300_000,
				force: true,
			});

			expect(result.sent).toBe(true);
			expect(result.response).toBeDefined();
			expect(result.response?.text).toContain(marker);
		} finally {
			await session.close();
		}
	});
});
