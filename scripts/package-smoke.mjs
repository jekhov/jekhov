// pattern: Imperative Shell
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const directory = await mkdtemp(join(tmpdir(), "jekhov-package-smoke-"));
const npmEnvironment = { ...process.env, npm_config_dry_run: "false" };
const packageMetadata = JSON.parse(
	await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
try {
	const { stdout } = await execFileAsync(
		"npm",
		["pack", "--pack-destination", directory, "--json"],
		{ env: npmEnvironment, maxBuffer: 1024 * 1024 },
	);
	const report = JSON.parse(stdout);
	const packed = report[0];
	const files = new Set(packed?.files?.map((entry) => entry.path));
	const required = [
		"dist/cli.js",
		"dist/index.d.ts",
		"dist/jev-policy-client.js",
		"dist/validation.js",
		"examples/synthetic-plan.json",
		"examples/synthetic-task.json",
		"corpora/synthetic-v1.json",
		"corpora/synthetic-v2.json",
		"corpora/miniwob-v1.json",
		"corpora/README.md",
		"CHANGELOG.md",
		"README.md",
		"LICENSE",
	];
	const missing = required.filter((path) => !files.has(path));
	if (missing.length > 0) throw new Error(`package is missing: ${missing.join(", ")}`);
	if (typeof packed?.filename !== "string") throw new Error("npm pack did not return a filename");

	const installDirectory = join(directory, "install");
	await mkdir(installDirectory);
	await writeFile(
		join(installDirectory, "package.json"),
		`${JSON.stringify({ name: "jekhov-package-smoke", private: true })}\n`,
	);
	await execFileAsync(
		"npm",
		["install", join(directory, packed.filename), "--no-audit", "--no-fund"],
		{ cwd: installDirectory, env: npmEnvironment, maxBuffer: 1024 * 1024 },
	);
	const binDirectory = join(installDirectory, "node_modules", ".bin");
	const cli = await execFileAsync(join(binDirectory, "jekhov"), ["--help"]);
	if (!cli.stdout.includes("jekhov demo") || !cli.stdout.includes("jekhov miniwob run")) {
		throw new Error("installed jekhov bin did not expose the expected commands");
	}
	const version = await execFileAsync(join(binDirectory, "jekhov"), ["--version"]);
	if (version.stdout.trim() !== packageMetadata.version) {
		throw new Error("installed jekhov bin version drifted from package.json");
	}
	const validationReportPath = join(installDirectory, "validation-report.json");
	await execFileAsync(join(binDirectory, "jekhov"), [
		"validate",
		"--plan",
		join(installDirectory, "node_modules", "jekhov", "examples", "synthetic-plan.json"),
		"--output",
		validationReportPath,
	]);
	const validationReport = JSON.parse(await readFile(validationReportPath, "utf8"));
	if (
		validationReport.valid !== true ||
		validationReport.executed !== false ||
		validationReport.providerRequestCount !== 0
	) {
		throw new Error("installed jekhov bin did not validate a packaged plan offline");
	}
	const wrapper = await execFileAsync(join(binDirectory, "jekhov-jev-client"), ["--help"]);
	if (!wrapper.stdout.includes("public|synthetic")) {
		throw new Error("installed Jev policy wrapper did not run");
	}
	await execFileAsync(
		process.execPath,
		[
			"--input-type=module",
			"--eval",
			"const packageRoot = await import('jekhov'); if (typeof packageRoot.runShadowSelection !== 'function' || typeof packageRoot.validateArtifact !== 'function' || typeof packageRoot.JEKHOV_VERSION !== 'string') process.exit(17);",
		],
		{ cwd: installDirectory, env: npmEnvironment, maxBuffer: 1024 * 1024 },
	);
	const selectorClient = join(installDirectory, "selector-client.mjs");
	const taskReportPath = join(installDirectory, "task-report.json");
	await writeFile(
		selectorClient,
		`import { readFileSync, writeFileSync } from "node:fs";
const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, all) => {
  if (value.startsWith("--")) pairs.push([value, all[index + 1]]);
  return pairs;
}, []));
const request = JSON.parse(readFileSync(args["--input"], "utf8"));
const names = { fill: "Product", select: "Size", check: "Used only", click: "Search" };
const choice = request.state.candidates.find((item) => item.name === names[request.state.intended_action])?.id ?? "none";
writeFileSync(args["--output"], JSON.stringify({
  provenance: { provider: "package-smoke" },
  answers: { next_element: { choice }, unambiguous_match: { noul: choice === "none" ? 0 : 1 } }
}));
`,
		{ mode: 0o600 },
	);
	await execFileAsync(join(binDirectory, "jekhov"), [
		"task",
		"--plan",
		join(installDirectory, "node_modules", "jekhov", "examples", "synthetic-task.json"),
		"--jev-client",
		selectorClient,
		"--output",
		taskReportPath,
	]);
	const taskReport = JSON.parse(await readFile(taskReportPath, "utf8"));
	if (taskReport.status !== "completed" || taskReport.confirmedStepCount !== 4) {
		throw new Error("installed package did not complete its synthetic task");
	}
	process.stdout.write(`package smoke passed (${files.size} files; installed bins ran)\n`);
} finally {
	await rm(directory, { recursive: true, force: true });
}
