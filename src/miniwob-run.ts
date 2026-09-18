// pattern: Imperative Shell
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type { Browser, Page } from "playwright";
import { chromium } from "playwright";
import { collectActionCandidates } from "./candidates.js";
import type { EvaluationCorpus } from "./evaluation-corpus.js";
import { parseEvaluationCorpus } from "./evaluation-corpus.js";
import type { MiniwobTaskName } from "./miniwob.js";
import { buildMiniwobTaskPlan, MINIWOB_REVISION, MINIWOB_TASKS } from "./miniwob.js";
import { createPlaywrightTaskPage } from "./playwright-task-page.js";
import type {
	SyntheticTaskAction,
	SyntheticTaskPlan,
	SyntheticTaskStep,
} from "./synthetic-task.js";
import type { SyntheticTaskReport } from "./synthetic-task-run.js";
import { runValidatedSyntheticTask } from "./synthetic-task-run.js";
import type { Failure, JevEvaluator, Result, ShadowPlan } from "./types.js";

const execFileAsync = promisify(execFile);

export interface MiniwobBenchmarkCase {
	taskName: MiniwobTaskName;
	seed: number;
	goal: string;
	status: "failed" | "passed" | "stopped";
	done: boolean;
	rawReward: number;
	failure: Failure | null;
	task: SyntheticTaskReport | null;
}

export interface MiniwobBenchmarkReport {
	version: 1;
	benchmark: "MiniWoB++ oracle-gated Playwright slice";
	revision: string;
	tasks: MiniwobTaskName[];
	seeds: number[];
	caseCount: number;
	passed: number;
	stopped: number;
	failed: number;
	cases: MiniwobBenchmarkCase[];
}

function failure(code: string, message: string): Failure {
	return { code, message };
}

function contentType(path: string): string {
	const extension = extname(path);
	if (extension === ".css") return "text/css; charset=utf-8";
	if (extension === ".html") return "text/html; charset=utf-8";
	if (extension === ".js") return "text/javascript; charset=utf-8";
	if (extension === ".json") return "application/json; charset=utf-8";
	if (extension === ".png") return "image/png";
	if (extension === ".svg") return "image/svg+xml";
	return "application/octet-stream";
}

async function startStaticServer(root: string): Promise<{
	baseUrl: string;
	close(): Promise<void>;
}> {
	const absoluteRoot = resolve(root);
	const prefix = `${absoluteRoot}${sep}`;
	const server = createServer(async (request, response) => {
		try {
			const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
			const path = resolve(absoluteRoot, pathname.replace(/^\/+/, ""));
			if (!path.startsWith(prefix)) {
				response.writeHead(403).end("forbidden");
				return;
			}
			const metadata = await stat(path);
			if (!metadata.isFile()) {
				response.writeHead(404).end("not found");
				return;
			}
			response.writeHead(200, { "content-type": contentType(path) });
			createReadStream(path).pipe(response);
		} catch {
			response.writeHead(404).end("not found");
		}
	});
	await new Promise<void>((resolveListen, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => resolveListen());
	});
	const address = server.address() as AddressInfo;
	return {
		baseUrl: `http://127.0.0.1:${address.port}`,
		close: () =>
			new Promise((resolveClose, reject) => {
				server.close((error) => (error ? reject(error) : resolveClose()));
			}),
	};
}

async function checkboxSelectors(page: Page, goal: string): Promise<Record<string, string>> {
	const requested = goal.match(/^Select (.+) and click Submit\.$/)?.[1]?.trim();
	if (!requested || requested === "nothing") return {};
	const selectors: Record<string, string> = {};
	for (const name of requested.split(/,\s*/)) {
		const checkbox = page.getByRole("checkbox", { name, exact: true });
		if ((await checkbox.count()) !== 1) continue;
		const id = await checkbox.getAttribute("id");
		if (id && /^[A-Za-z][A-Za-z0-9_-]*$/.test(id)) selectors[name] = `#${id}`;
	}
	return selectors;
}

