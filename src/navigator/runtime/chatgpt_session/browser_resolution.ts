import fs from "node:fs";
import path from "node:path";
import type { NavigatorBrowser } from "./browser_env";

const WINDOWS_MOUNTED_EXECUTABLE = /^\/mnt\/[a-z]\//i;

export const COMPATIBLE_CHROMIUM_BINARIES = [
	"helium",
	"chromium",
	"chromium-browser",
	"google-chrome",
	"google-chrome-stable",
	"brave-browser",
	"brave",
	"microsoft-edge",
	"microsoft-edge-stable",
	"msedge",
	"vivaldi",
] as const;

export const COMPATIBLE_FIREFOX_BINARIES = [
	"firefox",
	"firefox-esr",
] as const;

export const WSL_WINDOWS_BROWSER_CANDIDATES = [
	"/mnt/c/Program Files/Google/Chrome/Application/chrome.exe",
	"/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe",
	"/mnt/c/Program Files/Microsoft/Edge/Application/msedge.exe",
	"/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
	"/mnt/c/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe",
	"/mnt/c/Program Files (x86)/BraveSoftware/Brave-Browser/Application/brave.exe",
] as const;

export type IsWslOptions = {
	osRelease?: string;
	wslDistroName?: string;
};

export type DetectChromiumBinOptions = {
	envPath?: string;
	candidates?: readonly string[];
	isWsl?: boolean;
	wslWindowsCandidates?: readonly string[];
	preferWindowsHostOnWsl?: boolean;
};

export type DetectFirefoxBinOptions = {
	envPath?: string;
	candidates?: readonly string[];
	nixPlaywrightBrowserRoots?: readonly string[];
};

const isNonEmpty = (value?: string): value is string =>
	value !== undefined && value.trim() !== "";

const readKernelOsRelease = (): string =>
	fs.readFileSync("/proc/sys/kernel/osrelease", "utf8");

export const isWsl = ({
	osRelease = (() => {
		try {
			return readKernelOsRelease();
		} catch {
			return "";
		}
	})(),
	wslDistroName = process.env.WSL_DISTRO_NAME,
}: IsWslOptions = {}): boolean => {
	if (isNonEmpty(wslDistroName)) {
		return true;
	}
	const normalized = osRelease.toLowerCase();
	return normalized.includes("microsoft") || normalized.includes("wsl");
};

const pathEntries = (envPath: string): string[] =>
	envPath
		.split(path.delimiter)
		.map((entry) => entry.trim())
		.filter((entry) => entry !== "");

const executableExtensions = (): string[] => {
	if (process.platform !== "win32") {
		return [""];
	}
	const fromEnv = (process.env.PATHEXT ?? "")
		.split(";")
		.map((entry) => entry.trim().toLowerCase())
		.filter((entry) => entry !== "");
	if (fromEnv.length > 0) {
		return fromEnv;
	}
	return [".exe", ".cmd", ".bat"];
};

const isRegularFile = (filePath: string): boolean => {
	try {
		return fs.statSync(filePath).isFile();
	} catch {
		return false;
	}
};

const isExecutableFile = (filePath: string): boolean => {
	try {
		if (!isRegularFile(filePath)) {
			return false;
		}
		fs.accessSync(filePath, fs.constants.X_OK);
		return true;
	} catch {
		return false;
	}
};

const hasPathSeparator = (value: string): boolean =>
	value.includes("/") || value.includes("\\");

type BrowserCandidateSource = "default" | "wsl-host";

const PLAYWRIGHT_BROWSERS_STORE_SUFFIX = "-playwright-browsers";
const PLAYWRIGHT_FIREFOX_STORE_SUFFIX = "-playwright-firefox";

const parsePlaywrightBrowserRevision = (
	entryName: string,
	prefix: string,
): number => {
	const raw = entryName.slice(prefix.length);
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) ? parsed : -1;
};

const sortByPlaywrightRevisionDesc = (
	entries: readonly string[],
	prefix: string,
): string[] =>
	[...entries].sort((left, right) => {
		const leftRevision = parsePlaywrightBrowserRevision(left, prefix);
		const rightRevision = parsePlaywrightBrowserRevision(right, prefix);
		if (leftRevision !== rightRevision) {
			return rightRevision - leftRevision;
		}
		return right.localeCompare(left);
	});

