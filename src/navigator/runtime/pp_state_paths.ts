import os from "node:os";
import path from "node:path";

const isNonEmpty = (value?: string): value is string =>
	value !== undefined && value.trim() !== "";

export const PP_DEFAULT_PROFILE_NAME = "chatgpt-profile";
const PROFILE_BROWSER_STATE_DIR = "browser-state";
const PROFILE_LAYOUT_VERSION = "v1";

const resolveXdgStateHome = ({
	env = process.env,
	homeDir = os.homedir(),
}: {
	env?: NodeJS.ProcessEnv;
	homeDir?: string;
} = {}): string => {
	const fromEnv = env.XDG_STATE_HOME;
	if (isNonEmpty(fromEnv)) {
		return path.resolve(fromEnv);
	}
	return path.resolve(homeDir, ".local", "state");
};

export const resolvePpStateRoot = ({
	env = process.env,
	homeDir = os.homedir(),
}: {
	env?: NodeJS.ProcessEnv;
	homeDir?: string;
} = {}): string => path.resolve(resolveXdgStateHome({ env, homeDir }), "pp");

export const resolvePpProfilesDir = ({
	env = process.env,
	homeDir = os.homedir(),
}: {
	env?: NodeJS.ProcessEnv;
	homeDir?: string;
} = {}): string =>
	path.resolve(resolvePpStateRoot({ env, homeDir }), "profiles");

export const resolvePpProfileDir = ({
	profile,
	env = process.env,
	homeDir = os.homedir(),
}: {
	profile: string;
	env?: NodeJS.ProcessEnv;
	homeDir?: string;
}): string =>
	path.resolve(
		resolvePpProfilesDir({
			env,
			homeDir,
		}),
		profile,
	);

export const resolvePpDefaultProfileDir = ({
	env = process.env,
	homeDir = os.homedir(),
}: {
	env?: NodeJS.ProcessEnv;
	homeDir?: string;
} = {}): string =>
	resolvePpProfileDir({
		profile: PP_DEFAULT_PROFILE_NAME,
		env,
		homeDir,
	});

export const resolvePpProfileBrowserRuntimeDir = ({
	profile,
	runtimePartition,
	env = process.env,
	homeDir = os.homedir(),
}: {
	profile: string;
	runtimePartition: string;
	env?: NodeJS.ProcessEnv;
	homeDir?: string;
}): string =>
	path.resolve(
		resolvePpProfileDir({
			profile,
			env,
			homeDir,
		}),
		PROFILE_BROWSER_STATE_DIR,
		PROFILE_LAYOUT_VERSION,
		runtimePartition,
	);

export const resolvePpAuthDir = ({
	env = process.env,
	homeDir = os.homedir(),
}: {
	env?: NodeJS.ProcessEnv;
	homeDir?: string;
} = {}): string => path.resolve(resolvePpStateRoot({ env, homeDir }), "auth");

export const resolvePpRuntimeDir = ({
	env = process.env,
	homeDir = os.homedir(),
}: {
	env?: NodeJS.ProcessEnv;
	homeDir?: string;
} = {}): string =>
	path.resolve(resolvePpStateRoot({ env, homeDir }), "runtime");
