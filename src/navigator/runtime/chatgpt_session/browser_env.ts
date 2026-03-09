/**
 * Env-backed browser selection for navigator commands.
 * Supports explicit option/env binding with option precedence.
 */
export const NAVIGATOR_BROWSER_ENV = "PP_BROWSER";
export const NAVIGATOR_DEFAULT_BROWSER = "chromium";

const NAVIGATOR_BROWSER_ALIASES = {
	chromium: "chromium",
	chrome: "chromium",
	"google-chrome": "chromium",
	firefox: "firefox",
} as const;

export type NavigatorBrowser =
	(typeof NAVIGATOR_BROWSER_ALIASES)[keyof typeof NAVIGATOR_BROWSER_ALIASES];
export type BrowserSource = "option" | "env";

export type ResolveBrowserInput = {
	browser?: string;
	env?: NodeJS.ProcessEnv;
	envVar?: string;
};

export type ResolvedNavigatorBrowser = {
	browser: NavigatorBrowser;
	source: BrowserSource;
	raw: string;
	envVar: string;
};

const normalize = (value?: string): string | undefined => {
	if (value === undefined) {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed === "" ? undefined : trimmed;
};

export const parseNavigatorBrowser = (value: string): NavigatorBrowser => {
	const normalized = value.trim().toLowerCase();
	const parsed =
		NAVIGATOR_BROWSER_ALIASES[
			normalized as keyof typeof NAVIGATOR_BROWSER_ALIASES
		];
	if (parsed !== undefined) {
		return parsed;
	}
	throw new Error(
		`Invalid browser selection: ${value}. Use chromium or firefox.`,
	);
};

export const readNavigatorBrowserValue = ({
	browser,
	env = process.env,
	envVar = NAVIGATOR_BROWSER_ENV,
}: ResolveBrowserInput): string | undefined => {
	const fromOption = normalize(browser);
	if (fromOption !== undefined) {
		return fromOption;
	}
	return normalize(env[envVar]);
};

export const resolveNavigatorBrowser = ({
	browser,
	env = process.env,
	envVar = NAVIGATOR_BROWSER_ENV,
}: ResolveBrowserInput): ResolvedNavigatorBrowser | null => {
	const fromOption = normalize(browser);
	if (fromOption !== undefined) {
		return {
			browser: parseNavigatorBrowser(fromOption),
			source: "option",
			raw: fromOption,
			envVar,
		};
	}

	const fromEnv = normalize(env[envVar]);
	if (fromEnv === undefined) {
		return null;
	}
	return {
		browser: parseNavigatorBrowser(fromEnv),
		source: "env",
		raw: fromEnv,
		envVar,
	};
};
