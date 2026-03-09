/**
 * Parser for navigator compose entry syntax.
 * Supports explicit slice entries and shorthand line-range entries.
 */
export type SliceEntry = {
	pathText: string;
	path: string;
	start: number;
	end: number;
	label: string;
};

export type LineRange = {
	start: number;
	end: number;
};

export type RangeShorthandEntry = {
	pathText: string;
	path: string;
	ranges: LineRange[];
};

const SLICE_ENTRY_RE =
	/^(?<path>.+):(?<start>\d+):(?<end>\d+)(?::(?<label>.+))?$/;
const RANGE_SHORTHAND_RE =
	/^(?<path>.+):(?<ranges>\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*)$/;

const parsePositiveInt = (value: string, context: string): number => {
	const parsed = Number.parseInt(value, 10);
	if (!Number.isInteger(parsed) || parsed < 1) {
		throw new Error(`${context} must be >= 1`);
	}
	return parsed;
};

export const parseSliceEntry = (entry: string): SliceEntry => {
	const parsed = SLICE_ENTRY_RE.exec(entry);
	if (parsed === null || parsed.groups === undefined) {
		throw new Error(
			`Invalid slice entry: ${entry}. Expected: slice:path:start:end[:label]`,
		);
	}

	const start = parsePositiveInt(
		parsed.groups.start,
		`Slice start in ${entry}`,
	);
	const end = parsePositiveInt(parsed.groups.end, `Slice end in ${entry}`);
	if (end < start) {
		throw new Error(`Slice end must be >= start: ${entry}`);
	}

	return {
		pathText: parsed.groups.path,
		path: parsed.groups.path,
		start,
		end,
		label: parsed.groups.label ?? "",
	};
};

export const parseRangeShorthandEntry = (
	entry: string,
): RangeShorthandEntry | null => {
	const parsed = RANGE_SHORTHAND_RE.exec(entry);
	if (parsed === null || parsed.groups === undefined) {
		return null;
	}

	const ranges: LineRange[] = [];
	for (const token of parsed.groups.ranges.split(",")) {
		const tokenMatch = /^(?<start>\d+)(?:-(?<end>\d+))?$/.exec(token);
		if (tokenMatch === null || tokenMatch.groups === undefined) {
			throw new Error(
				`Invalid shorthand range token: ${token} in entry ${entry}. Expected start-end or a single line number.`,
			);
		}
		const start = parsePositiveInt(
			tokenMatch.groups.start,
			`Shorthand range start in ${entry}`,
		);
		const endToken = tokenMatch.groups.end;
		const end =
			endToken === undefined
				? start
				: parsePositiveInt(endToken, `Shorthand range end in ${entry}`);
		if (end < start) {
			throw new Error(`Shorthand range end must be >= start: ${entry}`);
		}
		ranges.push({ start, end });
	}

	return {
		pathText: parsed.groups.path,
		path: parsed.groups.path,
		ranges,
	};
};