const resolvePlaywrightFirefoxExecutable = (rootDir: string): string | null => {
	const executableNames =
		process.platform === "win32"
			? ["firefox.exe"]
			: ["firefox", "firefox-bin"];
	const firefoxPrefix = "firefox-";
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(rootDir, { withFileTypes: true });
	} catch {
		return null;
	}
	const firefoxEntries = sortByPlaywrightRevisionDesc(
		entries
			.filter(
				(entry) =>
					entry.isDirectory() &&
					entry.name.startsWith(firefoxPrefix) &&
					entry.name.length > firefoxPrefix.length,
			)
			.map((entry) => entry.name),
		firefoxPrefix,
	);
	for (const firefoxEntry of firefoxEntries) {
		for (const executableName of executableNames) {
			const resolved = path.resolve(
				rootDir,
				firefoxEntry,
				"firefox",
				executableName,
			);
			if (isExecutableFile(resolved)) {
				return resolved;
			}
		}
	}
	return null;
};

const resolveFirefoxExecutableFromStorePackage = (
	packageRoot: string,
): string | null => {
	const executableNames =
		process.platform === "win32"
			? ["firefox.exe"]
			: ["firefox", "firefox-bin"];
	for (const executableName of executableNames) {
		const resolved = path.resolve(packageRoot, "firefox", executableName);
		if (isExecutableFile(resolved)) {
			return resolved;
		}
	}
	return null;
};

const defaultPlaywrightBrowserRoots = ({
	env = process.env,
	homeDir = process.env.HOME,
}: {
	env?: NodeJS.ProcessEnv;
	homeDir?: string;
} = {}): string[] => {
	const roots: string[] = [];
	const fromEnv = env.PLAYWRIGHT_BROWSERS_PATH;
	if (isNonEmpty(fromEnv) && fromEnv !== "0") {
		roots.push(path.resolve(fromEnv));
	}
	if (process.platform === "linux") {
		roots.push("/run/current-system/sw/share/playwright-browsers");
		if (isNonEmpty(env.USER)) {
			roots.push(
				path.resolve(`/etc/profiles/per-user/${env.USER}/share/playwright-browsers`),
			);
		}
		if (isNonEmpty(homeDir)) {
			roots.push(path.resolve(homeDir, ".nix-profile", "share", "playwright-browsers"));
		}
		roots.push("/nix/store");
	}
	return Array.from(new Set(roots));
};

export const detectNixPlaywrightFirefoxBin = ({
	roots = defaultPlaywrightBrowserRoots(),
}: {
	roots?: readonly string[];
} = {}): string | null => {
	for (const root of roots) {
		const normalized = root.trim();
		if (normalized === "") {
			continue;
		}
		const resolved = path.resolve(normalized);
		if (resolved.endsWith(PLAYWRIGHT_BROWSERS_STORE_SUFFIX)) {
			const fromBrowsersStore = resolvePlaywrightFirefoxExecutable(resolved);
			if (fromBrowsersStore !== null) {
				return fromBrowsersStore;
			}
			continue;
		}
		if (resolved.endsWith(PLAYWRIGHT_FIREFOX_STORE_SUFFIX)) {
			const fromFirefoxStore = resolveFirefoxExecutableFromStorePackage(resolved);
			if (fromFirefoxStore !== null) {
				return fromFirefoxStore;
			}
			continue;
		}
		if (resolved === "/nix/store") {
			let entries: fs.Dirent[];
			try {
				entries = fs.readdirSync(resolved, { withFileTypes: true });
			} catch {
				continue;
			}
			const browsersPackages = entries
				.filter(
					(entry) =>
						entry.isDirectory() &&
						entry.name.endsWith(PLAYWRIGHT_BROWSERS_STORE_SUFFIX),
				)
				.map((entry) => entry.name)
				.sort((left, right) => right.localeCompare(left));
			for (const packageName of browsersPackages) {
				const fromBrowsersStore = resolvePlaywrightFirefoxExecutable(
					path.resolve(resolved, packageName),
				);
				if (fromBrowsersStore !== null) {
					return fromBrowsersStore;
				}
			}
			const firefoxPackages = entries
				.filter(
					(entry) =>
						entry.isDirectory() &&
						entry.name.endsWith(PLAYWRIGHT_FIREFOX_STORE_SUFFIX),
				)
				.map((entry) => entry.name)
				.sort((left, right) => right.localeCompare(left));
			for (const packageName of firefoxPackages) {
				const fromFirefoxStore = resolveFirefoxExecutableFromStorePackage(
					path.resolve(resolved, packageName),
				);
				if (fromFirefoxStore !== null) {
					return fromFirefoxStore;
				}
			}
			continue;
		}
		const fromBrowsersRoot = resolvePlaywrightFirefoxExecutable(resolved);
		if (fromBrowsersRoot !== null) {
			return fromBrowsersRoot;
		}
	}
	return null;
};

