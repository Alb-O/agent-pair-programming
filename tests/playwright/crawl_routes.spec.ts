import { expect, test } from "@playwright/test";
import { setHomePage, setRoutePage } from "./site_fixture";

test("crawls nav routes and verifies title + heading integrity", async ({
	browser,
}) => {
	const homePage = await browser.newPage();
	await setHomePage(homePage);

	const routes = await homePage.evaluate(() => {
		const anchors = Array.from(
			document.querySelectorAll("a[data-nav='1']"),
		) as HTMLAnchorElement[];
		return anchors.map((anchor) => anchor.getAttribute("href") ?? "");
	});

	expect(routes).toEqual(["pricing", "status", "contact"]);

	const observed = [];
	for (const route of routes) {
		const page = await browser.newPage();
		await setRoutePage(page, route);
		observed.push({
			route,
			title: await page.title(),
			heading: await page.locator("h1").innerText(),
		});
		await page.close();
	}

	expect(observed).toEqual([
		{ route: "pricing", title: "ops-pricing", heading: "Pricing" },
		{ route: "status", title: "ops-status", heading: "Status" },
		{ route: "contact", title: "ops-contact", heading: "Contact" },
	]);
});
