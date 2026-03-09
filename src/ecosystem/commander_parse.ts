import { Command, CommanderError } from "commander";

/**
 * Commander parse wrapper with normalized error text for legacy cli parity.
 */
export type CommanderParseResult = {
	options: Record<string, unknown>;
	positionals: string[];
};

const normalizeCommanderErrorMessage = (message: string): string => {
	const trimmed = message.replace(/^error:\s*/, "");
	const missingValueMatch = trimmed.match(
		/^option '([^']+?)\s+<[^']+>' argument missing$/,
	);
	if (missingValueMatch !== null) {
		return `option '${missingValueMatch[1]}' requires a value`;
	}
	return trimmed;
};

const formatCommanderError = (error: CommanderError, usage: string): Error =>
	new Error(`${normalizeCommanderErrorMessage(error.message)}\n${usage}`);

export const parseWithCommander = ({
	argv,
	binaryName,
	usage,
	configure,
}: {
	argv: readonly string[];
	binaryName: string;
	usage: string;
	configure: (command: Command) => void;
}): CommanderParseResult => {
	const command = new Command(binaryName);
	command.exitOverride();
	command.allowUnknownOption(false);
	command.allowExcessArguments(true);
	command.configureOutput({
		writeErr: () => undefined,
		outputError: () => undefined,
	});
	configure(command);
	try {
		command.parse(argv, { from: "user" });
	} catch (error) {
		if (error instanceof CommanderError) {
			throw formatCommanderError(error, usage);
		}
		throw error;
	}
	return {
		options: command.opts<Record<string, unknown>>(),
		positionals: command.args.map((value) => String(value)),
	};
};
