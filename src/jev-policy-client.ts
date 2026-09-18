#!/usr/bin/env node
// pattern: Imperative Shell
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import {
	JEV_MODEL,
	MAX_JEV_REQUEST_BYTES,
	validateJevPolicyRequest,
	validateJevPolicyResponse,
} from "./jev-policy.js";

interface ClientArgs {
	dataClass: string | undefined;
	dryRun: boolean;
	help: boolean;
	inputPath: string | undefined;
	outputPath: string | undefined;
}

const USAGE =
	"Usage: jekhov-jev-client --data-class public|synthetic --input REQUEST.json [--output RESPONSE.json] [--dry-run]";

function parseArgs(argv: string[]): ClientArgs {
	const parsed: ClientArgs = {
		dataClass: undefined,
		dryRun: false,
		help: false,
		inputPath: undefined,
		outputPath: undefined,
	};
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === "--dry-run") parsed.dryRun = true;
		else if (argument === "--help" || argument === "-h") parsed.help = true;
		else if (argument === "--data-class") parsed.dataClass = argv[++index];
		else if (argument === "--input") parsed.inputPath = argv[++index];
		else if (argument === "--output") parsed.outputPath = argv[++index];
		else throw new Error(`unknown argument: ${argument}`);
	}
	return parsed;
}

function hashJson(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function writePrivate(path: string, value: unknown): Promise<void> {
	const absolute = resolve(path);
	await mkdir(dirname(absolute), { recursive: true, mode: 0o700 });
	await writeFile(absolute, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
	await chmod(absolute, 0o600);
}

async function emit(value: unknown, outputPath?: string): Promise<void> {
	if (outputPath) await writePrivate(outputPath, value);
	else process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function cacheDirectory(): string {
	const root = process.env.XDG_CACHE_HOME?.trim() || join(homedir(), ".cache");
	return join(root, "jekhov", "jev-responses");
}

async function readCached(path: string): Promise<unknown | undefined> {
	try {
		return JSON.parse(await readFile(path, "utf8"));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}

export async function runJevPolicyClient(argv = process.argv.slice(2)): Promise<number> {
	const args = parseArgs(argv);
	if (args.help) {
		process.stdout.write(`${USAGE}\n`);
		return 0;
	}
	if (!args.inputPath || !args.dataClass) throw new Error(USAGE);
	const inputText = await readFile(resolve(args.inputPath), "utf8");
	if (Buffer.byteLength(inputText, "utf8") > MAX_JEV_REQUEST_BYTES) {
		throw new Error(`input exceeds the ${MAX_JEV_REQUEST_BYTES}-byte local ceiling`);
	}
	const input: unknown = JSON.parse(inputText);
	const request = validateJevPolicyRequest(input, args.dataClass);
	if (!request.ok) throw new Error(request.error.message);
	const requestHash = hashJson(request.value);
	if (args.dryRun) {
		await emit(
			{
				provenance: {
					provider: "typesafe",
					requested_model: JEV_MODEL,
					data_class: args.dataClass,
					request_sha256: requestHash,
					validated_only: true,
				},
			},
			args.outputPath,
		);
		return 0;
	}

	const cachePath = join(cacheDirectory(), `${requestHash}.json`);
	let payload = await readCached(cachePath);
	const cacheHit = payload !== undefined;
	let elapsedMs = 0;
	let endpoint = "https://api.typesafe.ai";
	if (!cacheHit) {
		const client = new TypeSafeClient({
			baseURL: endpoint,
			defaultModel: JEV_MODEL,
			fetch: (url, init) => fetch(url, { ...init, redirect: "error" }),
			logLevel: "off",
			retry: { maxRetries: 0 },
			timeout: 20_000,
		});
		endpoint = client.baseURL;
		const started = performance.now();
		payload = await client.systemOne(request.value);
		elapsedMs = Math.round(performance.now() - started);
		const checked = validateJevPolicyResponse(payload, request.value.questions);
		if (!checked.ok) throw new Error(checked.error.message);
		await writePrivate(cachePath, checked.value);
	}
	const checked = validateJevPolicyResponse(payload, request.value.questions);
	if (!checked.ok) throw new Error(checked.error.message);
	await emit(
		{
			provenance: {
				provider: "typesafe",
				endpoint: `${endpoint}/v1/systemone`,
				requested_model: JEV_MODEL,
				returned_model: checked.value.model,
				data_class: args.dataClass,
				request_sha256: requestHash,
				cache_hit: cacheHit,
				elapsed_ms: elapsedMs,
			},
			usage: checked.value.usage ?? null,
			answers: checked.value.answers,
		},
		args.outputPath,
	);
	return 0;
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(realpathSync(resolve(process.argv[1]))).href
) {
	runJevPolicyClient().catch((error: unknown) => {
		process.stderr.write(
			`jekhov-jev-client: ${error instanceof Error ? error.message : "request failed"}\n`,
		);
		process.exitCode = 1;
	});
}
