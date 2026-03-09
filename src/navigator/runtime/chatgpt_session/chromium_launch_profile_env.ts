/**
 * Env-backed chromium launch profile selection for navigator commands.
 * Supports explicit option/env binding with option precedence.
 */
export const NAVIGATOR_CHROMIUM_LAUNCH_PROFILE_ENV =
	"PP_CHROMIUM_LAUNCH_PROFILE";
export const NAVIGATOR_DEFAULT_CHROMIUM_LAUNCH_PROFILE = "low-detection";

const NAVIGATOR_CHROMIUM_LAUNCH_PROFILE_ALIASES = {
	"low-detection": "low-detection",
	low_detection: "low-detection",
	low: "low-detection",
	strict: "strict",
} as const;

export type NavigatorChromiumLaunchProfile =
	(typeof NAVIGATOR_CHROMIUM_LAUNCH_PROFILE_ALIASES)[keyof typeof NAVIGATOR_CHROMIUM_LAUNCH_PROFILE_ALIASES];
export type ChromiumLaunchProfileSource = "option" | "env";

export type ResolveChromiumLaunchProfileInput = {
	chromiumLaunchProfile?: string;
	env?: NodeJS.ProcessEnv;
	envVar?: string;
};

export type ResolvedNavigatorChromiumLaunchProfile = {
	chromiumLaunchProfile: NavigatorChromiumLaunchProfile;
	source: ChromiumLaunchProfileSource;
	raw: string;
	envVar: string;
};

const normalize = (value?: string): string | undefined => {
	if (value === undefined) {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed === "" ? undefined : trimmed;
};

export const parseNavigatorChromiumLaunchProfile = (
	value: string,
): NavigatorChromiumLaunchProfile => {
	const normalized = value.trim().toLowerCase();
	const parsed =
		NAVIGATOR_CHROMIUM_LAUNCH_PROFILE_ALIASES[
			normalized as keyof typeof NAVIGATOR_CHROMIUM_LAUNCH_PROFILE_ALIASES
		];
	if (parsed !== undefined) {
		return parsed;
	}
	throw new Error(
		`Invalid chromium launch profile: ${value}. Use low-detection or strict.`,
	);
};

export const readNavigatorChromiumLaunchProfileValue = ({
	chromiumLaunchProfile,
	env = process.env,
	envVar = NAVIGATOR_CHROMIUM_LAUNCH_PROFILE_ENV,
}: ResolveChromiumLaunchProfileInput): string | undefined => {
	const fromOption = normalize(chromiumLaunchProfile);
	if (fromOption !== undefined) {
		return fromOption;
	}
	return normalize(env[envVar]);
};

export const resolveNavigatorChromiumLaunchProfile = ({
	chromiumLaunchProfile,
	env = process.env,
	envVar = NAVIGATOR_CHROMIUM_LAUNCH_PROFILE_ENV,
}: ResolveChromiumLaunchProfileInput): ResolvedNavigatorChromiumLaunchProfile | null => {
	const fromOption = normalize(chromiumLaunchProfile);
	if (fromOption !== undefined) {
		return {
			chromiumLaunchProfile: parseNavigatorChromiumLaunchProfile(fromOption),
			source: "option",
			raw: fromOption,
			envVar,
		};
	}

	const fromEnv = normalize(env[envVar]);
	if (fromEnv === undefined) {
		return null;
	}
	return {
		chromiumLaunchProfile: parseNavigatorChromiumLaunchProfile(fromEnv),
		source: "env",
		raw: fromEnv,
		envVar,
	};
};
