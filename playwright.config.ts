import fs from "node:fs";
import { chromium, defineConfig } from "@playwright/test";

const chromiumBin = process.env.CHROMIUM_BIN;
const headful = process.env.PP_HEADFUL === "1";
const resolvedChromiumBin = (() => {
	if (chromiumBin !== undefined && chromiumBin !== "") {
		if (!fs.existsSync(chromiumBin)) {
			throw new Error(
				`CHROMIUM_BIN does not exist: ${chromiumBin}. Set CHROMIUM_BIN to a valid Chromium executable path.`,
			);
		}
		return chromiumBin;
	}

	const bundled = chromium.executablePath();
	if (!fs.existsSync(bundled)) {
		throw new Error(
			`Playwright Chromium is not installed at ${bundled}. Run 'npx playwright install chromium' or set CHROMIUM_BIN.`,
		);
	}
	return bundled;
})();

export default defineConfig({
	testDir: "./tests/playwright",
	reporter: "list",
	use: {
		browserName: "chromium",
		headless: !headful,
		launchOptions: {
			executablePath: resolvedChromiumBin,
			args: [
				"--no-sandbox",
				"--disable-dev-shm-usage",
				"--disable-gpu",
				"--disable-software-rasterizer",
			],
		},
	},
});
