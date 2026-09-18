// pattern: Functional Core
import { MINIWOB_TASKS, type MiniwobTaskName } from "./miniwob.js";
import type { Result } from "./types.js";

export type CliOptions =
	| { command: "help" }
	| { command: "version" }
	| { command: "validate"; planPath: string; outputPath?: string }
	| { command: "validate"; corpusPath: string; outputPath?: string }
	| { command: "validate"; pricingPath: string; outputPath?: string }
	| {
			command: "demo";
			outputPath?: string;
			jevClientPath?: string;
			chromiumPath?: string;
	  }
	| {
			command: "evaluate";
			corpusPath: string;
			baselineClientPath?: string;
			outputPath?: string;
			jevClientPath?: string;
			pricingPath?: string;
	  }
	| {
			command: "inspect" | "shadow" | "task";
			planPath: string;
			outputPath?: string;
			jevClientPath?: string;
			chromiumPath?: string;
	  }
	| {
			command: "miniwob";
			operation: "capture" | "run";
			rootPath: string;
			tasks?: MiniwobTaskName[];
			seeds?: number[];
			outputPath?: string;
			jevClientPath?: string;
			chromiumPath?: string;
	  };

function invalid<T = CliOptions>(message: string): Result<T> {
	return { ok: false, error: { code: "invalid-cli", message } };
}

function parseFlagValues(
	argv: string[],
	start: number,
	allowed: ReadonlySet<string>,
): Result<Record<string, string>> {
	const values: Record<string, string> = {};
	for (let index = start; index < argv.length; index += 2) {
		const flag = argv[index];
		if (!flag || !allowed.has(flag)) return invalid(`unknown argument: ${flag ?? "(missing)"}`);
		if (Object.hasOwn(values, flag)) return invalid(`duplicate argument: ${flag}`);
		const value = argv[index + 1];
		if (!value || value.startsWith("--")) return invalid(`${flag} requires a value`);
		values[flag] = value;
	}
	return { ok: true, value: values };
}

function parseMiniwobTasks(value: string | undefined): Result<MiniwobTaskName[] | undefined> {
	if (value === undefined) return { ok: true, value: undefined };
	const tasks = [...new Set(value.split(",").map((task) => task.trim()))];
	if (tasks.length === 0 || tasks.some((task) => task.length === 0)) {
		return invalid("MiniWoB tasks must be a comma-separated list");
	}
	for (const task of tasks) {
		if (!(MINIWOB_TASKS as readonly string[]).includes(task)) {
			return invalid(`unsupported MiniWoB task: ${task}`);
		}
	}
	return { ok: true, value: tasks as MiniwobTaskName[] };
}

function parseMiniwobSeeds(value: string | undefined): Result<number[] | undefined> {
	if (value === undefined) return { ok: true, value: undefined };
	const seeds: number[] = [];
	for (const part of value.split(",")) {
		if (/^\d+$/.test(part)) seeds.push(Number(part));
		else {
			const match = part.match(/^(\d+)-(\d+)$/);
			if (!match) return invalid(`invalid MiniWoB seed: ${part}`);
			const start = Number(match[1]);
			const end = Number(match[2]);
			if (
				!Number.isSafeInteger(start) ||
				!Number.isSafeInteger(end) ||
				start < 0 ||
				end > 1_000_000
			) {
				return invalid("MiniWoB seeds must be integers from 0 through 1000000");
			}
			if (start > end) return invalid(`invalid MiniWoB seed range: ${part}`);
			if (end - start + 1 > 100 - seeds.length) {
				return invalid("at most 100 MiniWoB seeds are supported");
			}
			for (let seed = start; seed <= end; seed += 1) seeds.push(seed);
		}
		if (seeds.length > 100) return invalid("at most 100 MiniWoB seeds are supported");
	}
	if (
		seeds.length === 0 ||
		seeds.some((seed) => !Number.isSafeInteger(seed) || seed < 0 || seed > 1_000_000)
	) {
		return invalid("MiniWoB seeds must be integers from 0 through 1000000");
	}
	return { ok: true, value: [...new Set(seeds)] };
}

