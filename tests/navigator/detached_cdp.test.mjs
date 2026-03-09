import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
	resolveDetachedLaunchUserDataDir,
} = require("../../dist/navigator/runtime/chatgpt_session/detached_cdp.js");

test("resolveDetachedLaunchUserDataDir keeps linux paths for linux chromium", () => {
	const out = resolveDetachedLaunchUserDataDir({
		chromiumBin: "/usr/bin/chromium",
		userDataDir: "/tmp/pp-profile",
	});
	assert.deepEqual(out, {
		launchUserDataDir: "/tmp/pp-profile",
		createDirPath: "/tmp/pp-profile",
	});
});

test("resolveDetachedLaunchUserDataDir converts mounted WSL paths for windows-host chromium", () => {
	const previousDistro = process.env.WSL_DISTRO_NAME;
	process.env.WSL_DISTRO_NAME = "pp-test-distro";
	try {
		const out = resolveDetachedLaunchUserDataDir({
			chromiumBin: "/mnt/c/Program Files/Microsoft/Edge/Application/msedge.exe",
			userDataDir: "/mnt/d/work/pp-profile",
		});
		assert.deepEqual(out, {
			launchUserDataDir: "D:\\work\\pp-profile",
			createDirPath: "/mnt/d/work/pp-profile",
		});
	} finally {
		if (previousDistro === undefined) {
			delete process.env.WSL_DISTRO_NAME;
		} else {
			process.env.WSL_DISTRO_NAME = previousDistro;
		}
	}
});
