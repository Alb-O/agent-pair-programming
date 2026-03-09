import { spawn } from "node:child_process";
import path from "node:path";
import type { RuntimeBrowser } from "./types";

const CDP_POLL_INTERVAL_MS = 100;
const CDP_READY_TIMEOUT_MS = 30_000;
const PROCESS_SHUTDOWN_TIMEOUT_MS = 1_000;
const TASKKILL_EXE = "/mnt/c/Windows/System32/taskkill.exe";

const delay = (ms: number): Promise<void> =>
	new Promise((resolve) => {
		setTimeout(resolve, ms);
	});

const isWindowsHostExecutable = (chromiumBin: string): boolean => {
	const resolved = path.resolve(chromiumBin).toLowerCase();
	return resolved.startsWith("/mnt/") && resolved.endsWith(".exe");
};

export const killWindowsProcessTree = async (pid: number): Promise<void> => {
	// When a Windows browser is launched from WSL, killing the Linux wrapper pid
	// is not enough. Terminate the native process tree explicitly.
	await new Promise<void>((resolve) => {
		const killer = spawn(TASKKILL_EXE, ["/PID", `${pid}`, "/T", "/F"], {
			stdio: "ignore",
		});
		killer.once("error", () => {
			resolve();
		});
		killer.once("exit", () => {
			resolve();
		});
	});
};

const terminateAttachedProcess = async (
	processHandle: ReturnType<typeof spawn>,
): Promise<void> => {
	if (processHandle.exitCode !== null || processHandle.signalCode !== null) {
		return;
	}

	const waitForExit = new Promise<void>((resolve) => {
		processHandle.once("exit", () => {
			resolve();
		});
	});

	processHandle.kill("SIGTERM");
	await Promise.race([waitForExit, delay(PROCESS_SHUTDOWN_TIMEOUT_MS)]);

	if (processHandle.exitCode === null && processHandle.signalCode === null) {
		processHandle.kill("SIGKILL");
		await Promise.race([waitForExit, delay(PROCESS_SHUTDOWN_TIMEOUT_MS)]);
	}
};

const terminateDetachedProcess = async (
	processHandle: ReturnType<typeof spawn>,
): Promise<void> => {
	const pid = processHandle.pid;
	if (pid === undefined) {
		return;
	}

	for (const signal of ["SIGTERM", "SIGKILL"] as const) {
		try {
			process.kill(-pid, signal);
		} catch {
			try {
				process.kill(pid, signal);
			} catch {}
		}
		await delay(250);
	}
};

const terminateProcessHandle = async ({
	processHandle,
	detached,
}: {
	processHandle: ReturnType<typeof spawn>;
	detached: boolean;
}): Promise<void> =>
	detached
		? terminateDetachedProcess(processHandle)
		: terminateAttachedProcess(processHandle);

const disposeProcessObservers = (
	processHandle: ReturnType<typeof spawn>,
	onStderrData: (chunk: string) => void,
	onExit: (code: number | null, signal: NodeJS.Signals | null) => void,
): void => {
	processHandle.stderr?.removeListener("data", onStderrData);
	processHandle.removeListener("exit", onExit);
	processHandle.stderr?.destroy();
};

export const launchSpawnedBrowserViaCdp = async ({
	chromiumBin,
	launchArgs,
	detached,
	connectOverCDP,
}: {
	chromiumBin: string;
	launchArgs: readonly string[];
	detached: boolean;
	connectOverCDP: (cdpUrl: string) => Promise<RuntimeBrowser>;
}): Promise<{
	browser: RuntimeBrowser;
	cdpUrl: string;
	terminate: () => Promise<void>;
}> => {
	const processHandle = spawn(chromiumBin, [...launchArgs], {
		detached,
		stdio: ["ignore", "ignore", "pipe"],
	});

	let stderrTail = "";
	let websocketEndpoint: string | undefined;
	let windowsBrowserPid: number | undefined;
	let exitState:
		| {
				code: number | null;
				signal: NodeJS.Signals | null;
		  }
		| undefined;

	const onStderrData = (chunk: string): void => {
		stderrTail = `${stderrTail}${chunk}`;
		if (stderrTail.length > 6_000) {
			stderrTail = stderrTail.slice(stderrTail.length - 6_000);
		}
		if (
			windowsBrowserPid === undefined &&
			isWindowsHostExecutable(chromiumBin)
		) {
			const pidMatch = stderrTail.match(/\[(\d+):\d+:/);
			if (pidMatch?.[1] !== undefined) {
				const parsed = Number.parseInt(pidMatch[1], 10);
				if (Number.isFinite(parsed)) {
					windowsBrowserPid = parsed;
				}
			}
		}
		const endpointMatch = stderrTail.match(
			/DevTools listening on (ws:\/\/[^\s]+)/,
		);
		// For --remote-debugging-port=0, this log line is the source of truth
		// for the websocket endpoint.
		if (endpointMatch?.[1] !== undefined) {
			websocketEndpoint = endpointMatch[1];
		}
	};

	const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
		exitState = { code, signal };
	};

	processHandle.stderr?.setEncoding("utf8");
	processHandle.stderr?.on("data", onStderrData);
	processHandle.on("exit", onExit);

	const terminate = async (): Promise<void> => {
		disposeProcessObservers(processHandle, onStderrData, onExit);
		if (windowsBrowserPid !== undefined) {
			await killWindowsProcessTree(windowsBrowserPid);
		}
		await terminateProcessHandle({
			processHandle,
			detached,
		});
	};

	const deadline = Date.now() + CDP_READY_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (exitState !== undefined) {
			await terminate();
			throw new Error(
				`browser exited before CDP was ready (code=${exitState.code ?? "null"}, signal=${exitState.signal ?? "null"}): ${stderrTail.trim()}`,
			);
		}

		if (websocketEndpoint !== undefined) {
			try {
				const browser = await connectOverCDP(websocketEndpoint);
				disposeProcessObservers(processHandle, onStderrData, onExit);
				if (detached) {
					processHandle.unref();
				}
				return {
					browser,
					cdpUrl: websocketEndpoint,
					terminate,
				};
			} catch {}
		}

		await delay(CDP_POLL_INTERVAL_MS);
	}

	await terminate();
	throw new Error(
		`timed out waiting for browser CDP endpoint: ${stderrTail.trim()}`,
	);
};
