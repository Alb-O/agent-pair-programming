let socket = null;
let serverUrl = null;
let authenticated = false;

const log = (line) => {
	console.log(`[pp-auth-export] ${line}`);
};

const statusMessage = () => ({
	type: "status",
	connected: socket !== null && socket.readyState === WebSocket.OPEN,
	authenticated,
	server: serverUrl,
});

const sendRuntimeMessage = (payload) => {
	try {
		chrome.runtime.sendMessage(payload, () => {
			void chrome.runtime.lastError;
		});
	} catch {
		// popup may not be open
	}
};

const updatePopupStatus = () => {
	sendRuntimeMessage(statusMessage());
};

const sendServerMessage = (payload) => {
	if (socket === null || socket.readyState !== WebSocket.OPEN) {
		throw new Error("Not connected to server");
	}
	socket.send(JSON.stringify(payload));
};

const partitionKeyToKeyPart = (partitionKey) => {
	if (partitionKey === undefined || partitionKey === null) {
		return "";
	}
	if (typeof partitionKey !== "object") {
		return String(partitionKey);
	}

	const topLevelSite =
		typeof partitionKey.topLevelSite === "string"
			? partitionKey.topLevelSite
			: "";
	const hasCrossSiteAncestor =
		partitionKey.hasCrossSiteAncestor === true ? "1" : "0";
	return `${topLevelSite}|${hasCrossSiteAncestor}`;
};

const dedupeCookies = (cookies) => {
	const seen = new Set();
	const unique = [];
	for (const cookie of cookies) {
		const storeId = typeof cookie.storeId === "string" ? cookie.storeId : "";
		const partitionKey = partitionKeyToKeyPart(cookie.partitionKey);
		const key = `${cookie.name}|${cookie.domain}|${cookie.path}|${storeId}|${partitionKey}`;
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		unique.push(cookie);
	}
	return unique;
};

const hasNonEmptyCookieValue = (cookie) =>
	typeof cookie.value === "string" && cookie.value.trim() !== "";

const fetchCookiesForDomain = async (domain) => {
	const direct = await chrome.cookies.getAll({ domain });
	const dotted = await chrome.cookies.getAll({ domain: `.${domain}` });
	const deduped = dedupeCookies([...direct, ...dotted]);
	const valid = deduped.filter((cookie) => hasNonEmptyCookieValue(cookie));
	const filteredCount = deduped.length - valid.length;
	if (filteredCount > 0) {
		log(`Skipping ${filteredCount} empty-value cookie(s) for ${domain}`);
	}

	return valid.map((cookie) => ({
		name: cookie.name,
		value: cookie.value,
		domain: cookie.domain,
		path: cookie.path,
		expirationDate: cookie.expirationDate,
		httpOnly: cookie.httpOnly,
		secure: cookie.secure,
		sameSite: cookie.sameSite ?? "unspecified",
		hostOnly: cookie.hostOnly,
		storeId: cookie.storeId,
	}));
};

const disconnect = () => {
	if (socket !== null) {
		try {
			socket.close();
		} catch {
			// ignore close failures
		}
	}
	socket = null;
	serverUrl = null;
	authenticated = false;
	updatePopupStatus();
};

const connect = (url, token) => {
	disconnect();

	serverUrl = url;
	authenticated = false;

	try {
		socket = new WebSocket(url);
	} catch (error) {
		disconnect();
		return {
			type: "error",
			message: `Failed to connect: ${error instanceof Error ? error.message : String(error)}`,
		};
	}

	socket.onopen = () => {
		log("Connected, sending hello");
		try {
			sendServerMessage({
				type: "hello",
				token,
			});
		} catch (error) {
			log(
				`Failed to send hello: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
		updatePopupStatus();
	};

	socket.onmessage = (event) => {
		let message;
		try {
			message = JSON.parse(String(event.data));
		} catch {
			log("Invalid server message JSON");
			return;
		}

		switch (message.type) {
			case "welcome":
				authenticated = true;
				updatePopupStatus();
				break;
			case "rejected":
				authenticated = false;
				sendRuntimeMessage({
					type: "error",
					message: message.reason ?? "Authentication rejected",
				});
				disconnect();
				break;
			case "received":
				sendRuntimeMessage({
					type: "export_result",
					success: true,
					domains_saved: message.domains_saved ?? 0,
					paths: Array.isArray(message.paths) ? message.paths : [],
				});
				break;
			case "error":
				sendRuntimeMessage({
					type: "error",
					message: message.message ?? "Server error",
				});
				break;
			default:
				log(`Unhandled message type: ${String(message.type ?? "")}`);
		}
	};

	socket.onerror = () => {
		log("WebSocket error");
		authenticated = false;
		updatePopupStatus();
	};

	socket.onclose = () => {
		log("WebSocket closed");
		socket = null;
		authenticated = false;
		updatePopupStatus();
	};

	return statusMessage();
};

const exportCookies = async (domains) => {
	if (socket === null || socket.readyState !== WebSocket.OPEN) {
		return {
			type: "error",
			message: "Not connected to server",
		};
	}
	if (!authenticated) {
		return {
			type: "error",
			message: "Not authenticated",
		};
	}

	const domainPayload = [];
	for (const domain of domains) {
		try {
			const cookies = await fetchCookiesForDomain(domain);
			if (cookies.length > 0) {
				domainPayload.push({
					domain,
					cookies,
				});
			}
		} catch (error) {
			log(
				`Failed to fetch cookies for ${domain}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	if (domainPayload.length === 0) {
		return {
			type: "error",
			message: "No cookies found for any domain",
		};
	}

	sendServerMessage({
		type: "push_cookies",
		domains: domainPayload,
	});
	return statusMessage();
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	const run = async () => {
		if (message?.type === "get_status") {
			return statusMessage();
		}

		if (message?.type === "connect") {
			const server =
				typeof message.server === "string" ? message.server.trim() : "";
			const token =
				typeof message.token === "string" ? message.token.trim() : "";

			if (server === "" && token === "") {
				disconnect();
				return statusMessage();
			}

			if (server === "") {
				return {
					type: "error",
					message: "Server URL is required",
				};
			}
			if (token === "") {
				return {
					type: "error",
					message: "Token is required",
				};
			}

			return connect(server, token);
		}

		if (message?.type === "export") {
			const domains = Array.isArray(message.domains) ? message.domains : [];
			if (domains.length === 0) {
				return {
					type: "error",
					message: "No domains selected",
				};
			}
			return exportCookies(domains);
		}

		return {
			type: "error",
			message: "Unknown message type",
		};
	};

	run()
		.then((response) => {
			sendResponse(response);
		})
		.catch((error) => {
			sendResponse({
				type: "error",
				message: error instanceof Error ? error.message : String(error),
			});
		});

	return true;
});
