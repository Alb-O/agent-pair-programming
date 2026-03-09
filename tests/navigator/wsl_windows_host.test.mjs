import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
	wslPathToWindowsPath,
} = require("../../dist/navigator/runtime/chatgpt_session/wsl_windows_host.js");

test("wslPathToWindowsPath converts mounted drive paths to windows drive syntax", () => {
	assert.equal(
		wslPathToWindowsPath({
			wslPath: "/mnt/d/work/pp-profile",
		}),
		"D:\\work\\pp-profile",
	);
});

test("wslPathToWindowsPath requires distro for non-mount linux paths", () => {
	assert.throws(
		() =>
			wslPathToWindowsPath({
				wslPath: "/home/albert/profile",
				distroName: "",
			}),
		/WSL_DISTRO_NAME is not set/,
	);
});