const detectBrowserBin = ({
	envPath,
	defaultCandidates,
	wslHostCandidates = [],
	isWslInput,
}: {
	envPath: string;
	defaultCandidates: readonly string[];
	wslHostCandidates?: readonly string[];
	isWslInput: boolean;
}): string | null => {
	const fromDefaults = defaultCandidates
		.map((candidate) => candidate.trim())
		.filter((candidate) => candidate !== "")
		.map((candidate) => ({
			value: candidate,
			source: "default" as const,
		}));

	const fromWslWindows = wslHostCandidates
		.map((candidate) => candidate.trim())
		.filter((candidate) => candidate !== "")
		.map((candidate) => ({
			value: candidate,
			source: "wsl-host" as const,
		}));

	const deduped = Array.from(
		new Set(
			[...fromWslWindows, ...fromDefaults].map((candidate) => candidate.value),
		),
	);
	const orderedCandidates = deduped.map((value) => ({
		value,
		source:
			fromWslWindows.find((candidate) => candidate.value === value) !== undefined
				? ("wsl-host" as BrowserCandidateSource)
				: ("default" as BrowserCandidateSource),
	}));

	for (const candidate of orderedCandidates) {
		if (hasPathSeparator(candidate.value)) {
			const resolved = path.resolve(candidate.value);
			if (
				(candidate.source === "wsl-host" && isWslInput && isRegularFile(resolved)) ||
				isExecutableFile(resolved)
			) {
				return resolved;
			}
			continue;
		}

		for (const dir of pathEntries(envPath)) {
			for (const extension of executableExtensions()) {
				const resolved = path.join(dir, `${candidate.value}${extension}`);
				if (isExecutableFile(resolved)) {
					return resolved;
				}
			}
		}
	}

	return null;
};

export const isWslWindowsBrowserPath = ({
	chromiumBin,
	isWslInput = isWsl(),
}: {
	chromiumBin: string;
	isWslInput?: boolean;
}): boolean => {
	// WSL can execute mounted Windows .exe files but Playwright pipe transport
	// is not compatible with that cross-kernel launch path.
	if (!isWslInput) {
		return false;
	}
	const resolved = path.resolve(chromiumBin);
	return (
		WINDOWS_MOUNTED_EXECUTABLE.test(resolved) &&
		resolved.toLowerCase().endsWith(".exe")
	);
};

export const detectChromiumBin = ({
	envPath = process.env.PATH ?? "",
	candidates = COMPATIBLE_CHROMIUM_BINARIES,
	isWsl: isWslInput = isWsl(),
	wslWindowsCandidates = WSL_WINDOWS_BROWSER_CANDIDATES,
	preferWindowsHostOnWsl = true,
}: DetectChromiumBinOptions = {}): string | null => {
	return detectBrowserBin({
		envPath,
		defaultCandidates: candidates,
		wslHostCandidates:
			preferWindowsHostOnWsl && isWslInput ? wslWindowsCandidates : [],
		isWslInput,
	});
};

export const detectFirefoxBin = ({
	envPath = process.env.PATH ?? "",
	candidates = COMPATIBLE_FIREFOX_BINARIES,
	nixPlaywrightBrowserRoots = defaultPlaywrightBrowserRoots(),
}: DetectFirefoxBinOptions = {}): string | null =>
	detectNixPlaywrightFirefoxBin({ roots: nixPlaywrightBrowserRoots }) ??
	detectBrowserBin({
		envPath,
		defaultCandidates: candidates,
		isWslInput: isWsl(),
	});

export const requireChromiumBin = (chromiumBin?: string): string => {
	if (isNonEmpty(chromiumBin)) {
		return chromiumBin;
	}
	const detected = detectChromiumBin();
	if (detected !== null) {
		return detected;
	}
	const wslHint = isWsl()
		? " and common Windows host browser paths under /mnt/c"
		: "";
	throw new Error(
		`chromium binary path is required when cdpUrl is not provided and no compatible browser was found in PATH${wslHint}. Tried: ${COMPATIBLE_CHROMIUM_BINARIES.join(", ")}. Pass --chromium-bin <path> to override.`,
	);
};

export const requireFirefoxBin = (firefoxBin?: string): string => {
	if (isNonEmpty(firefoxBin)) {
		return firefoxBin;
	}
	const detected = detectFirefoxBin();
	if (detected !== null) {
		return detected;
	}
	throw new Error(
		`firefox binary path is required when browser=firefox and no compatible browser was found in PATH. Tried: ${COMPATIBLE_FIREFOX_BINARIES.join(", ")}. Pass --chromium-bin <path> to override.`,
	);
};

export const requireBrowserBin = ({
	browser,
	browserBin,
}: {
	browser: NavigatorBrowser;
	browserBin?: string;
}): string =>
	browser === "firefox"
		? requireFirefoxBin(browserBin)
		: requireChromiumBin(browserBin);
