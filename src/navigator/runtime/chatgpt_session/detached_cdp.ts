import fs from "node:fs";
import path from "node:path";
import type { RuntimeBrowser } from "./types";
import { isWslWindowsBrowserPath } from "./browser_resolution";
import { wslPathToWindowsPath } from "./wsl_windows_host";
import { launchSpawnedBrowserViaCdp } from "./external_browser_process";

const WINDOWS_DRIVE_PATH = /^[A-Za-z]:[\\/]/;
const WINDOWS_UNC_PATH = /^\\\\/;

const isWindowsPath = (value: string): boolean =>
	WINDOWS_DRIVE_PATH.test(value) || WINDOWS_UNC_PATH.test(value);

export const resolveDetachedLaunchUserDataDir = ({
	chromiumBin,
	userDataDir,
}: {
	chromiumBin: string;
	userDataDir: string;
}): {
	launchUserDataDir: string;
	createDirPath?: string;
} => {
	const normalizedUserDataDir = isWindowsPath(userDataDir)
		? userDataDir.trim()
		: path.resolve(userDataDir);

	if (isWslWindowsBrowserPath({ chromiumBin })) {
		return {
			launchUserDataDir: wslPathToWindowsPath({
				wslPath: normalizedUserDataDir,
			}),
			createDirPath: isWindowsPath(normalizedUserDataDir)
				? undefined
				: normalizedUserDataDir,
		};
	}

	return {
		launchUserDataDir: normalizedUserDataDir,
		createDirPath: isWindowsPath(normalizedUserDataDir)
			? undefined
			: normalizedUserDataDir,
	};
};

/**
 * Launches a detached browser process and returns its connected CDP browser.
 * The external browser remains alive after this process exits.
 */
export const launchDetachedBrowserViaCdp = async ({
	chromiumBin,
	userDataDir,
	headless,
	browserLaunchArgs,
	connectOverCDP,
}: {
	chromiumBin: string;
	userDataDir: string;
	headless: boolean;
	browserLaunchArgs: readonly string[];
	connectOverCDP: (cdpUrl: string) => Promise<RuntimeBrowser>;
}): Promise<{
	browser: RuntimeBrowser;
	cdpUrl: string;
}> => {
	const resolvedUserDataDir = resolveDetachedLaunchUserDataDir({
		chromiumBin,
		userDataDir,
	});
	if (resolvedUserDataDir.createDirPath !== undefined) {
		fs.mkdirSync(resolvedUserDataDir.createDirPath, {
			recursive: true,
		});
	}

	const launched = await launchSpawnedBrowserViaCdp({
		chromiumBin,
		launchArgs: [
			"--remote-debugging-port=0",
			`--user-data-dir=${resolvedUserDataDir.launchUserDataDir}`,
			...browserLaunchArgs,
			...(headless ? ["--headless=new"] : []),
			"about:blank",
		],
		detached: true,
		connectOverCDP,
	});

	return {
		browser: launched.browser,
		cdpUrl: launched.cdpUrl,
	};
};
