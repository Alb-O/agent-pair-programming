import {
	AUTOMATION_COMMAND_USAGE_LINES,
	parseAutomationCommand,
	runAutomationCommand,
	type AutomationCommand,
} from "./modules/automation/module";

const USAGE = [
	"usage: pp-automation <command> [options]",
	"",
	"commands:",
	...AUTOMATION_COMMAND_USAGE_LINES,
].join("\n");

const parseAutomationArgs = (argv: readonly string[]): AutomationCommand => {
	if (argv.length === 0) {
		throw new Error(USAGE);
	}
	const parsed = parseAutomationCommand(argv, USAGE);
	if (parsed !== undefined) {
		return parsed;
	}
	const commandName = argv[0];
	throw new Error(`unknown command '${commandName}'\n${USAGE}`);
};

const runAutomationCli = async (argv: readonly string[]): Promise<number> =>
	runAutomationCommand(parseAutomationArgs(argv));

export { USAGE, runAutomationCli };

if (require.main === module) {
	runAutomationCli(process.argv.slice(2)).catch((error) => {
		if (error instanceof Error) {
			process.stderr.write(`${error.message}\n`);
			process.exit(1);
		}
		throw error;
	});
}
