import { parseProjectRef, type ParsedProjectRef } from "./project_ref";

/**
 * Env-backed project binding for navigator commands.
 * This replaces profile-file persistence with shell/session-level persistence.
 */
export const NAVIGATOR_PROJECT_ENV = "PP_CHATGPT_PROJECT";

export type ProjectSource = "option" | "env";

export type ResolveProjectInput = {
	project?: string;
	env?: NodeJS.ProcessEnv;
	envVar?: string;
};

export type ResolvedNavigatorProject = ParsedProjectRef & {
	source: ProjectSource;
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

export const readNavigatorProjectValue = ({
	project,
	env = process.env,
	envVar = NAVIGATOR_PROJECT_ENV,
}: ResolveProjectInput): string | undefined => {
	const fromOption = normalize(project);
	if (fromOption !== undefined) {
		return fromOption;
	}
	return normalize(env[envVar]);
};

export const resolveNavigatorProject = ({
	project,
	env = process.env,
	envVar = NAVIGATOR_PROJECT_ENV,
}: ResolveProjectInput): ResolvedNavigatorProject | null => {
	const fromOption = normalize(project);
	if (fromOption !== undefined) {
		return {
			...parseProjectRef(fromOption),
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
		...parseProjectRef(fromEnv),
		source: "env",
		raw: fromEnv,
		envVar,
	};
};
