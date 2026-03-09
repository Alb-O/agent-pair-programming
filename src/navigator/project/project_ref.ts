/**
 * Project reference utilities for ChatGPT project IDs and URLs.
 * Normalizes user input and validates project scoping checks.
 */
export const CHATGPT_BASE_URL = "https://chatgpt.com";

const CHATGPT_HOST_RE = /^(?:www\.)?chatgpt\.com$/i;
const PROJECT_SEGMENT_RE = /^[A-Za-z0-9-]+$/;
const HEX_PROJECT_WITH_OPTIONAL_SLUG_RE =
	/^(?<base>[0-9a-f]{16,})(?:-(?<slug>[A-Za-z0-9][A-Za-z0-9-]*))?$/i;

export type ProjectUrls = {
	root: string;
	project: string;
};

export type ParsedProjectRef = {
	projectId: string;
	projectUrl: string;
	projectRootUrl: string;
};

const normalizeProjectSegment = (segment: string): string | null => {
	const trimmed = segment.trim();
	if (trimmed === "" || !PROJECT_SEGMENT_RE.test(trimmed)) {
		return null;
	}

	const rawBody = trimmed.startsWith("g-p-") ? trimmed.slice(4) : trimmed;
	if (rawBody === "" || !PROJECT_SEGMENT_RE.test(rawBody)) {
		return null;
	}

	const hexMatch = HEX_PROJECT_WITH_OPTIONAL_SLUG_RE.exec(rawBody);
	if (trimmed.startsWith("g-p-")) {
		if (hexMatch?.groups?.base !== undefined) {
			return `g-p-${hexMatch.groups.base}`;
		}
		return `g-p-${rawBody}`;
	}

	if (hexMatch?.groups?.base === undefined) {
		return null;
	}
	return `g-p-${hexMatch.groups.base}`;
};

const parseProjectSegmentFromPath = (pathname: string): string | null => {
	const segments = pathname
		.split("/")
		.map((segment) => segment.trim())
		.filter((segment) => segment !== "");
	if (segments[0] !== "g" || segments.length < 2) {
		return null;
	}
	return segments[1] ?? null;
};

const parseProjectIdFromUrlInput = (value: string): string | null => {
	const trimmed = value.trim();
	if (trimmed === "") {
		return null;
	}

	const urlInput = (() => {
		if (/^https?:\/\//i.test(trimmed)) {
			return trimmed;
		}
		if (/^(?:www\.)?chatgpt\.com\//i.test(trimmed)) {
			return `https://${trimmed}`;
		}
		return null;
	})();
	if (urlInput === null) {
		return null;
	}

	let parsed: URL;
	try {
		parsed = new URL(urlInput);
	} catch {
		return null;
	}

	if (!CHATGPT_HOST_RE.test(parsed.hostname)) {
		return null;
	}

	const segment = parseProjectSegmentFromPath(parsed.pathname);
	if (segment === null) {
		return null;
	}
	return normalizeProjectSegment(segment);
};

const parseProjectIdFromPathLikeInput = (value: string): string | null => {
	const noQueryOrHash = value.trim().replace(/[?#].*$/, "");
	if (noQueryOrHash === "") {
		return null;
	}

	const normalizedPath = noQueryOrHash.replace(/^\/+/, "");
	const segments = normalizedPath
		.split("/")
		.map((segment) => segment.trim())
		.filter((segment) => segment !== "");
	if (segments.length === 0) {
		return null;
	}

	if (segments[0] === "g") {
		const projectSegment = segments[1];
		if (projectSegment === undefined) {
			return null;
		}
		return normalizeProjectSegment(projectSegment);
	}

	const first = segments[0];
	if (first === undefined) {
		return null;
	}
	return normalizeProjectSegment(first);
};

export const parseProjectId = (value: string): string => {
	const trimmed = value.trim();
	if (trimmed === "") {
		throw new Error("Project value is empty.");
	}

	const normalized =
		parseProjectIdFromUrlInput(trimmed) ??
		parseProjectIdFromPathLikeInput(trimmed);
	if (normalized !== null) {
		return normalized;
	}

	throw new Error(
		`Invalid project reference: ${value}. Use g-p-... or a ChatGPT project/conversation URL.`,
	);
};

export const projectUrls = (
	projectId: string,
	baseUrl: string = CHATGPT_BASE_URL,
): ProjectUrls => {
	const normalizedProjectId = parseProjectId(projectId);
	const root = `${baseUrl}/g/${normalizedProjectId}`;
	return {
		root,
		project: `${root}/project`,
	};
};

export const parseProjectRef = (value: string): ParsedProjectRef => {
	const projectId = parseProjectId(value);
	const urls = projectUrls(projectId);
	return {
		projectId,
		projectUrl: urls.project,
		projectRootUrl: urls.root,
	};
};

export const urlInProject = (url: string, projectId: string): boolean => {
	const trimmedUrl = url.trim();
	if (trimmedUrl === "") {
		return false;
	}

	const currentProjectId =
		parseProjectIdFromUrlInput(trimmedUrl) ??
		parseProjectIdFromPathLikeInput(trimmedUrl);
	if (currentProjectId === null) {
		return false;
	}

	let normalizedTargetProjectId: string;
	try {
		normalizedTargetProjectId = parseProjectId(projectId);
	} catch {
		return false;
	}

	return (
		currentProjectId === normalizedTargetProjectId ||
		currentProjectId.startsWith(`${normalizedTargetProjectId}-`) ||
		normalizedTargetProjectId.startsWith(`${currentProjectId}-`)
	);
};
