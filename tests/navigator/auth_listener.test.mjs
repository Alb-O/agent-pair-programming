import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { WebSocket } = require("ws");
const {
	createAuthListener,
} = require("../../dist/navigator/auth_export/listener.js");

const waitForOpen = (socket) =>
	new Promise((resolve, reject) => {
		const onOpen = () => {
			cleanup();
			resolve();
		};
		const onError = (error) => {
			cleanup();
			reject(error);
		};
		const cleanup = () => {
			socket.off("open", onOpen);
			socket.off("error", onError);
		};
		socket.on("open", onOpen);
		socket.on("error", onError);
	});

const waitForMessage = (socket) =>
	new Promise((resolve, reject) => {
		const onMessage = (raw) => {
			cleanup();
			resolve(JSON.parse(String(raw)));
		};
		const onError = (error) => {
			cleanup();
			reject(error);
		};
		const cleanup = () => {
			socket.off("message", onMessage);
			socket.off("error", onError);
		};
		socket.on("message", onMessage);
		socket.on("error", onError);
	});

test("auth listener rejects invalid token", async () => {
	const authDir = fs.mkdtempSync(path.join(os.tmpdir(), "pp-auth-listen-"));
	const listener = await createAuthListener({
		host: "127.0.0.1",
		port: 0,
		authDir,
		token: "expected-token",
		version: "test-version",
	});

	try {
		const socket = new WebSocket(listener.url);
		await waitForOpen(socket);
		socket.send(JSON.stringify({ type: "hello", token: "wrong-token" }));
		const response = await waitForMessage(socket);

		assert.equal(response.type, "rejected");
		assert.match(response.reason, /Invalid token/);
		socket.close();
	} finally {
		await listener.close();
		fs.rmSync(authDir, { recursive: true, force: true });
	}
});

test("auth listener saves pushed cookies as storage state files", async () => {
	const authDir = fs.mkdtempSync(path.join(os.tmpdir(), "pp-auth-listen-"));
	const listener = await createAuthListener({
		host: "127.0.0.1",
		port: 0,
		authDir,
		token: "valid-token",
		version: "test-version",
	});

	try {
		const socket = new WebSocket(listener.url);
		await waitForOpen(socket);

		socket.send(JSON.stringify({ type: "hello", token: "valid-token" }));
		const welcome = await waitForMessage(socket);
		assert.equal(welcome.type, "welcome");
		assert.equal(welcome.version, "test-version");

		socket.send(
			JSON.stringify({
				type: "push_cookies",
				domains: [
					{
						domain: "chatgpt.com",
						cookies: [
							{
								name: "__Secure-next-auth.session-token",
								value: "abc",
								domain: ".chatgpt.com",
								path: "/",
								httpOnly: true,
								secure: true,
								sameSite: "lax",
								hostOnly: false,
							},
						],
					},
				],
			}),
		);
		const received = await waitForMessage(socket);
		assert.equal(received.type, "received");
		assert.equal(received.domains_saved, 1);
		assert.equal(received.paths.length, 1);

		const writtenPath = received.paths[0];
		assert.equal(fs.existsSync(writtenPath), true);

		const payload = JSON.parse(fs.readFileSync(writtenPath, "utf8"));
		assert.equal(Array.isArray(payload.cookies), true);
		assert.equal(payload.cookies.length, 1);
		assert.equal(payload.cookies[0].name, "__Secure-next-auth.session-token");
		assert.equal(payload.cookies[0].domain, ".chatgpt.com");
		assert.equal(payload.cookies[0].sameSite, "Lax");
		assert.equal(Array.isArray(payload.origins), true);
		assert.equal(payload.origins.length, 0);

		socket.close();
	} finally {
		await listener.close();
		fs.rmSync(authDir, { recursive: true, force: true });
	}
});
