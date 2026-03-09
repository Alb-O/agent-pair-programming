/**
 * Option extraction and validation helpers for parsed cli option maps.
 */
export type CliOptionMap = Record<string, unknown>;

export const readStringOption = ({
	options,
	key,
}: {
	options: CliOptionMap;
	key: string;
}): string | undefined => {
	const value = options[key];
	if (typeof value !== "string") {
		return undefined;
	}
	return value;
};

export const readBooleanOption = ({
	options,
	key,
}: {
	options: CliOptionMap;
	key: string;
}): boolean => options[key] === true;

export const requireOption = ({
	options,
	key,
	flag = key,
	usage,
}: {
	options: CliOptionMap;
	key: string;
	flag?: string;
	usage: string;
}): string => {
	const value = readStringOption({ options, key });
	if (value === undefined || value === "") {
		throw new Error(`missing required option '${flag}'\n${usage}`);
	}
	return value;
};

export const parseIntOption = ({
	options,
	key,
	flag = key,
	usage,
}: {
	options: CliOptionMap;
	key: string;
	flag?: string;
	usage: string;
}): number | undefined => {
	const raw = readStringOption({ options, key });
	if (raw === undefined) {
		return undefined;
	}
	const parsed = Number.parseInt(raw, 10);
	if (!Number.isInteger(parsed)) {
		throw new Error(`option '${flag}' must be an integer\n${usage}`);
	}
	return parsed;
};

export const requireNoPositionals = ({
	positionals,
	context,
	usage,
}: {
	positionals: readonly string[];
	context: string;
	usage: string;
}): void => {
	if (positionals.length > 0) {
		throw new Error(
			`${context} does not accept positional arguments\n${usage}`,
		);
	}
};