function parseMiniwobArgs(argv: string[]): Result<CliOptions> {
	const operation = argv[1];
	if (operation !== "capture" && operation !== "run") {
		return invalid("miniwob operation must be capture or run");
	}
	const allowed = new Set(["--chromium", "--output", "--root", "--seeds", "--tasks"]);
	if (operation === "run") allowed.add("--jev-client");
	const parsedValues = parseFlagValues(argv, 2, allowed);
	if (!parsedValues.ok) return parsedValues;
	const values = parsedValues.value;
	if (!values["--root"]) return invalid("--root is required");
	const tasks = parseMiniwobTasks(values["--tasks"]);
	if (!tasks.ok) return tasks;
	const seeds = parseMiniwobSeeds(values["--seeds"]);
	if (!seeds.ok) return seeds;
	return {
		ok: true,
		value: {
			command: "miniwob",
			operation,
			rootPath: values["--root"],
			...(tasks.value ? { tasks: tasks.value } : {}),
			...(seeds.value ? { seeds: seeds.value } : {}),
			...(values["--output"] ? { outputPath: values["--output"] } : {}),
			...(values["--jev-client"] ? { jevClientPath: values["--jev-client"] } : {}),
			...(values["--chromium"] ? { chromiumPath: values["--chromium"] } : {}),
		},
	};
}

export function parseCliArgs(argv: string[]): Result<CliOptions> {
	if (argv[0] === "--help" || argv[0] === "-h") return { ok: true, value: { command: "help" } };
	if (argv[0] === "--version" || argv[0] === "-v") {
		return { ok: true, value: { command: "version" } };
	}
	const command = argv[0];
	if (command === "miniwob") return parseMiniwobArgs(argv);
	if (command === "validate") {
		const parsedValues = parseFlagValues(
			argv,
			1,
			new Set(["--corpus", "--output", "--plan", "--pricing"]),
		);
		if (!parsedValues.ok) return parsedValues;
		const values = parsedValues.value;
		const inputs = ["--plan", "--corpus", "--pricing"].filter((flag) => values[flag]);
		if (inputs.length !== 1) {
			return invalid("validate requires exactly one of --plan, --corpus, or --pricing");
		}
		const shared = {
			command: "validate" as const,
			...(values["--output"] ? { outputPath: values["--output"] } : {}),
		};
		if (values["--plan"]) {
			return { ok: true, value: { ...shared, planPath: values["--plan"] } };
		}
		if (values["--corpus"]) {
			return { ok: true, value: { ...shared, corpusPath: values["--corpus"] } };
		}
		return { ok: true, value: { ...shared, pricingPath: values["--pricing"] as string } };
	}
	if (
		command !== "demo" &&
		command !== "evaluate" &&
		command !== "inspect" &&
		command !== "shadow" &&
		command !== "task"
	) {
		return invalid("command must be demo, evaluate, inspect, miniwob, shadow, task, or validate");
	}

	const allowed = new Set(
		command === "evaluate"
			? ["--baseline-client", "--corpus", "--jev-client", "--output", "--pricing"]
			: command === "demo"
				? ["--chromium", "--jev-client", "--output"]
				: ["--chromium", "--jev-client", "--output", "--plan"],
	);
	const parsedValues = parseFlagValues(argv, 1, allowed);
	if (!parsedValues.ok) return parsedValues;
	const values = parsedValues.value;
	if (command === "evaluate") {
		if (!values["--corpus"]) return invalid("--corpus is required");
		return {
			ok: true,
			value: {
				command,
				corpusPath: values["--corpus"],
				...(values["--baseline-client"] ? { baselineClientPath: values["--baseline-client"] } : {}),
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
