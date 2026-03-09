import fs from "node:fs";
import path from "node:path";
import type { BrowserPage } from "./composer";

/**
 * Artifact downloader for ChatGPT interpreter sandbox files.
 * Lists sandbox links from assistant messages and downloads selected artifacts.
 */
export type NavigatorArtifactLink = {
	index: number;
	messageId: string;
	sandboxPath: string;
	file: string;
	label: string;
};

export type DownloadNavigatorArtifactOptions = {
	index?: number;
	outputPath?: string;
	cwd?: string;
};

type DownloadContentPayload = {
	base64: string;
	contentType: string | null;
};

type RawArtifactLink = {
	messageId: string;
	sandboxPath: string;
	linkText: string;
};

type DownloadNavigatorArtifactBase = {
	link: NavigatorArtifactLink;
	downloadUrl: string;
	size: number;
	contentType: string | null;
};

export type DownloadNavigatorArtifactSavedResult =
	DownloadNavigatorArtifactBase & {
		mode: "saved";
		savedPath: string;
	};

export type DownloadNavigatorArtifactContentResult =
	DownloadNavigatorArtifactBase & {
		mode: "content";
		text: string;
	};

export type DownloadNavigatorArtifactResult =
	| DownloadNavigatorArtifactSavedResult
	| DownloadNavigatorArtifactContentResult;

const toFileName = (sandboxPath: string): string => {
	const trimmed = sandboxPath.trim();
	if (trimmed === "") {
		return "artifact";
	}
	const base = path.posix.basename(trimmed);
	return base === "" ? "artifact" : base;
};

const isTextContentType = (contentType: string | null): boolean => {
	if (contentType === null || contentType.trim() === "") {
		return true;
	}
	const normalized = contentType.toLowerCase();
	return (
		normalized.startsWith("text/") ||
		normalized.startsWith("application/json") ||
		normalized.startsWith("application/xml") ||
		normalized.startsWith("application/javascript") ||
		normalized.startsWith("application/x-javascript")
	);
};

const readAccessToken = async (page: BrowserPage): Promise<string> => {
	const result = await page.evaluate(async () => {
		try {
			const response = await fetch("/api/auth/session", {
				method: "GET",
				credentials: "include",
			});
			if (!response.ok) {
				return {
					error: `Failed to get session: ${response.status}`,
				};
			}
			const session = (await response.json()) as { accessToken?: unknown };
			const token =
				typeof session.accessToken === "string" ? session.accessToken : "";
			if (token === "") {
				return {
					error: "Session access token is missing",
				};
			}
			return {
				token,
			};
		} catch (error) {
			return {
				error: error instanceof Error ? error.message : String(error),
			};
		}
	});

	if (typeof (result as { error?: unknown }).error === "string") {
		throw new Error((result as { error: string }).error);
	}

	const token = (result as { token?: unknown }).token;
	if (typeof token !== "string" || token.trim() === "") {
		throw new Error("Failed to read session access token");
	}
	return token;
};

const readConversationId = async (page: BrowserPage): Promise<string> => {
	const conversationId = await page.evaluate(() => {
		const browserGlobal = globalThis as unknown as {
			location: {
				pathname: string;
			};
		};
		const match = browserGlobal.location.pathname.match(/\/c\/([A-Za-z0-9-]+)/);
		return match?.[1] ?? null;
	});

	if (typeof conversationId !== "string" || conversationId.trim() === "") {
		throw new Error("Could not determine conversation ID from URL");
	}
	return conversationId;
};

