// pattern: Imperative Shell
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const directory = await mkdtemp(join(tmpdir(), "jekhov-package-smoke-"));
try {
	const { stdout } = await execFileAsync(
		"npm",
		["pack", "--pack-destination", directory, "--json"],
		{ maxBuffer: 1024 * 1024 },
	);
	const report = JSON.parse(stdout);
	const packed = report[0];
	const files = new Set(packed?.files?.map((entry) => entry.path));
	const required = [
		"dist/cli.js",
		"dist/index.d.ts",
		"dist/jev-policy-client.js",
		"examples/synthetic-plan.json",
		"corpora/synthetic-v1.json",
		"corpora/synthetic-v2.json",
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
		{ cwd: installDirectory, maxBuffer: 1024 * 1024 },
	);
	const binDirectory = join(installDirectory, "node_modules", ".bin");
	const cli = await execFileAsync(join(binDirectory, "jekhov"), ["--help"]);
	if (!cli.stdout.includes("jekhov demo")) throw new Error("installed jekhov bin did not run");
	const wrapper = await execFileAsync(join(binDirectory, "jekhov-jev-client"), ["--help"]);
	if (!wrapper.stdout.includes("public|synthetic")) {
		throw new Error("installed Jev policy wrapper did not run");
	}
	process.stdout.write(`package smoke passed (${files.size} files; installed bins ran)\n`);
} finally {
	await rm(directory, { recursive: true, force: true });
}
