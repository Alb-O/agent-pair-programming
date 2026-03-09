import fs from "node:fs";
import path from "node:path";
import type { DomainCookies, ExtensionCookie } from "./protocol";

/**
 * Conversion utilities from extension cookie payloads to Playwright storageState files.
 */
type StorageStateSameSite = "Strict" | "Lax" | "None";

type StorageStateCookie = {
	name: string;
	value: string;
	domain: string;
	path: string;
	expires: number;
	httpOnly: boolean;
	secure: boolean;
	sameSite: StorageStateSameSite;
};

export type StorageState = {
	cookies: StorageStateCookie[];
	origins: [];
};

const parseSameSite = (value: string): StorageStateSameSite => {
	switch (value) {
		case "strict":
			return "Strict";
		case "lax":
			return "Lax";
		case "no_restriction":
			return "None";
		default:
			return "Lax";
	}
};

export const extensionCookieToStorageStateCookie = (
	cookie: ExtensionCookie,
): StorageStateCookie => ({
	name: cookie.name,
	value: cookie.value,
	domain: cookie.domain,
	path: cookie.path,
	expires:
		typeof cookie.expirationDate === "number" &&
		Number.isFinite(cookie.expirationDate)
			? cookie.expirationDate
			: -1,
	httpOnly: cookie.httpOnly,
	secure: cookie.secure,
	sameSite: parseSameSite(cookie.sameSite),
});

export const domainCookiesToStorageState = (
	domainCookies: DomainCookies,
): StorageState => ({
	cookies: domainCookies.cookies.map((cookie) =>
		extensionCookieToStorageStateCookie(cookie),
	),
	origins: [],
});

export const sanitizeDomain = (domain: string): string =>
	domain.replace(/^\./, "").replace(/\./g, "_");

export const saveDomainCookies = (
	domains: readonly DomainCookies[],
	authDir: string,
): {
	paths: string[];
	errors: string[];
} => {
	fs.mkdirSync(authDir, { recursive: true });

	const paths: string[] = [];
	const errors: string[] = [];

	for (const domainCookies of domains) {
		const state = domainCookiesToStorageState(domainCookies);
		const filename = `${sanitizeDomain(domainCookies.domain)}.json`;
		const outPath = path.resolve(authDir, filename);

		try {
			fs.writeFileSync(outPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
			paths.push(outPath);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			errors.push(`${domainCookies.domain}: ${message}`);
		}
	}

	return {
		paths,
		errors,
	};
};
