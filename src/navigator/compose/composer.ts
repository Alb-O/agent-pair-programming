import fs from "node:fs";
import path from "node:path";
import {
	parseRangeShorthandEntry,
	parseSliceEntry,
	type LineRange,
} from "./entry_parser";

/**
 * Message composer for navigator prompts.
 * Loads a preamble file and appends file/range blocks with explicit headers.
 */
export type ComposeNavigatorMessageOptions = {
	preambleFile: string;
	entries: readonly string[];
	cwd?: string;
	onWarning?: (warning: string) => void;
};

export type ReadSliceResult = {
	start: number;
	end: number;
	text: string;
};

const normalizeLines = (content: string): string[] => {
	const lines = content.replace(/\r/g, "").split("\n");
	if (lines.length > 0 && lines[lines.length - 1] === "") {
		lines.pop();
	}
	return lines;
};

const pathKind = (candidatePath: string): string => {
	try {
		const stats = fs.statSync(candidatePath);
		if (stats.isFile()) {
			return "file";
		}
		if (stats.isDirectory()) {
			return "dir";
		}
		return "other";
	} catch {
		return "missing";
	}
};

const ensureFilePath = (
	filePath: string,
	entryText: string,
	context: string,
	cwd: string,
): void => {
	const kind = pathKind(filePath);
	if (kind !== "file") {
		throw new Error(
			`${context} is not a file: ${entryText} resolved=${filePath} type=${kind} cwd=${cwd}`,
		);
	}
};

const resolveEntryPath = (entryPath: string, cwd: string): string => {
	if (path.isAbsolute(entryPath)) {
		return entryPath;
	}
	return path.resolve(cwd, entryPath);
};

export const readSlice = (
	filePath: string,
	start: number,
	end: number,
): ReadSliceResult => {
	const lines = normalizeLines(fs.readFileSync(filePath, "utf8"));
	if (lines.length === 0) {
		throw new Error(`Cannot slice empty file: ${filePath}`);
	}
	if (start > lines.length) {
		throw new Error(
			`Slice start (${start}) exceeds file length (${lines.length}): ${filePath}`,
		);
	}

	const effectiveEnd = end > lines.length ? lines.length : end;
	const text = lines.slice(start - 1, effectiveEnd).join("\n");

	return {
		start,
		end: effectiveEnd,
		text,
	};
};

const appendRangeSnippet = (
	parts: string[],
	entryPath: string,
	filePath: string,
	range: LineRange,
): void => {
	const slice = readSlice(filePath, range.start, range.end);
	const header =
		slice.start === slice.end
			? `[FILE: ${entryPath} | line ${slice.start}]`
			: `[FILE: ${entryPath} | lines ${slice.start}-${slice.end}]`;
	parts.push(`\n\n${header}\n${slice.text}`);
};

export const composeNavigatorMessage = ({
	preambleFile,
	entries,
	cwd = process.cwd(),
	onWarning,
}: ComposeNavigatorMessageOptions): string => {
	if (preambleFile.trim() === "") {
		throw new Error("composeNavigatorMessage requires preambleFile");
	}

	const resolvedPreamble = resolveEntryPath(preambleFile, cwd);
	if (!fs.existsSync(resolvedPreamble)) {
		throw new Error(`Preamble file not found: ${preambleFile} cwd=${cwd}`);
	}

	const parts: string[] = [fs.readFileSync(resolvedPreamble, "utf8")];

	for (const rawEntry of entries) {
		const entry = rawEntry.trim();
		if (entry === "") {
			continue;
		}
		if (entry === "\\") {
			onWarning?.(
				"[pp compose] Warning: ignoring standalone '\\\\' entry. Bash-style line continuation is not valid here; pass entries directly as separate arguments.",
			);
			continue;
		}

		if (entry.startsWith("slice:")) {
			const parsed = parseSliceEntry(entry.slice("slice:".length));
			const filePath = resolveEntryPath(parsed.path, cwd);
			if (!fs.existsSync(filePath)) {
				throw new Error(
					`Slice file not found: ${parsed.pathText} cwd=${cwd}. Run from your project root or use absolute paths.`,
				);
			}
			ensureFilePath(filePath, parsed.pathText, "Slice file", cwd);

			const slice = readSlice(filePath, parsed.start, parsed.end);
			const header =
				parsed.label === ""
					? `[FILE: ${parsed.pathText} | lines ${slice.start}-${slice.end}]`
					: `[FILE: ${parsed.pathText} | lines ${slice.start}-${slice.end} | ${parsed.label}]`;
			parts.push(`\n\n${header}\n${slice.text}`);
			continue;
		}

		const fileText = entry.startsWith("file:")
			? entry.slice("file:".length)
			: entry;
		const filePath = resolveEntryPath(fileText, cwd);

		if (fs.existsSync(filePath)) {
			ensureFilePath(filePath, fileText, "File entry", cwd);
			const content = fs.readFileSync(filePath, "utf8");
			parts.push(`\n\n[FILE: ${fileText}]\n${content}`);
			continue;
		}

		const shorthand = parseRangeShorthandEntry(fileText);
		if (shorthand !== null) {
			const shorthandPath = resolveEntryPath(shorthand.path, cwd);
			if (!fs.existsSync(shorthandPath)) {
				throw new Error(
					`Range entry file not found: ${shorthand.pathText} cwd=${cwd}. Parsed from '${fileText}'. Run from your project root or use absolute paths.`,
				);
			}
			ensureFilePath(
				shorthandPath,
				shorthand.pathText,
				"Range entry file",
				cwd,
			);

			for (const range of shorthand.ranges) {
				appendRangeSnippet(parts, shorthand.pathText, shorthandPath, range);
			}
			continue;
		}

		throw new Error(
			`File not found: ${fileText} cwd=${cwd}. If this was intended as a line range, use 'slice:path:start:end' or shorthand 'path:start-end[,start-end...]'.`,
		);
	}

	return parts.join("");
};
