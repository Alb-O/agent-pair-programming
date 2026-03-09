import path from "node:path";

type RunE2ESmokeOptions = {
	playwrightRoot: string;
	chromiumBin: string;
};

type PlaywrightBrowser = {
	newPage: () => Promise<{
		goto: (url: string) => Promise<void>;
		title: () => Promise<string>;
	}>;
	close: () => Promise<void>;
};

type PlaywrightChromium = {
	launch: (options: {
		executablePath: string;
		headless: boolean;
		args: readonly string[];
	}) => Promise<PlaywrightBrowser>;
};

const BROWSER_ARGS = [
	"--no-sandbox",
	"--disable-dev-shm-usage",
	"--disable-gpu",
	"--disable-software-rasterizer",
];

const requireChromium = (playwrightRoot: string): PlaywrightChromium => {
	const modulePath = path.join(playwrightRoot, "packages/playwright-core");
	const loaded = require(modulePath) as { chromium?: PlaywrightChromium };
	if (loaded.chromium === undefined) {
		throw new Error(`playwright chromium export missing in ${modulePath}`);
	}
	return loaded.chromium;
};

const runE2ESmoke = async ({
	playwrightRoot,
	chromiumBin,
}: RunE2ESmokeOptions): Promise<void> => {
	const chromium = requireChromium(playwrightRoot);
	const browser = await chromium.launch({
		executablePath: chromiumBin,
		headless: true,
		args: BROWSER_ARGS,
	});

	try {
		const page = await browser.newPage();
		await page.goto("data:text/html,<title>pp-ok</title><h1>ok</h1>");
		const title = await page.title();
		if (title !== "pp-ok") {
			throw new Error(`unexpected title: ${title}`);
		}
		console.log("e2e-pass", title);
	} finally {
		await browser.close();
	}
};

export { runE2ESmoke };
