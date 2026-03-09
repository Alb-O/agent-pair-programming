import fs from "node:fs";
import path from "node:path";
import { launchSpawnedBrowserViaCdp } from "./external_browser_process";
import type { RuntimeBrowser } from "./types";

const WINDOWS_DRIVE_PATH = /^[A-Za-z]:[\\/]/;
const WINDOWS_UNC_PATH = /^\\\\/;
const WSL_MOUNT_PATH = /^\/mnt\/([A-Za-z])(\/.*)?$/;

const isNonEmpty = (value?: string): value is string =>
	value !== undefined && value.trim() !== "";

const isWindowsPath = (value: string): boolean =>
	WINDOWS_DRIVE_PATH.test(value) || WINDOWS_UNC_PATH.test(value);

export const wslPathToWindowsPath = ({
	wslPath,
	distroName = process.env.WSL_DISTRO_NAME,
}: {
	wslPath: string;
	distroName?: string;
}): string => {
	const trimmed = wslPath.trim();
	if (trimmed === "") {
		throw new Error("WSL user-data-dir path cannot be empty");
	}

	if (isWindowsPath(trimmed)) {
		return trimmed.replace(/\//g, "\\");
	}

	const mountMatch = trimmed.match(WSL_MOUNT_PATH);
	if (mountMatch !== null) {
		const drive = mountMatch[1]?.toUpperCase();
		if (drive === undefined) {
			throw new Error(
				`failed to parse WSL mount drive from user-data-dir '${trimmed}'`,
			);
		}
		const rest = mountMatch[2] ?? "";
		return `${drive}:${rest.replace(/\//g, "\\")}`;
	}

	const absolute = path.resolve(trimmed);
	const uncTail = absolute.replace(/^\/+/, "").replace(/\//g, "\\");
	if (!isNonEmpty(distroName)) {
		throw new Error(
			`failed to convert WSL user-data-dir '${absolute}' to Windows path: WSL_DISTRO_NAME is not set`,
		);
	}
	return uncTail === ""
		? `\\\\wsl.localhost\\${distroName}`
		: `\\\\wsl.localhost\\${distroName}\\${uncTail}`;
};

export const launchWslWindowsBrowserViaCdp = async ({
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
	close: () => Promise<void>;
}> => {
	const normalizedUserDataDir = isWindowsPath(userDataDir)
		? userDataDir.trim()
		: path.resolve(userDataDir);
	if (!isWindowsPath(normalizedUserDataDir)) {
		fs.mkdirSync(normalizedUserDataDir, {
			recursive: true,
		});
	}
	const launchUserDataDir = wslPathToWindowsPath({
		wslPath: normalizedUserDataDir,
	});

	const launched = await launchSpawnedBrowserViaCdp({
		chromiumBin,
		launchArgs: [
			"--remote-debugging-port=0",
			`--user-data-dir=${launchUserDataDir}`,
			...browserLaunchArgs,
			...(headless ? ["--headless=new"] : []),
			"about:blank",
		],
		detached: false,
		connectOverCDP,
	});

	return {
		browser: launched.browser,
		close: async () => {
			try {
				// For externally launched browsers, browser.close() can only drop
				// the CDP connection. Browser.close requests real process shutdown.
				if (launched.browser.newBrowserCDPSession !== undefined) {
					const session = await launched.browser.newBrowserCDPSession();
					await session.send("Browser.close");
				} else {
					await launched.browser.close();
				}
			} finally {
				await launched.terminate();
			}
		},
	};
};