const requestDownloadUrl = async ({
	page,
	conversationId,
	messageId,
	sandboxPath,
	token,
}: {
	page: BrowserPage;
	conversationId: string;
	messageId: string;
	sandboxPath: string;
	token: string;
}): Promise<string> => {
	const result = await page.evaluate(
		async ({
			inputConversationId,
			inputMessageId,
			inputSandboxPath,
			inputToken,
		}) => {
			const params = new URLSearchParams({
				message_id: inputMessageId,
				sandbox_path: inputSandboxPath,
			});
			const apiUrl = `/backend-api/conversation/${inputConversationId}/interpreter/download?${params.toString()}`;

			try {
				const response = await fetch(apiUrl, {
					method: "GET",
					headers: {
						Authorization: `Bearer ${inputToken}`,
					},
					credentials: "include",
				});

				if (!response.ok) {
					const text = await response.text();
					return {
						error: `API request failed: ${response.status} ${text}`,
					};
				}

				const payload = (await response.json()) as {
					download_url?: unknown;
				};
				const downloadUrl =
					typeof payload.download_url === "string" ? payload.download_url : "";
				if (downloadUrl === "") {
					return {
						error: "No download URL in response",
					};
				}
				return {
					downloadUrl,
				};
			} catch (error) {
				return {
					error: error instanceof Error ? error.message : String(error),
				};
			}
		},
		{
			inputConversationId: conversationId,
			inputMessageId: messageId,
			inputSandboxPath: sandboxPath,
			inputToken: token,
		},
	);

	if (typeof (result as { error?: unknown }).error === "string") {
		throw new Error((result as { error: string }).error);
	}
	const downloadUrl = (result as { downloadUrl?: unknown }).downloadUrl;
	if (typeof downloadUrl !== "string" || downloadUrl.trim() === "") {
		throw new Error("No download URL in response");
	}
	return downloadUrl;
};

