let domains = new Set();
let connected = false;
let authenticated = false;
let currentTabDomain = null;
let connectPending = false;

const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const serverInput = document.getElementById("serverInput");
const tokenInput = document.getElementById("tokenInput");
const connectBtn = document.getElementById("connectBtn");
const domainList = document.getElementById("domainList");
const newDomainInput = document.getElementById("newDomain");
const addDomainBtn = document.getElementById("addDomainBtn");
const exportBtn = document.getElementById("exportBtn");
const messageArea = document.getElementById("messageArea");

const extractDomain = (url) => {
	try {
		return new URL(url).hostname;
	} catch {
		return null;
	}
};

const saveDomains = () => {
	chrome.storage.local.set({
		pw_export_domains: [...domains],
	});
};

const saveServer = () => {
	chrome.storage.local.set({
		pw_export_server: serverInput.value,
	});
};

const showMessage = (type, text, paths) => {
	messageArea.innerHTML = "";
	const div = document.createElement("div");
	div.className = `message ${type}`;
	div.textContent = text;

	if (Array.isArray(paths) && paths.length > 0) {
		const pathsDiv = document.createElement("div");
		pathsDiv.className = "paths";
		pathsDiv.textContent = paths.join("\n");
		div.appendChild(pathsDiv);
	}

	messageArea.appendChild(div);
	if (type === "success") {
		setTimeout(() => div.remove(), 5000);
	}
};

const clearConnectingMessage = () => {
	const message = messageArea.querySelector(".message.info");
	if (
		message !== null &&
		typeof message.textContent === "string" &&
		message.textContent.startsWith("Connecting")
	) {
		messageArea.innerHTML = "";
	}
};

const updateStatus = (isConnected, isAuthenticated) => {
	connected = isConnected;
	authenticated = isAuthenticated;
	if (connectPending && (connected || authenticated)) {
		connectPending = false;
		clearConnectingMessage();
	}

	statusDot.className = "dot";
	if (authenticated) {
		statusDot.classList.add("authenticated");
		statusText.textContent = "Connected + authenticated";
		connectBtn.textContent = "Disconnect";
	} else if (connected) {
		statusDot.classList.add("connected");
		statusText.textContent = "Connected (awaiting auth)";
		connectBtn.textContent = "Disconnect";
	} else {
		statusText.textContent = "Not connected";
		connectBtn.textContent = "Connect";
	}

	exportBtn.disabled = !(authenticated && domains.size > 0);
};

const renderDomains = () => {
	domainList.innerHTML = "";
	if (domains.size === 0) {
		const empty = document.createElement("div");
		empty.style.color = "#8b96a7";
		empty.style.fontSize = "12px";
		empty.style.padding = "6px 0";
		empty.textContent = "No domains added";
		domainList.appendChild(empty);
		exportBtn.disabled = true;
		return;
	}

	for (const domain of domains) {
		const row = document.createElement("div");
		row.className = "domain-item";

		const checkbox = document.createElement("input");
		checkbox.type = "checkbox";
		checkbox.checked = true;
		checkbox.id = `domain-${domain}`;

		const label = document.createElement("label");
		label.htmlFor = checkbox.id;
		label.textContent = domain;

		const removeBtn = document.createElement("button");
		removeBtn.className = "secondary";
		removeBtn.textContent = "×";
		removeBtn.style.marginLeft = "auto";
		removeBtn.style.padding = "3px 8px";
		removeBtn.onclick = () => {
			domains.delete(domain);
			saveDomains();
			renderDomains();
		};

		row.appendChild(checkbox);
		row.appendChild(label);
		row.appendChild(removeBtn);
		domainList.appendChild(row);
	}

	exportBtn.disabled = !(authenticated && domains.size > 0);
};

const connect = () => {
	if (connected) {
		connectPending = false;
		chrome.runtime.sendMessage(
			{
				type: "connect",
				server: "",
				token: "",
			},
			() => {
				updateStatus(false, false);
			},
		);
		return;
	}

	const server = serverInput.value.trim();
	const token = tokenInput.value.trim();
	if (server === "") {
		showMessage("error", "Please enter server URL");
		return;
	}
	if (token === "") {
		showMessage("error", "Please enter token");
		return;
	}

	saveServer();
	showMessage("info", "Connecting...");
	connectPending = true;

	chrome.runtime.sendMessage(
		{
			type: "connect",
			server,
			token,
		},
		(response) => {
			if (chrome.runtime.lastError) {
				connectPending = false;
				showMessage(
					"error",
					chrome.runtime.lastError.message || "Connect failed",
				);
				return;
			}
			if (response?.type === "error") {
				connectPending = false;
				showMessage("error", response.message || "Connect failed");
				return;
			}
			updateStatus(
				Boolean(response?.connected),
				Boolean(response?.authenticated),
			);
		},
	);
};

const addDomain = () => {
	const typed = newDomainInput.value.trim().toLowerCase();
	const domain = typed === "" ? currentTabDomain : typed;
	if (domain === null || domain === "") {
		return;
	}
	if (!domain.includes(".") || domain.includes(" ")) {
		showMessage("error", "Invalid domain format");
		return;
	}
	domains.add(domain);
	newDomainInput.value = "";
	saveDomains();
	renderDomains();
};

const exportSelectedDomains = () => {
	const selected = [...domains].filter((domain) => {
		const checkbox = document.getElementById(`domain-${domain}`);
		return checkbox?.checked === true;
	});
	if (selected.length === 0) {
		showMessage("error", "No domains selected");
		return;
	}

	showMessage("info", `Exporting cookies for ${selected.length} domain(s)...`);
	chrome.runtime.sendMessage({
		type: "export",
		domains: selected,
	});
};

const init = async () => {
	const stored = await chrome.storage.local.get([
		"pw_export_domains",
		"pw_export_server",
	]);
	if (Array.isArray(stored.pw_export_domains)) {
		domains = new Set(stored.pw_export_domains);
	}
	if (
		typeof stored.pw_export_server === "string" &&
		stored.pw_export_server !== ""
	) {
		serverInput.value = stored.pw_export_server;
	}

	try {
		const [tab] = await chrome.tabs.query({
			active: true,
			currentWindow: true,
		});
		if (tab?.url) {
			currentTabDomain = extractDomain(tab.url);
			if (currentTabDomain) {
				newDomainInput.placeholder = currentTabDomain;
			}
		}
	} catch {
		// ignore tab query failure
	}

	chrome.runtime.sendMessage(
		{
			type: "get_status",
		},
		(response) => {
			if (chrome.runtime.lastError) {
				showMessage("error", "Background worker not responding");
				return;
			}
			updateStatus(
				Boolean(response?.connected),
				Boolean(response?.authenticated),
			);
		},
	);

	renderDomains();
};

chrome.runtime.onMessage.addListener((message) => {
	if (message?.type === "status") {
		updateStatus(Boolean(message.connected), Boolean(message.authenticated));
		return;
	}
	if (message?.type === "export_result") {
		if (message.success) {
			showMessage(
				"success",
				`Saved cookies for ${message.domains_saved ?? 0} domain(s)`,
				message.paths,
			);
		} else {
			showMessage("error", message.error || "Export failed");
		}
		return;
	}
	if (message?.type === "error") {
		showMessage("error", message.message || "Request failed");
	}
});

connectBtn.onclick = connect;
addDomainBtn.onclick = addDomain;
newDomainInput.onkeydown = (event) => {
	if (event.key === "Enter") {
		addDomain();
	}
};
exportBtn.onclick = exportSelectedDomains;

void init();
