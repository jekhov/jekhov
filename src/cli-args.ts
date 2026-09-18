// pattern: Functional Core
import type { Result } from "./types.js";

export type CliOptions =
	| { command: "help" }
	| {
			command: "demo";
			outputPath?: string;
			jevClientPath?: string;
			chromiumPath?: string;
	  }
	| {
			command: "evaluate";
			corpusPath: string;
			baselineClientPath: string;
			outputPath?: string;
			jevClientPath?: string;
			pricingPath?: string;
	  }
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
	if (
		command !== "demo" &&
		command !== "evaluate" &&
		command !== "inspect" &&
		command !== "shadow"
	) {
		return invalid("command must be demo, evaluate, inspect, or shadow");
	}

	const values: Record<string, string> = {};
	const allowed = new Set(
		command === "evaluate"
			? ["--baseline-client", "--corpus", "--jev-client", "--output", "--pricing"]
			: command === "demo"
				? ["--chromium", "--jev-client", "--output"]
				: ["--chromium", "--jev-client", "--output", "--plan"],
	);
	for (let index = 1; index < argv.length; index += 2) {
		const flag = argv[index];
		if (!flag || !allowed.has(flag)) return invalid(`unknown argument: ${flag ?? "(missing)"}`);
		const value = argv[index + 1];
		if (!value || value.startsWith("--")) return invalid(`${flag} requires a value`);
		values[flag] = value;
	}
	if (command === "evaluate") {
		if (!values["--corpus"]) return invalid("--corpus is required");
		if (!values["--baseline-client"]) return invalid("--baseline-client is required");
		return {
			ok: true,
			value: {
				command,
				corpusPath: values["--corpus"],
				baselineClientPath: values["--baseline-client"],
				...(values["--jev-client"] ? { jevClientPath: values["--jev-client"] } : {}),
				...(values["--pricing"] ? { pricingPath: values["--pricing"] } : {}),
				...(values["--output"] ? { outputPath: values["--output"] } : {}),
			},
		};
	}
	if (command === "demo") {
		return {
			ok: true,
			value: {
				command,
				...(values["--output"] ? { outputPath: values["--output"] } : {}),
				...(values["--jev-client"] ? { jevClientPath: values["--jev-client"] } : {}),
				...(values["--chromium"] ? { chromiumPath: values["--chromium"] } : {}),
			},
		};
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
