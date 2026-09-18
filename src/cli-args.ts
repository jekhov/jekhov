// pattern: Functional Core
import type { Result } from "./types.js";

export type CliOptions =
	| { command: "help" }
	| {
			command: "inspect" | "shadow";
			planPath: string;
			outputPath?: string;
			jevClientPath?: string;
			chromiumPath?: string;
	  };

function invalid(message: string): Result<CliOptions> {
	return { ok: false, error: { code: "invalid-cli", message } };
}

export function parseCliArgs(argv: string[]): Result<CliOptions> {
	if (argv[0] === "--help" || argv[0] === "-h") return { ok: true, value: { command: "help" } };
	const command = argv[0];
	if (command !== "inspect" && command !== "shadow") {
		return invalid("command must be inspect or shadow");
	}

	const values: Record<string, string> = {};
	const allowed = new Set(["--chromium", "--jev-client", "--output", "--plan"]);
	for (let index = 1; index < argv.length; index += 2) {
		const flag = argv[index];
		if (!flag || !allowed.has(flag)) return invalid(`unknown argument: ${flag ?? "(missing)"}`);
		const value = argv[index + 1];
		if (!value || value.startsWith("--")) return invalid(`${flag} requires a value`);
		values[flag] = value;
	}
	if (!values["--plan"]) return invalid("--plan is required");

	return {
		ok: true,
		value: {
			command,
			planPath: values["--plan"],
			...(values["--output"] ? { outputPath: values["--output"] } : {}),
			...(values["--jev-client"] ? { jevClientPath: values["--jev-client"] } : {}),
			...(values["--chromium"] ? { chromiumPath: values["--chromium"] } : {}),
		},
	};
}
