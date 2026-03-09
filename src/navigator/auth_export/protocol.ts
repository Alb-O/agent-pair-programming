/**
 * Wire protocol between browser auth-exporter extension and local auth listener.
 * Parser validates payload shape and rejects malformed messages loudly.
 */
export type ExtensionCookie = {
	name: string;
	value: string;
	domain: string;
	path: string;
	expirationDate?: number;
	httpOnly: boolean;
	secure: boolean;
	sameSite: string;
	hostOnly: boolean;
	storeId?: string;
};

export type DomainCookies = {
	domain: string;
	cookies: ExtensionCookie[];
};

export type ExtensionHelloMessage = {
	type: "hello";
	token: string;
};

export type ExtensionPushCookiesMessage = {
	type: "push_cookies";
	domains: DomainCookies[];
};

export type ExtensionMessage =
	| ExtensionHelloMessage
	| ExtensionPushCookiesMessage;

export type ServerWelcomeMessage = {
	type: "welcome";
	version: string;
};

export type ServerRejectedMessage = {
	type: "rejected";
	reason: string;
};

export type ServerReceivedMessage = {
	type: "received";
	domains_saved: number;
	paths: string[];
};

export type ServerErrorMessage = {
	type: "error";
	message: string;
};

export type ServerMessage =
	| ServerWelcomeMessage
	| ServerRejectedMessage
	| ServerReceivedMessage
	| ServerErrorMessage;

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const requireString = (value: unknown, label: string): string => {
	if (typeof value !== "string" || value.trim() === "") {
		throw new Error(`${label} must be a non-empty string`);
	}
	return value;
};

const parseCookie = (value: unknown): ExtensionCookie => {
	if (!isObjectRecord(value)) {
		throw new Error("cookie must be an object");
	}
	const expirationDateRaw = value.expirationDate;
	const expirationDate =
		typeof expirationDateRaw === "number" && Number.isFinite(expirationDateRaw)
			? expirationDateRaw
			: undefined;

	return {
		name: requireString(value.name, "cookie.name"),
		value: requireString(value.value, "cookie.value"),
		domain: requireString(value.domain, "cookie.domain"),
		path: typeof value.path === "string" ? value.path : "/",
		expirationDate,
		httpOnly: value.httpOnly === true,
		secure: value.secure === true,
		sameSite:
			typeof value.sameSite === "string" && value.sameSite !== ""
				? value.sameSite
				: "unspecified",
		hostOnly: value.hostOnly === true,
		storeId: typeof value.storeId === "string" ? value.storeId : undefined,
	};
};

const parseDomainCookies = (value: unknown): DomainCookies => {
	if (!isObjectRecord(value)) {
		throw new Error("domain cookie payload must be an object");
	}
	const cookiesRaw = value.cookies;
	if (!Array.isArray(cookiesRaw)) {
		throw new Error("domain.cookies must be an array");
	}
	return {
		domain: requireString(value.domain, "domain"),
		cookies: cookiesRaw.map((cookie) => parseCookie(cookie)),
	};
};

export const parseExtensionMessage = (value: unknown): ExtensionMessage => {
	if (!isObjectRecord(value)) {
		throw new Error("message must be an object");
	}

	const type = requireString(value.type, "type");
	if (type === "hello") {
		return {
			type: "hello",
			token: requireString(value.token, "token"),
		};
	}
	if (type === "push_cookies") {
		if (!Array.isArray(value.domains)) {
			throw new Error("domains must be an array");
		}
		return {
			type: "push_cookies",
			domains: value.domains.map((domain) => parseDomainCookies(domain)),
		};
	}

	throw new Error(`unsupported message type '${type}'`);
};