async function setupCase(
	page: Page,
	baseUrl: string,
	taskName: MiniwobTaskName,
	seed: number,
): Promise<{ goal: string; pageUrl: string; checkboxSelectors: Record<string, string> }> {
	const pageUrl = `${baseUrl}/miniwob/${taskName}.html`;
	await page.goto(pageUrl, { waitUntil: "load", timeout: 20_000 });
	await page.evaluate(
		`Math.seedrandom(${JSON.stringify(seed)}); core.EPISODE_MAX_TIME = 1000000; core.startEpisodeReal();`,
	);
	await page.waitForFunction("() => WOB_TASK_READY === true", undefined, { timeout: 5_000 });
	const goal = await page.evaluate<string>("core.getUtterance()");
	return {
		goal,
		pageUrl,
		checkboxSelectors: taskName === "click-checkboxes" ? await checkboxSelectors(page, goal) : {},
	};
}

async function rewardState(page: Page): Promise<{ done: boolean; rawReward: number }> {
	return page.evaluate<{ done: boolean; rawReward: number }>(
		"({ done: WOB_DONE_GLOBAL === true, rawReward: Number(WOB_RAW_REWARD_GLOBAL) })",
	);
}

async function verifyRevision(rootPath: string): Promise<Result<string>> {
	try {
		const root = resolve(rootPath);
		const { stdout } = await execFileAsync("git", ["-C", root, "rev-parse", "HEAD"]);
		const revision = stdout.trim();
		if (revision !== MINIWOB_REVISION) {
			return {
				ok: false,
				error: failure(
					"miniwob-revision-mismatch",
					`MiniWoB++ must be pinned to ${MINIWOB_REVISION}; found ${revision}`,
				),
			};
		}
		const { stdout: status } = await execFileAsync("git", [
			"-C",
			root,
			"status",
			"--porcelain",
			"--untracked-files=no",
		]);
		return status.trim().length === 0
			? { ok: true, value: revision }
			: {
					ok: false,
					error: failure(
						"miniwob-worktree-dirty",
						"MiniWoB++ tracked files must match the pinned revision",
					),
				};
	} catch (error) {
		return {
			ok: false,
			error: failure(
				"miniwob-root-invalid",
				error instanceof Error ? error.message : "Could not inspect MiniWoB++ root",
			),
		};
	}
}

interface PreparedMiniwobOptions {
	rootPath: string;
	revision: string;
	tasks: MiniwobTaskName[];
	seeds: number[];
}

async function prepareOptions(options: {
	rootPath: string;
	tasks?: MiniwobTaskName[];
	seeds?: number[];
}): Promise<Result<PreparedMiniwobOptions>> {
	const revision = await verifyRevision(options.rootPath);
	if (!revision.ok) return revision;
	const tasks = options.tasks ?? [...MINIWOB_TASKS];
	const seeds = options.seeds ?? [0];
	if (
		tasks.length === 0 ||
		new Set(tasks).size !== tasks.length ||
		tasks.some((task) => !MINIWOB_TASKS.includes(task))
	) {
		return {
			ok: false,
			error: failure(
				"invalid-miniwob-options",
				"tasks must contain unique supported MiniWoB tasks",
			),
		};
	}
	if (
		seeds.length === 0 ||
		seeds.length > 100 ||
		new Set(seeds).size !== seeds.length ||
		seeds.some((seed) => !Number.isSafeInteger(seed) || seed < 0 || seed > 1_000_000)
	) {
		return {
			ok: false,
			error: failure(
				"invalid-miniwob-options",
				"seeds must contain 1-100 unique integers from 0 through 1000000",
			),
		};
	}
	return {
		ok: true,
		value: { rootPath: resolve(options.rootPath), revision: revision.value, tasks, seeds },
	};
}

function stepAction(step: SyntheticTaskStep, ref: string, timeoutMs: number): SyntheticTaskAction {
	if (step.action === "fill" || step.action === "select") {
		return { action: step.action, ref, value: step.value ?? "", timeoutMs };
	}
	if (step.action === "check") {
		return { action: "check", ref, checked: step.checked ?? true, timeoutMs };
	}
	return { action: "click", ref, timeoutMs };
}