const fetchDownloadContent = async (
	page: BrowserPage,
	downloadUrl: string,
): Promise<DownloadContentPayload> => {
	const result = await page.evaluate(async (inputDownloadUrl) => {
		try {
			const response = await fetch(inputDownloadUrl, {
				method: "GET",
				credentials: "include",
			});
			if (!response.ok) {
				return {
					error: `Failed to fetch content: status ${response.status}`,
				};
			}

			const bytes = new Uint8Array(await response.arrayBuffer());
			let binary = "";
			const chunkSize = 32_768;
			for (let index = 0; index < bytes.length; index += chunkSize) {
				const slice = bytes.subarray(index, index + chunkSize);
				binary += String.fromCharCode(...slice);
			}

			return {
				base64: btoa(binary),
				contentType: response.headers.get("content-type"),
			};
		} catch (error) {
			return {
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}, downloadUrl);

	if (typeof (result as { error?: unknown }).error === "string") {
		throw new Error((result as { error: string }).error);
	}

	const base64 = (result as { base64?: unknown }).base64;
	if (typeof base64 !== "string") {
		throw new Error("Failed to fetch artifact content");
	}
	const contentTypeRaw = (result as { contentType?: unknown }).contentType;
	return {
		base64,
		contentType: typeof contentTypeRaw === "string" ? contentTypeRaw : null,
	};
};

const pickLink = (
	links: readonly NavigatorArtifactLink[],
	index?: number,
): NavigatorArtifactLink => {
	const linkIndex = index === undefined ? links.length - 1 : index;
	if (!Number.isInteger(linkIndex)) {
		throw new Error(
			`Invalid index (${index}). Available: 0-${links.length - 1}`,
		);
	}
	if (linkIndex < 0 || linkIndex > links.length - 1) {
		throw new Error(
			`Invalid index (${linkIndex}). Available: 0-${links.length - 1}`,
		);
	}
	return links[linkIndex];
};

export const listNavigatorArtifacts = async (
	page: BrowserPage,
): Promise<NavigatorArtifactLink[]> => {
	const rawLinks = await page.evaluate(() => {
		const links: RawArtifactLink[] = [];
		const seen = new Set<string>();

		const readSandboxHref = (
			anchor: {
				getAttribute: (name: string) => string | null;
				textContent?: string;
			} & Record<string, unknown>,
		): string | null => {
			const href = anchor.getAttribute("href");
			if (typeof href === "string" && href.startsWith("sandbox:")) {
				return href;
			}

			const keys = Object.keys(anchor);

			const propsKey = keys.find((key) => key.startsWith("__reactProps"));
			if (propsKey !== undefined) {
				const reactProps = anchor[propsKey] as { href?: unknown };
				if (
					reactProps !== undefined &&
					typeof reactProps.href === "string" &&
					reactProps.href.startsWith("sandbox:")
				) {
					return reactProps.href;
				}
			}

			const fiberKey = keys.find((key) => key.startsWith("__reactFiber"));
			if (fiberKey !== undefined) {
				let fiber = anchor[fiberKey] as
					| {
							memoizedProps?: { href?: unknown };
							pendingProps?: { href?: unknown };
							return?: unknown;
					  }
					| undefined;

				while (fiber !== undefined && fiber !== null) {
					const props = fiber.memoizedProps ?? fiber.pendingProps;
					const fiberHref = props?.href;
					if (
						typeof fiberHref === "string" &&
						fiberHref.startsWith("sandbox:")
					) {
						return fiberHref;
					}

					fiber = fiber.return as
						| {
								memoizedProps?: { href?: unknown };
								pendingProps?: { href?: unknown };
								return?: unknown;
						  }
						| undefined;
				}
			}

			return null;
		};

		const browserGlobal = globalThis as unknown as {
			document: {
				querySelectorAll: (selector: string) => ArrayLike<{
					dataset?: { messageId?: string };
					getAttribute: (name: string) => string | null;
					querySelectorAll: (selector: string) => ArrayLike<{
						getAttribute: (name: string) => string | null;
						textContent?: string;
					}>;
				}>;
			};
		};

		const messages = Array.from(
			browserGlobal.document.querySelectorAll(
				"[data-message-author-role='assistant']",
			),
		) as Array<{
			dataset?: { messageId?: string };
			getAttribute: (name: string) => string | null;
			querySelectorAll: (selector: string) => ArrayLike<{
				getAttribute: (name: string) => string | null;
				textContent?: string;
			}>;
		}>;

		for (const message of messages) {
			const messageId =
				message.getAttribute("data-message-id") ??
				message.dataset?.messageId ??
				"";
			if (messageId.trim() === "") {
				continue;
			}

			const anchors = Array.from(message.querySelectorAll("a"));
			for (const anchor of anchors) {
				const sandboxHref = readSandboxHref(anchor);
				if (
					sandboxHref === null ||
					sandboxHref.trim() === "" ||
					!sandboxHref.startsWith("sandbox:")
				) {
					continue;
				}

				const sandboxPath = sandboxHref.slice("sandbox:".length);
				if (sandboxPath.trim() === "") {
					continue;
				}

				const dedupeKey = `${messageId}::${sandboxPath}`;
				if (seen.has(dedupeKey)) {
					continue;
				}
				seen.add(dedupeKey);

				links.push({
					messageId,
					sandboxPath,
					linkText: anchor.textContent?.trim() ?? "",
				});
			}
		}

		return links;
	});

	if (!Array.isArray(rawLinks) || rawLinks.length === 0) {
		throw new Error("No download links found in conversation");
	}

	return rawLinks.map((entry, index) => ({
		index,
		messageId: entry.messageId,
		sandboxPath: entry.sandboxPath,
		file: toFileName(entry.sandboxPath),
		label: entry.linkText,
	}));
};

export const downloadNavigatorArtifact = async (
	page: BrowserPage,
	{
		index,
		outputPath,
		cwd = process.cwd(),
	}: DownloadNavigatorArtifactOptions = {},
): Promise<DownloadNavigatorArtifactResult> => {
	const links = await listNavigatorArtifacts(page);
	const link = pickLink(links, index);
	const conversationId = await readConversationId(page);
	const accessToken = await readAccessToken(page);
	const downloadUrl = await requestDownloadUrl({
		page,
		conversationId,
		messageId: link.messageId,
		sandboxPath: link.sandboxPath,
		token: accessToken,
	});
	const content = await fetchDownloadContent(page, downloadUrl);
	const bytes = Buffer.from(content.base64, "base64");

	if (outputPath !== undefined && outputPath.trim() !== "") {
		const savedPath = path.resolve(cwd, outputPath);
		fs.mkdirSync(path.dirname(savedPath), { recursive: true });
		fs.writeFileSync(savedPath, bytes);
		return {
			mode: "saved",
			link,
			downloadUrl,
			contentType: content.contentType,
			size: bytes.length,
			savedPath,
		};
	}

	if (!isTextContentType(content.contentType)) {
		throw new Error(
			`Downloaded artifact is binary (${content.contentType}); pass --output to save bytes`,
		);
	}

	return {
		mode: "content",
		link,
		downloadUrl,
		contentType: content.contentType,
		size: bytes.length,
		text: bytes.toString("utf8"),
	};
};
