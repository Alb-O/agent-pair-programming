/**
 * Browser composer insertion primitives.
 * Writes prompt text into textarea or contenteditable inputs and dispatches input events.
 */
export type BrowserPage = {
	evaluate: {
		<T>(pageFunction: () => T | Promise<T>): Promise<T>;
		<T, A>(pageFunction: (arg: A) => T | Promise<T>, arg: A): Promise<T>;
	};
};

export type InsertComposerTextOptions = {
	selector?: string;
	clear?: boolean;
};

export type InsertComposerTextResult = {
	inserted: number;
	value: string;
};

const DEFAULT_SELECTOR = "#prompt-textarea";

export const insertComposerText = async (
	page: BrowserPage,
	text: string,
	{
		selector = DEFAULT_SELECTOR,
		clear = false,
	}: InsertComposerTextOptions = {},
): Promise<InsertComposerTextResult> => {
	const result = await page.evaluate(
		({ inputText, inputSelector, doClear }) => {
			const browserGlobal = globalThis as unknown as {
				document: {
					querySelector: (selector: string) => {
						innerText?: string;
						textContent?: string;
						value?: string;
						tagName?: string;
						focus?: () => void;
						dispatchEvent?: (event: unknown) => void;
					} | null;
				};
				DataTransfer: {
					new (): {
						setData: (mime: string, value: string) => void;
					};
				};
				ClipboardEvent: {
					new (
						type: string,
						init: {
							bubbles: boolean;
							cancelable: boolean;
							clipboardData: unknown;
						},
					): unknown;
				};
				Event: {
					new (type: string, init?: { bubbles: boolean }): unknown;
				};
			};
			const element = browserGlobal.document.querySelector(inputSelector);
			if (element === null) {
				return {
					error: `composer not found for selector '${inputSelector}'`,
				};
			}

			const readValue = (): string => {
				const tagName = (element.tagName || "").toUpperCase();
				if (tagName === "TEXTAREA") {
					return element.value || "";
				}
				const raw = element.innerText || element.textContent || "";
				return raw === "\n" ? "" : raw;
			};

			if (element.focus !== undefined) {
				element.focus();
			}
			const tagName = (element.tagName || "").toUpperCase();
			if (tagName === "TEXTAREA") {
				element.value = doClear ? inputText : `${element.value}${inputText}`;
			} else {
				const before = readValue();
				if (doClear) {
					element.innerText = "";
				}

				try {
					const transfer = new browserGlobal.DataTransfer();
					transfer.setData("text/plain", inputText);
					const pasteEvent = new browserGlobal.ClipboardEvent("paste", {
						bubbles: true,
						cancelable: true,
						clipboardData: transfer,
					});
					if (element.dispatchEvent !== undefined) {
						element.dispatchEvent(pasteEvent);
					}
				} catch {
					// fallback path below
				}

				const afterPaste = readValue();
				if (afterPaste === before) {
					element.innerText = doClear ? inputText : `${before}${inputText}`;
				}
			}

			if (element.dispatchEvent !== undefined) {
				element.dispatchEvent(
					new browserGlobal.Event("input", { bubbles: true }),
				);
				element.dispatchEvent(
					new browserGlobal.Event("change", { bubbles: true }),
				);
			}

			return {
				inserted: inputText.length,
				value: readValue(),
			};
		},
		{
			inputText: text,
			inputSelector: selector,
			doClear: clear,
		},
	);

	if (
		typeof result === "object" &&
		result !== null &&
		"error" in result &&
		typeof result.error === "string"
	) {
		throw new Error(result.error);
	}

	return result as InsertComposerTextResult;
};
