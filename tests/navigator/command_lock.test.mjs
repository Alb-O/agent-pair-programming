import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
	acquirePpCommandLock,
	releasePpCommandLock,
} = require("../../dist/navigator/runtime/command_lock.js");

const withTempDir = async (fn) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pp-command-lock-"));
	try {
		await fn(dir);
	} finally {
		fs.rmSync(dir, {
			recursive: true,
			force: true,
		});
	}
};

const lockPathFor = (dir) => path.join(dir, "pp-command.lock");

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const payload = (overrides = {}) => ({
	pid: process.pid,
	token: "existing-token",
	command: "navigator:wait",
	startedAtIso: new Date().toISOString(),
	...overrides,
});

const deadPid = async () => {
	const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 10000)"], {
		stdio: "ignore",
	});
	assert.equal(typeof child.pid, "number");
	const pid = child.pid;
	child.kill("SIGKILL");
	await once(child, "exit");
	return pid;
};

const waitForExit = async (child) => {
	if (child.exitCode !== null || child.signalCode !== null) {
		return;
	}
	await once(child, "exit");
};

test("acquirePpCommandLock succeeds when no lock exists", async () => {
	await withTempDir(async (dir) => {
		const lockPath = lockPathFor(dir);
		const lock = acquirePpCommandLock({
			command: "navigator:wait",
			lockPath,
		});

		assert.equal(lock.lockPath, path.resolve(lockPath));
		assert.equal(typeof lock.token, "string");
		assert.equal(lock.token.length > 0, true);
		assert.equal(fs.existsSync(lockPath), true);

		releasePpCommandLock(lock);
	});
});

test("acquirePpCommandLock throws when lock holder pid is alive", async () => {
	await withTempDir(async (dir) => {
		const lockPath = lockPathFor(dir);
		fs.writeFileSync(lockPath, JSON.stringify(payload()), "utf8");

		assert.throws(
			() =>
				acquirePpCommandLock({
					command: "navigator:send",
					lockPath,
				}),
			(error) => {
				assert.equal(error instanceof Error, true);
				assert.match(error.message, /another pp command is running/);
				assert.match(
					error.message,
					new RegExp(`lock: ${escapeRegExp(path.resolve(lockPath))}`),
				);
				return true;
			},
		);
	});
});

test("acquirePpCommandLock prunes stale lock when pid is dead", async () => {
	await withTempDir(async (dir) => {
		const lockPath = lockPathFor(dir);
		fs.writeFileSync(
			lockPath,
			JSON.stringify(
				payload({
					pid: await deadPid(),
				}),
			),
			"utf8",
		);

		const lock = acquirePpCommandLock({
			command: "navigator:wait",
			lockPath,
		});
		assert.equal(fs.existsSync(lockPath), true);
		const onDisk = JSON.parse(fs.readFileSync(lockPath, "utf8"));
		assert.equal(onDisk.token, lock.token);
		releasePpCommandLock(lock);
	});
});

test("acquirePpCommandLock prunes old corrupt lock files", async () => {
	await withTempDir(async (dir) => {
		const lockPath = lockPathFor(dir);
		fs.writeFileSync(lockPath, "{", "utf8");
		const oldTime = new Date(Date.now() - 60_000);
		fs.utimesSync(lockPath, oldTime, oldTime);

		const lock = acquirePpCommandLock({
			command: "navigator:wait",
			lockPath,
		});

		assert.equal(fs.existsSync(lockPath), true);
		releasePpCommandLock(lock);
	});
});

test("acquirePpCommandLock waits through empty lock initialization grace", async () => {
	await withTempDir(async (dir) => {
		const lockPath = lockPathFor(dir);
		fs.closeSync(fs.openSync(lockPath, "w"));

		const child = spawn(
			process.execPath,
			[
				"-e",
				[
					"const fs=require('node:fs');",
					"const lockPath=process.argv[1];",
					"const lockPayload={",
					"pid:process.pid,",
					"token:'child-token',",
					"command:'navigator:wait',",
					"startedAtIso:new Date().toISOString()",
					"};",
					"setTimeout(()=>{",
					"fs.writeFileSync(lockPath, JSON.stringify(lockPayload), 'utf8');",
					"},20);",
					"setTimeout(()=>process.exit(0),500);",
				].join(""),
				lockPath,
			],
			{
				stdio: "ignore",
			},
		);

		try {
			assert.throws(
				() =>
					acquirePpCommandLock({
						command: "navigator:send",
						lockPath,
					}),
				(error) => {
					assert.equal(error instanceof Error, true);
					assert.match(error.message, /another pp command is running/);
					assert.match(
						error.message,
						new RegExp(`lock: ${escapeRegExp(path.resolve(lockPath))}`),
					);
					return true;
				},
			);
		} finally {
			if (child.exitCode === null && child.signalCode === null) {
				child.kill("SIGKILL");
			}
			await waitForExit(child);
		}
	});
});

test("releasePpCommandLock keeps lock when token does not match", async () => {
	await withTempDir(async (dir) => {
		const lockPath = lockPathFor(dir);
		const lock = acquirePpCommandLock({
			command: "navigator:wait",
			lockPath,
		});

		releasePpCommandLock({
			lockPath: lock.lockPath,
			token: "wrong-token",
		});
		assert.equal(fs.existsSync(lockPath), true);

		releasePpCommandLock(lock);
		assert.equal(fs.existsSync(lockPath), false);
	});
});
