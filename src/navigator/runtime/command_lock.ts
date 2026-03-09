import fs from "node:fs";
import path from "node:path";
import { resolvePpRuntimeDir } from "./pp_state_paths";

/**
 * Cross-command lock coordination for pp runtime operations.
 *
 * Acquisition is atomic through wx creation. Existing locks are interpreted as:
 * active holder (fail fast with diagnostics) or stale/corrupt (self-heal and retry).
 * Release is token-gated so a later lock cannot be deleted by an earlier process.
 */
export type PpCommandLock = {
	lockPath: string;
	token: string;
};

type PpCommandLockPayload = {
	pid?: number;
	token?: string;
	command?: string;
	startedAtIso?: string;
};

const PP_COMMAND_LOCK_FILE = "pp-command.lock";
const LOCK_INIT_GRACE_MS = 250;
const CORRUPT_LOCK_STALE_MS = 2_000;
const LOCK_INIT_POLL_MS = 25;

const isNonEmpty = (value?: string): value is string =>
	value !== undefined && value.trim() !== "";

const resolveCommandLockPath = (lockPath?: string): string =>
	isNonEmpty(lockPath)
		? path.resolve(lockPath)
		: path.resolve(resolvePpRuntimeDir(), PP_COMMAND_LOCK_FILE);

const processExists = (pid?: number): boolean => {
	if (pid === undefined || !Number.isInteger(pid) || pid <= 0) {
		return false;
	}
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		const code =
			typeof error === "object" && error !== null && "code" in error
				? (error as { code?: string }).code
				: undefined;
		return code !== "ESRCH";
	}
};

const readCommandLockPayload = (
	lockPath: string,
): PpCommandLockPayload | null => {
	try {
		const raw = fs.readFileSync(lockPath, "utf8");
		const parsed = JSON.parse(raw) as unknown;
		if (typeof parsed !== "object" || parsed === null) {
			return null;
		}
		return parsed as PpCommandLockPayload;
	} catch {
		return null;
	}
};

const readLockMeta = (
	lockPath: string,
): { size: number; ageMs: number } | undefined => {
	try {
		const stats = fs.statSync(lockPath);
		return {
			size: stats.size,
			ageMs: Math.max(0, Date.now() - stats.mtimeMs),
		};
	} catch {
		return undefined;
	}
};

const pruneStaleLock = (lockPath: string): void => {
	const stalePath = `${lockPath}.stale.${Date.now()}`;
	try {
		fs.renameSync(lockPath, stalePath);
		return;
	} catch {
		// noop
	}
	try {
		fs.rmSync(lockPath, {
			force: true,
		});
	} catch {
		// noop
	}
};

const sleepSync = (delayMs: number): void => {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
};

const activeLockError = ({
	lockPath,
	payload,
}: {
	lockPath: string;
	payload: PpCommandLockPayload;
}): Error => {
	const pidLabel =
		payload.pid !== undefined && Number.isInteger(payload.pid) && payload.pid > 0
			? String(payload.pid)
			: "unknown";
	const commandLabel = isNonEmpty(payload.command)
		? ` (${payload.command})`
		: "";
	const startedLabel = isNonEmpty(payload.startedAtIso)
		? `, started ${payload.startedAtIso}`
		: "";
	return new Error(
		`another pp command is running (pid ${pidLabel}${commandLabel}${startedLabel}); lock: ${lockPath}`,
	);
};

const unreadableLockError = ({
	lockPath,
	meta,
}: {
	lockPath: string;
	meta?: { size: number; ageMs: number };
}): Error => {
	const details =
		meta === undefined
			? "unreadable lock file"
			: `unreadable lock file (size ${meta.size}, age ${Math.floor(meta.ageMs)}ms)`;
	return new Error(
		`another pp command is running (${details}); lock: ${lockPath}`,
	);
};

export const releasePpCommandLock = ({
	lockPath,
	token,
}: PpCommandLock): void => {
	const payload = readCommandLockPayload(lockPath);
	if (payload?.token !== token) {
		return;
	}
	try {
		fs.rmSync(lockPath, {
			force: true,
		});
	} catch {
		// noop
	}
};

export const acquirePpCommandLock = ({
	command,
	lockPath,
}: {
	command: string;
	lockPath?: string;
}): PpCommandLock => {
	const resolvedLockPath = resolveCommandLockPath(lockPath);
	const initDeadlineMs = Date.now() + LOCK_INIT_GRACE_MS;
	const token = `${process.pid}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
	const payload: PpCommandLockPayload = {
		pid: process.pid,
		token,
		command,
		startedAtIso: new Date().toISOString(),
	};

	fs.mkdirSync(path.dirname(resolvedLockPath), {
		recursive: true,
	});

	while (true) {
		try {
			const handle = fs.openSync(resolvedLockPath, "wx");
			try {
				fs.writeFileSync(handle, JSON.stringify(payload));
			} finally {
				fs.closeSync(handle);
			}
			return {
				lockPath: resolvedLockPath,
				token,
			};
		} catch (error) {
			const code =
				typeof error === "object" && error !== null && "code" in error
					? (error as { code?: string }).code
					: undefined;
			if (code !== "EEXIST") {
				throw error;
			}

			const existing = readCommandLockPayload(resolvedLockPath);
			if (existing === null) {
				const meta = readLockMeta(resolvedLockPath);
				if (meta === undefined) {
					if (Date.now() < initDeadlineMs) {
						sleepSync(LOCK_INIT_POLL_MS);
						continue;
					}
					throw unreadableLockError({
						lockPath: resolvedLockPath,
					});
				}
				if (meta.size === 0 && meta.ageMs <= LOCK_INIT_GRACE_MS) {
					if (Date.now() < initDeadlineMs) {
						sleepSync(LOCK_INIT_POLL_MS);
						continue;
					}
					throw unreadableLockError({
						lockPath: resolvedLockPath,
						meta,
					});
				}
				if (meta.ageMs >= CORRUPT_LOCK_STALE_MS) {
					pruneStaleLock(resolvedLockPath);
					continue;
				}
				throw unreadableLockError({
					lockPath: resolvedLockPath,
					meta,
				});
			}

			if (!processExists(existing.pid)) {
				pruneStaleLock(resolvedLockPath);
				continue;
			}

			throw activeLockError({
				lockPath: resolvedLockPath,
				payload: existing,
			});
		}
	}
};
