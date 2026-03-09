import os from "node:os";
import path from "node:path";
import { resolvePpProfileDir } from "../runtime/pp_state_paths";

/**
 * Env-backed profile binding for navigator commands.
 * Resolves profile names into XDG state user-data-dir paths.
 */
export const NAVIGATOR_PROFILE_ENV = "PP_PROFILE";

export type ProfileSource = "option" | "env";

export type ResolveProfileInput = {
	profile?: string;
	env?: NodeJS.ProcessEnv;
	envVar?: string;
	homeDir?: string;
};

export type ResolvedNavigatorProfile = {
	profile: string;
	userDataDir: string;
	source: ProfileSource;
	raw: string;
	envVar: string;
};

const PROFILE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const normalize = (value?: string): string | undefined => {
	if (value === undefined) {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed === "" ? undefined : trimmed;
};

export const parseNavigatorProfile = (value: string): string => {
	const trimmed = value.trim();
	if (trimmed === "") {
		throw new Error("Profile value is empty.");
	}
	if (!PROFILE_NAME_RE.test(trimmed)) {
		throw new Error(
			`Invalid profile reference: ${value}. Use profile names like 'chatgpt-profile' (letters, numbers, ., _, -).`,
		);
	}
	return trimmed;
};

export const profileUserDataDir = ({
	profile,
	env = process.env,
	homeDir = os.homedir(),
}: {
	profile: string;
	env?: NodeJS.ProcessEnv;
	homeDir?: string;
}): string =>
	path.resolve(
		resolvePpProfileDir({
			profile: parseNavigatorProfile(profile),
			env,
			homeDir,
		}),
	);

export const readNavigatorProfileValue = ({
	profile,
	env = process.env,
	envVar = NAVIGATOR_PROFILE_ENV,
}: ResolveProfileInput): string | undefined => {
	const fromOption = normalize(profile);
	if (fromOption !== undefined) {
		return fromOption;
	}
	return normalize(env[envVar]);
};

export const resolveNavigatorProfile = ({
	profile,
	env = process.env,
	envVar = NAVIGATOR_PROFILE_ENV,
	homeDir = os.homedir(),
}: ResolveProfileInput): ResolvedNavigatorProfile | null => {
	const fromOption = normalize(profile);
	if (fromOption !== undefined) {
		const parsed = parseNavigatorProfile(fromOption);
		return {
			profile: parsed,
			userDataDir: profileUserDataDir({
				profile: parsed,
				env,
				homeDir,
			}),
			source: "option",
			raw: fromOption,
			envVar,
		};
	}

	const fromEnv = normalize(env[envVar]);
	if (fromEnv === undefined) {
		return null;
	}
	const parsed = parseNavigatorProfile(fromEnv);
	return {
		profile: parsed,
		userDataDir: profileUserDataDir({
			profile: parsed,
			env,
			homeDir,
		}),
		source: "env",
		raw: fromEnv,
		envVar,
	};
};
