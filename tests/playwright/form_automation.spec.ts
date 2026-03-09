import { expect, test } from "@playwright/test";
import { setHomePage } from "./site_fixture";

test("fills automation form and emits deterministic payload", async ({
	page,
}) => {
	await setHomePage(page);

	await page.fill("#email", "ops@example.com");
	await page.selectOption("#cadence", "2h");
	await page.fill("#retries", "5");
	await page.click("#run");

	await expect(page.locator("#result")).toHaveText("ops@example.com|2h|5");

	const screenshotBytes = await page.screenshot({ fullPage: true });
	expect(screenshotBytes.byteLength).toBeGreaterThan(1000);
});