function shadowStepPlan(
	plan: SyntheticTaskPlan,
	step: SyntheticTaskStep,
	canonicalUrl: string,
): ShadowPlan {
	return {
		version: 1,
		mode: "shadow",
		goal: plan.goal,
		startUrl: canonicalUrl,
		dataClass: "synthetic",
		sourcePolicy: {
			...plan.sourcePolicy,
			allowedHosts: ["127.0.0.1"],
		},
		step: { id: step.id, action: step.action, goal: step.goal },
	};
}

async function startPreparedServer(
	prepared: PreparedMiniwobOptions,
): Promise<Result<Awaited<ReturnType<typeof startStaticServer>>>> {
	try {
		return {
			ok: true,
			value: await startStaticServer(join(prepared.rootPath, "miniwob", "html")),
		};
	} catch (error) {
		return {
			ok: false,
			error: failure(
				"miniwob-server-failed",
				error instanceof Error ? error.message : "Could not serve MiniWoB++",
			),
		};
	}
}

export async function runMiniwobBenchmark(options: {
	rootPath: string;
	jev: JevEvaluator;
	tasks?: MiniwobTaskName[];
	seeds?: number[];
	executablePath?: string;
	actionTimeoutMs?: number;
}): Promise<Result<MiniwobBenchmarkReport>> {
	const prepared = await prepareOptions(options);
	if (!prepared.ok) return prepared;
	const { revision, tasks, seeds } = prepared.value;
	const startedServer = await startPreparedServer(prepared.value);
	if (!startedServer.ok) return startedServer;
	const server = startedServer.value;
	let browser: Browser | undefined;
	const cases: MiniwobBenchmarkCase[] = [];
	try {
		browser = await chromium.launch({
			headless: true,
			...(options.executablePath ? { executablePath: options.executablePath } : {}),
		});
		for (const taskName of tasks) {
			for (const seed of seeds) {
				const page = await browser.newPage({ viewport: { width: 332, height: 214 } });
				try {
					const setup = await setupCase(page, server.baseUrl, taskName, seed);
					const plan = buildMiniwobTaskPlan({
						taskName,
						goal: setup.goal,
						pageUrl: setup.pageUrl,
						actionTimeoutMs: options.actionTimeoutMs ?? 5_000,
						checkboxSelectors: setup.checkboxSelectors,
					});
					if (!plan.ok) {
						cases.push({
							taskName,
							seed,
							goal: setup.goal,
							status: "failed",
							done: false,
							rawReward: 0,
							failure: plan.error,
							task: null,
						});
						continue;
					}
					const task = await runValidatedSyntheticTask(plan.value, {
						page: createPlaywrightTaskPage(page),
						jev: options.jev,
					});
					if (!task.ok) {
						cases.push({
							taskName,
							seed,
							goal: setup.goal,
							status: "failed",
							done: false,
							rawReward: 0,
							failure: task.error,
							task: null,
						});
						continue;
					}
					const reward = await rewardState(page);
					const passed = task.value.status === "completed" && reward.done && reward.rawReward > 0;
					cases.push({
						taskName,
						seed,
						goal: setup.goal,
						status: passed ? "passed" : "stopped",
						done: reward.done,
						rawReward: reward.rawReward,
						failure:
							task.value.stop ??
							(passed
								? null
								: failure("miniwob-validator-failed", "MiniWoB++ did not report success")),
						task: task.value,
					});
				} catch (error) {
					cases.push({
						taskName,
						seed,
						goal: "",
						status: "failed",
						done: false,
						rawReward: 0,
						failure: failure(
							"miniwob-case-failed",
							error instanceof Error ? error.message : "MiniWoB++ case failed",
						),
						task: null,
					});
				} finally {
					await page.close().catch(() => undefined);
				}
			}
		}
	} catch (error) {
		return {
			ok: false,
			error: failure(
				"miniwob-benchmark-failed",
				error instanceof Error ? error.message : "MiniWoB++ benchmark failed",
			),
		};
	} finally {
		await browser?.close().catch(() => undefined);
		await server.close().catch(() => undefined);
	}

	return {
		ok: true,
		value: {
			version: 1,
			benchmark: "MiniWoB++ oracle-gated Playwright slice",
			revision,
			tasks,
			seeds,
			caseCount: cases.length,
			passed: cases.filter((item) => item.status === "passed").length,
			stopped: cases.filter((item) => item.status === "stopped").length,
			failed: cases.filter((item) => item.status === "failed").length,
			cases,
		},
	};
}

