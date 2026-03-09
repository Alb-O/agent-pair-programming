import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import * as esbuild from "esbuild";

type BuildPlaywrightCoreOptions = {
	playwrightRoot: string;
	skipInstall: boolean;
};

const REQUIRED_PATHS = [
	"packages/playwright-core",
	"packages/injected",
	"packages/playwright-ct-core",
	"utils",
];

const BUNDLE_DIRS = [
	"packages/playwright-core/bundles/utils",
	"packages/playwright-core/bundles/zip",
	"packages/playwright-core/bundles/mcp",
];

const runCommand = (
	command: string,
	args: readonly string[],
	cwd: string,
): void => {
	const result = spawnSync(command, args, {
		cwd,
		stdio: "inherit",
	});

	if (result.error !== undefined) {
		throw result.error;
	}
	if (result.status !== 0) {
		throw new Error(
			`command failed (${result.status}): ${command} ${args.join(" ")}`,
		);
	}
};

const ensurePathExists = (target: string, label: string): string => {
	const resolved = path.resolve(target);
	if (!fs.existsSync(resolved)) {
		throw new Error(`${label} does not exist: ${resolved}`);
	}
	return resolved;
};

const copyTree = (
	srcRoot: string,
	dir: string,
	predicate: (pathName: string) => boolean,
): void => {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const src = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			copyTree(srcRoot, src, predicate);
			continue;
		}
		if (!predicate(src)) {
			continue;
		}
		const rel = path.relative(srcRoot, src);
		const coreRoot = path.dirname(srcRoot);
		const dst = path.join(coreRoot, "lib", rel);
		fs.mkdirSync(path.dirname(dst), { recursive: true });
		fs.copyFileSync(src, dst);
	}
};

const installPlaywrightDependencies = (playwrightRoot: string): void => {
	runCommand("npm", ["ci", "--ignore-scripts"], playwrightRoot);
	for (const bundleDir of BUNDLE_DIRS) {
		runCommand(
			"npm",
			[
				"ci",
				"--save=false",
				"--fund=false",
				"--audit=false",
				"--omit=optional",
				"--prefix",
				bundleDir,
			],
			playwrightRoot,
		);
	}
};

const buildCoreArtifacts = async (playwrightRoot: string): Promise<void> => {
	const coreDir = path.join(playwrightRoot, "packages", "playwright-core");

	await esbuild.build({
		entryPoints: [path.join(coreDir, "src/**/*.ts")],
		outdir: path.join(coreDir, "lib"),
		platform: "node",
		format: "cjs",
		sourcemap: false,
	});

	await esbuild.build({
		bundle: true,
		format: "cjs",
		platform: "node",
		target: "ES2019",
		minify: true,
		entryPoints: [path.join(coreDir, "bundles/utils/src/utilsBundleImpl.ts")],
		outfile: path.join(coreDir, "lib/utilsBundleImpl/index.js"),
	});

	await esbuild.build({
		bundle: true,
		format: "cjs",
		platform: "node",
		target: "ES2019",
		minify: true,
		entryPoints: [path.join(coreDir, "bundles/zip/src/zipBundleImpl.ts")],
		outdir: path.join(coreDir, "lib"),
	});

	await esbuild.build({
		bundle: true,
		format: "cjs",
		platform: "node",
		target: "ES2019",
		minify: true,
		entryPoints: [path.join(coreDir, "bundles/mcp/src/mcpBundleImpl.ts")],
		outfile: path.join(coreDir, "lib/mcpBundleImpl/index.js"),
		external: ["express", "@anthropic-ai/sdk"],
		alias: { "raw-body": path.join(coreDir, "bundles/mcp/raw-body.ts") },
	});

	const srcRoot = path.join(coreDir, "src");
	copyTree(
		srcRoot,
		srcRoot,
		(src) =>
			src.endsWith(".js") || src.endsWith(".json") || src.endsWith(".png"),
	);

	const xdgSource = path.join(
		coreDir,
		"bundles/utils/node_modules/open/xdg-open",
	);
	const xdgTarget = path.join(coreDir, "lib/utilsBundleImpl/xdg-open");
	fs.mkdirSync(path.dirname(xdgTarget), { recursive: true });
	fs.copyFileSync(xdgSource, xdgTarget);
};

const validatePlaywrightLayout = (playwrightRoot: string): void => {
	for (const relPath of REQUIRED_PATHS) {
		ensurePathExists(
			path.join(playwrightRoot, relPath),
			`required path '${relPath}'`,
		);
	}
};

const buildPlaywrightCore = async ({
	playwrightRoot,
	skipInstall,
}: BuildPlaywrightCoreOptions): Promise<string> => {
	const resolvedRoot = ensurePathExists(playwrightRoot, "playwright root path");
	validatePlaywrightLayout(resolvedRoot);
	if (!skipInstall) {
		installPlaywrightDependencies(resolvedRoot);
	}

	runCommand("node", ["utils/generate_injected.js"], resolvedRoot);
	await buildCoreArtifacts(resolvedRoot);
	return resolvedRoot;
};

export { buildPlaywrightCore, ensurePathExists };
