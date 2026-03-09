import type { BrowserPage } from "./composer";

/**
 * Session introspection and model-selection helpers for ChatGPT pages.
 */
export type ModelMode = "auto" | "instant" | "thinking" | "pro";

export type ModelMenuItem = {
	text: string;
	testid: string | null;
};

export type SetModelResult = {
	success: true;
	mode: ModelMode;
	selectedTestId: string | null;
	current: string | null;
};

type ClickablePage = BrowserPage & {
	click: (selector: string) => Promise<void>;
	waitForTimeout: (timeout: number) => Promise<void>;
};

const MODEL_BUTTON_SELECTOR = '[data-testid="model-switcher-dropdown-button"]';

const sleep = async (page: ClickablePage, timeout: number): Promise<void> =>
	page.waitForTimeout(timeout);

const modeSearchText = (mode: ModelMode): string => {
	switch (mode) {
		case "auto":
			return "Decides how long";
		case "instant":
			return "Answers right away";
		case "thinking":
			return "Thinks longer";
		case "pro":
			return "Research-grade intelligence";
	}
};

export const getCurrentModel = async (
	page: BrowserPage,
): Promise<string | null> => {
	const value = await page.evaluate(() => {
		const browserGlobal = globalThis as unknown as {
			document: {
				querySelector: (selector: string) => { ariaLabel?: string } | null;
			};
		};
		const button = browserGlobal.document.querySelector(
			"button[aria-label^='Model selector']",
		);
		if (button === null || typeof button.ariaLabel !== "string") {
			return null;
		}
		const match = button.ariaLabel.match(/current model is (.+)/i);
		return match?.[1] ?? null;
	});

	if (typeof value !== "string" || value.trim() === "") {
		return null;
	}
	return value;
};

export const getLastDriverMessage = async (
	page: BrowserPage,
): Promise<string | null> => {
	const value = await page.evaluate(() => {
		const browserGlobal = globalThis as unknown as {
			document: {
				querySelectorAll: (
					selector: string,
				) => ArrayLike<{ innerText?: string }>;
			};
		};
		const messages = Array.from(
			browserGlobal.document.querySelectorAll(
				"[data-message-author-role='user']",
			),
		) as Array<{ innerText?: string }>;
		if (messages.length === 0) {
			return null;
		}
		return messages[messages.length - 1].innerText ?? null;
	});

	if (typeof value !== "string") {
		return null;
	}
	return value;
};

export const conversationCharLength = async (
	page: BrowserPage,
): Promise<number> => {
	const raw = await page.evaluate(() => {
		const browserGlobal = globalThis as unknown as {
			document: {
				querySelectorAll: (
					selector: string,
				) => ArrayLike<{ innerText?: string }>;
			};
		};
		const messages = Array.from(
			browserGlobal.document.querySelectorAll("[data-message-author-role]"),
		) as Array<{ innerText?: string }>;
		return messages.reduce(
			(total, message) => total + (message.innerText ?? "").length,
			0,
		);
	});

	if (!Number.isFinite(raw)) {
		return 0;
	}
	return Math.max(0, Math.trunc(raw));
};

const listModelMenuItems = async (
	page: BrowserPage,
): Promise<ModelMenuItem[]> =>
	page.evaluate(() => {
		const browserGlobal = globalThis as unknown as {
			document: {
				querySelector: (selector: string) => {
					querySelectorAll: (selector: string) => ArrayLike<{
						textContent?: string;
						getBoundingClientRect: () => { width: number; height: number };
						getAttribute: (name: string) => string | null;
					}>;
				} | null;
			};
		};

		const normalize = (value: string): string =>
			value
				.split("\n")
				.map((line) => line.trim())
				.filter((line) => line !== "")
				.join(" ");

		const menu = browserGlobal.document.querySelector('[role="menu"]');
		if (menu === null) {
			return [];
		}

		const items = Array.from(menu.querySelectorAll('[role="menuitem"]')).filter(
			(item) => {
				const rect = item.getBoundingClientRect();
				return rect.width > 2 && rect.height > 2;
			},
		);

		return items.map((item) => ({
			text: normalize(item.textContent ?? ""),
			testid: item.getAttribute("data-testid"),
		}));
	});

const pickMenuItem = (items: readonly ModelMenuItem[], mode: ModelMode) => {
	const byTestId = (() => {
		switch (mode) {
			case "auto":
				return items.find((item) => {
					const testid = item.testid ?? "";
					return (
						testid.startsWith("model-switcher-") &&
						!testid.endsWith("-instant") &&
						!testid.endsWith("-thinking") &&
						!testid.endsWith("-pro")
					);
				});
			case "instant":
				return items.find((item) => (item.testid ?? "").endsWith("-instant"));
			case "thinking":
				return items.find((item) => (item.testid ?? "").endsWith("-thinking"));
			case "pro":
				return items.find((item) => (item.testid ?? "").endsWith("-pro"));
		}
	})();

	if (byTestId !== undefined) {
		return byTestId;
	}

	const search = modeSearchText(mode);
	return items.find((item) => item.text.includes(search));
};

const clickMenuItemByText = async (
	page: BrowserPage,
	searchText: string,
): Promise<void> => {
	const result = await page.evaluate((search) => {
		const browserGlobal = globalThis as unknown as {
			document: {
				querySelector: (selector: string) => {
					querySelectorAll: (selector: string) => ArrayLike<{
						textContent?: string;
						getBoundingClientRect: () => { width: number; height: number };
						click: () => void;
					}>;
				} | null;
			};
		};

		const menu = browserGlobal.document.querySelector('[role="menu"]');
		if (menu === null) {
			return { error: "model menu not open" };
		}

		const items = Array.from(menu.querySelectorAll('[role="menuitem"]')).filter(
			(item) => {
				const rect = item.getBoundingClientRect();
				return rect.width > 2 && rect.height > 2;
			},
		);

		const target = items.find((item) =>
			(item.textContent ?? "").includes(search),
		);
		if (target === undefined) {
			return { error: "mode option not found by text" };
		}

		target.click();
		return { ok: true };
	}, searchText);

	if (
		typeof result === "object" &&
		result !== null &&
		"error" in result &&
		typeof result.error === "string"
	) {
		throw new Error(result.error);
	}
};

export const setModelMode = async (
	page: ClickablePage,
	mode: ModelMode,
): Promise<SetModelResult> => {
	let items: ModelMenuItem[] = [];

	for (let openAttempt = 1; openAttempt <= 4; openAttempt += 1) {
		await page.click(MODEL_BUTTON_SELECTOR);

		for (let poll = 0; poll < 20; poll += 1) {
			items = await listModelMenuItems(page);
			if (items.length > 0) {
				break;
			}
			await sleep(page, 50);
		}

		if (items.length > 0) {
			break;
		}
		await sleep(page, 100);
	}

	if (items.length === 0) {
		throw new Error("Model menu did not open after 4 attempts");
	}

	const target = pickMenuItem(items, mode);
	if (target === undefined) {
		throw new Error(
			`Mode option not found in menu for mode '${mode}'. Options: ${JSON.stringify(items)}`,
		);
	}

	const selectedTestId = target.testid;
	if (selectedTestId !== null && selectedTestId !== "") {
		await page.click(`[data-testid="${selectedTestId}"]`);
	} else {
		await clickMenuItemByText(page, modeSearchText(mode));
	}

	await sleep(page, 300);
	return {
		success: true,
		mode,
		selectedTestId: selectedTestId === "" ? null : selectedTestId,
		current: await getCurrentModel(page),
	};
};