export async function captureMiniwobCorpus(options: {
	rootPath: string;
	tasks?: MiniwobTaskName[];
	seeds?: number[];
	executablePath?: string;
	actionTimeoutMs?: number;
}): Promise<Result<EvaluationCorpus>> {
	const prepared = await prepareOptions(options);
	if (!prepared.ok) return prepared;
	const startedServer = await startPreparedServer(prepared.value);
	if (!startedServer.ok) return startedServer;
	const server = startedServer.value;
	let browser: Browser | undefined;
	const cases: EvaluationCorpus["cases"] = [];
	try {
		browser = await chromium.launch({
			headless: true,
			...(options.executablePath ? { executablePath: options.executablePath } : {}),
		});
		for (const taskName of prepared.value.tasks) {
			for (const seed of prepared.value.seeds) {
				const page = await browser.newPage({ viewport: { width: 332, height: 214 } });
				try {
					const setup = await setupCase(page, server.baseUrl, taskName, seed);
					const built = buildMiniwobTaskPlan({
						taskName,
						goal: setup.goal,
						pageUrl: setup.pageUrl,
						actionTimeoutMs: options.actionTimeoutMs ?? 5_000,
						checkboxSelectors: setup.checkboxSelectors,
					});
					if (!built.ok) return built;
					const taskPage = createPlaywrightTaskPage(page);
					const canonicalUrl = `http://127.0.0.1/miniwob/${taskName}.html`;
					for (const step of built.value.steps) {
						const observed = await taskPage.observe();
						if (!observed.ok) return observed;
						const collected = collectActionCandidates(observed.value.snapshot, {
							action: step.action,
						});
						if (!collected.ok) return collected;
						if (collected.value.omittedCount > 0) {
							return {
								ok: false,
								error: failure(
									"miniwob-capture-truncated",
									`${taskName} seed ${seed} step ${step.id} exceeded the candidate limit`,
								),
							};
						}
						const targets = collected.value.candidates.filter(
							(candidate) =>
								candidate.role === step.target.role && candidate.name === step.target.name,
						);
						if (targets.length === 0) {
							return {
								ok: false,
								error: failure(
									"miniwob-oracle-target-invalid",
									`${taskName} seed ${seed} step ${step.id} did not resolve a labeled target`,
								),
							};
						}
						const target = targets[0];
						if (!target) throw new Error("MiniWoB target count invariant failed");
						if (cases.length >= 200) {
							return {
								ok: false,
								error: failure(
									"miniwob-corpus-too-large",
									"captured corpus would exceed the 200-case evaluation limit",
								),
							};
						}
						cases.push({
							id: `${taskName}-seed-${seed}-${step.id}`,
							tags: ["miniwob", taskName, step.action, `seed-${seed}`],
							plan: shadowStepPlan(built.value, step, canonicalUrl),
							observation: {
								url: canonicalUrl,
								title: observed.value.title,
								snapshot: observed.value.snapshot,
							},
							label: { expectedRef: targets.length === 1 ? target.ref : null },
						});
						const acted = await taskPage.act(
							stepAction(step, target.ref, built.value.budget.actionTimeoutMs),
						);
						if (!acted.ok) return acted;
						for (const postcondition of step.postconditions) {
							const verified = await taskPage.verify(postcondition);
							if (!verified.ok) return verified;
						}
					}
					const reward = await rewardState(page);
					if (!reward.done || reward.rawReward <= 0) {
						return {
							ok: false,
							error: failure(
								"miniwob-validator-failed",
								`${taskName} seed ${seed} failed during oracle corpus capture`,
							),
						};
					}
				} finally {
					await page.close().catch(() => undefined);
				}
			}
		}
	} catch (error) {
		return {
			ok: false,
			error: failure(
				"miniwob-capture-failed",
				error instanceof Error ? error.message : "MiniWoB++ corpus capture failed",
			),
		};
	} finally {
		await browser?.close().catch(() => undefined);
		await server.close().catch(() => undefined);
	}

	return parseEvaluationCorpus({
		version: 1,
		name: `miniwob-grounding-${MINIWOB_REVISION.slice(0, 12)}`,
		cases,
	});
}
