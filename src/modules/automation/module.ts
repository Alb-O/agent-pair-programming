import fs from "node:fs";
import path from "node:path";
import { parseWithCommander } from "../../ecosystem/commander_parse";
import {
	readBooleanOption,
	requireNoPositionals,
	requireOption,
} from "../../ecosystem/argv";
import {
	buildPlaywrightCore,
	ensurePathExists,
} from "../../automation/build_playwright_core";
import { runDemoSuite } from "../../automation/demo_suite";
import { runE2ESmoke } from "../../automation/e2e_smoke";

/**
 * Automation module command surface for build and local playwright workflows.
 */
export const AUTOMATION_COMMAND_USAGE_LINES = [
	"  build-core --playwright-root <path> [--skip-install]",
	"  run-e2e --playwright-root <path> --chromium-bin <path>",
	"  build-and-e2e --playwright-root <path> --chromium-bin <path> [--skip-install]",
	"  run-demos --playwright-root <path> --chromium-bin <path> --output-dir <path>",
] as const;

export type BuildCoreCommand = {
	kind: "build-core";
	playwrightRoot: string;
	skipInstall: boolean;
};

export type RunE2eCommand = {
	kind: "run-e2e";
	playwrightRoot: string;
	chromiumBin: string;
};

export type BuildAndE2eCommand = {
	kind: "build-and-e2e";
	playwrightRoot: string;
	chromiumBin: string;
	skipInstall: boolean;
};

export type RunDemosCommand = {
	kind: "run-demos";
	playwrightRoot: string;
	chromiumBin: string;
	outputDir: string;
};

export type AutomationCommand =
	| BuildCoreCommand
	| RunE2eCommand
	| BuildAndE2eCommand
	| RunDemosCommand;

const parseBuildCoreCommand = (
	argv: readonly string[],
	usage: string,
): BuildCoreCommand => {
	const { options, positionals } = parseWithCommander({
		argv,
		binaryName: "build-core",
		usage,
		configure: (command) => {
			command.option("--playwright-root <path>");
			command.option("--skip-install");
		},
	});
	requireNoPositionals({
		positionals,
		context: "build-core",
		usage,
	});
	return {
		kind: "build-core",
		playwrightRoot: requireOption({
			options,
			key: "playwrightRoot",
			flag: "--playwright-root",
			usage,
		}),
		skipInstall: readBooleanOption({
			options,
			key: "skipInstall",
		}),
	};
};

const parseRunE2eCommand = (
	argv: readonly string[],
	usage: string,
): RunE2eCommand => {
	const { options, positionals } = parseWithCommander({
		argv,
		binaryName: "run-e2e",
		usage,
		configure: (command) => {
			command.option("--playwright-root <path>");
			command.option("--chromium-bin <path>");
		},
	});
	requireNoPositionals({
		positionals,
		context: "run-e2e",
		usage,
	});
	return {
		kind: "run-e2e",
		playwrightRoot: requireOption({
			options,
			key: "playwrightRoot",
			flag: "--playwright-root",
			usage,
		}),
		chromiumBin: requireOption({
			options,
			key: "chromiumBin",
			flag: "--chromium-bin",
			usage,
		}),
	};
};

const parseBuildAndE2eCommand = (
	argv: readonly string[],
	usage: string,
): BuildAndE2eCommand => {
	const { options, positionals } = parseWithCommander({
		argv,
		binaryName: "build-and-e2e",
		usage,
		configure: (command) => {
			command.option("--playwright-root <path>");
			command.option("--chromium-bin <path>");
			command.option("--skip-install");
		},
	});
	requireNoPositionals({
		positionals,
		context: "build-and-e2e",
		usage,
	});
	return {
		kind: "build-and-e2e",
		playwrightRoot: requireOption({
			options,
			key: "playwrightRoot",
			flag: "--playwright-root",
			usage,
		}),
		chromiumBin: requireOption({
			options,
			key: "chromiumBin",
			flag: "--chromium-bin",
			usage,
		}),
		skipInstall: readBooleanOption({
			options,
			key: "skipInstall",
		}),
	};
};

const parseRunDemosCommand = (
	argv: readonly string[],
	usage: string,
): RunDemosCommand => {
	const { options, positionals } = parseWithCommander({
		argv,
		binaryName: "run-demos",
		usage,
		configure: (command) => {
			command.option("--playwright-root <path>");
			command.option("--chromium-bin <path>");
			command.option("--output-dir <path>");
		},
	});
	requireNoPositionals({
		positionals,
		context: "run-demos",
		usage,
	});
	return {
		kind: "run-demos",
		playwrightRoot: requireOption({
			options,
			key: "playwrightRoot",
			flag: "--playwright-root",
			usage,
		}),
		chromiumBin: requireOption({
			options,
			key: "chromiumBin",
			flag: "--chromium-bin",
			usage,
		}),
		outputDir: requireOption({
			options,
			key: "outputDir",
			flag: "--output-dir",
			usage,
		}),
	};
};

export const parseAutomationCommand = (
	argv: readonly string[],
	usage: string,
): AutomationCommand | undefined => {
	const commandName = argv[0];
	switch (commandName) {
		case "build-core":
			return parseBuildCoreCommand(argv.slice(1), usage);
		case "run-e2e":
			return parseRunE2eCommand(argv.slice(1), usage);
		case "build-and-e2e":
			return parseBuildAndE2eCommand(argv.slice(1), usage);
		case "run-demos":
			return parseRunDemosCommand(argv.slice(1), usage);
		default:
			return undefined;
	}
};

export const runAutomationCommand = async (
	command: AutomationCommand,
): Promise<number> => {
	switch (command.kind) {
		case "build-core":
			await buildPlaywrightCore({
				playwrightRoot: command.playwrightRoot,
				skipInstall: command.skipInstall,
			});
			return 0;

		case "run-e2e": {
			const playwrightRoot = ensurePathExists(
				command.playwrightRoot,
				"playwright root path",
			);
			const chromiumBin = ensurePathExists(
				command.chromiumBin,
				"chromium binary",
			);
			await runE2ESmoke({
				playwrightRoot,
				chromiumBin,
			});
			return 0;
		}

		case "build-and-e2e": {
			const chromiumBin = ensurePathExists(
				command.chromiumBin,
				"chromium binary",
			);
			const playwrightRoot = await buildPlaywrightCore({
				playwrightRoot: command.playwrightRoot,
				skipInstall: command.skipInstall,
			});
			await runE2ESmoke({
				playwrightRoot,
				chromiumBin,
			});
			return 0;
		}

		case "run-demos": {
			const playwrightRoot = ensurePathExists(
				command.playwrightRoot,
				"playwright root path",
			);
			const chromiumBin = ensurePathExists(
				command.chromiumBin,
				"chromium binary",
			);
			const outputDir = path.resolve(command.outputDir);
			fs.mkdirSync(outputDir, { recursive: true });
			await runDemoSuite({
				playwrightRoot,
				chromiumBin,
				outputDir,
			});
			return 0;
		}
	}
};
