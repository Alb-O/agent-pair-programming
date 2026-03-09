import type { Page } from "@playwright/test";

const HOME_HTML = [
	"<!doctype html><html><head><title>ops-home</title></head><body>",
	"<h1>Ops Home</h1>",
	'<p id="description">automation launchpad</p>',
	"<nav>",
	'<a data-nav="1" href="pricing">pricing</a>',
	'<a data-nav="1" href="status">status</a>',
	'<a data-nav="1" href="contact">contact</a>',
	"</nav>",
	'<form id="job-form">',
	'<input id="email" name="email" />',
	'<select id="cadence" name="cadence">',
	'<option value="15m">15m</option>',
	'<option value="2h">2h</option>',
	"</select>",
	'<input id="retries" name="retries" type="number" min="1" max="10" value="1" />',
	'<button id="run" type="button">run</button>',
	"</form>",
	'<p id="result"></p>',
	"<script>",
	"document.querySelector('#run').addEventListener('click', () => {",
	"const email = document.querySelector('#email').value;",
	"const cadence = document.querySelector('#cadence').value;",
	"const retries = document.querySelector('#retries').value;",
	"document.querySelector('#result').textContent = email + '|' + cadence + '|' + retries;",
	"});",
	"</script>",
	"</body></html>",
].join("");

const ROUTE_HTML: Record<string, string> = {
	pricing:
		"<!doctype html><html><head><title>ops-pricing</title></head><body><h1>Pricing</h1><p>plan matrix</p></body></html>",
	status:
		"<!doctype html><html><head><title>ops-status</title></head><body><h1>Status</h1><p>all systems nominal</p></body></html>",
	contact:
		"<!doctype html><html><head><title>ops-contact</title></head><body><h1>Contact</h1><p>support desk</p></body></html>",
};

const setHomePage = async (page: Page): Promise<void> => {
	await page.setContent(HOME_HTML);
};

const setRoutePage = async (page: Page, route: string): Promise<void> => {
	const html = ROUTE_HTML[route];
	if (html === undefined) {
		throw new Error(`unknown route '${route}'`);
	}
	await page.setContent(html);
};

export { ROUTE_HTML, setHomePage, setRoutePage };
