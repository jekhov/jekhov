// pattern: Imperative Shell
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { chromium } from "playwright";
import { describe, expect, it } from "vitest";
import { collectActionCandidates } from "./candidates.js";
import { createPlaywrightTaskPage, runSyntheticTaskInNewBrowser } from "./playwright-task-page.js";
import type { SyntheticTaskPlan } from "./synthetic-task.js";
import type { JevEvaluator, Result } from "./types.js";

const managedChromium = chromium.executablePath();
const executablePath =
	process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
	(existsSync(managedChromium)
		? undefined
		: existsSync("/snap/bin/chromium")
			? "/snap/bin/chromium"
			: undefined);
const browserAvailable = executablePath !== undefined || existsSync(managedChromium);

const html = `<title>Task fixture</title>
<label>Product <input id="query"></label>
<label>Size <select id="size"><option value="small">Small</option><option value="large">Large</option></select></label>
<label><input id="used" type="checkbox"> Used only</label>
<button id="search" onclick="document.querySelector('#result').textContent = document.querySelector('#query').value + ' / ' + document.querySelector('#size').value + ' / ' + (document.querySelector('#used').checked ? 'used' : 'new')">Search</button>
<output id="result"></output>`;

const task: SyntheticTaskPlan = {
	version: 1,
	mode: "synthetic-task",
	goal: "Search the synthetic inventory",
	startUrl: `data:text/html,${encodeURIComponent(html)}`,
	dataClass: "synthetic",
	sourcePolicy: {
		allowedHosts: [],
		basis: "synthetic",
		reviewedAt: "2026-09-18",
		note: "Repository-owned synthetic task fixture.",
	},
	budget: { maxSteps: 4, maxJevRequests: 4, actionTimeoutMs: 5_000 },
	steps: [
		{
			id: "query",
			action: "fill",
			goal: "Enter boots as the product query",
			value: "boots",
			target: { role: "textbox", name: "Product" },
			postconditions: [{ type: "value", selector: "#query", equals: "boots" }],
		},
		{
			id: "size",
			action: "select",
			goal: "Choose the large size",
			value: "large",
			target: { role: "combobox", name: "Size" },
			postconditions: [{ type: "value", selector: "#size", equals: "large" }],
		},
		{
			id: "condition",
			action: "check",
			goal: "Limit the search to used products",
			checked: true,
			target: { role: "checkbox", name: "Used only" },
			postconditions: [{ type: "checked", selector: "#used", equals: true }],
		},
		{
			id: "submit",
			action: "click",
			goal: "Submit the inventory search",
			target: { role: "button", name: "Search" },
			postconditions: [
				{ type: "text", selector: "#result", equals: "boots / large / used" },
				{ type: "visible", selector: "#result", equals: true },
			],
		},
	],
};

function oracleEvaluator(): JevEvaluator {
	return {
		async evaluate(request): Promise<Result<unknown>> {
			const target = task.steps.find(
				(step) => step.goal === request.state.goal && step.action === request.state.intended_action,
			)?.target;
			const choice = request.state.candidates.find(
				(candidate) => candidate.role === target?.role && candidate.name === target.name,
			)?.id;
			return {
				ok: true,
				value: {
					provenance: { provider: "synthetic-oracle" },
					usage: null,
					answers: {
						next_element: { choice: choice ?? "none" },
						unambiguous_match: { noul: choice ? 1 : 0 },
					},
				},
			};
		},
	};
}

describe.runIf(browserAvailable)("Playwright synthetic task execution", () => {
	it("acts on an accessibility reference and verifies deterministic state", async () => {
		const browser = await chromium.launch({
			headless: true,
			...(executablePath ? { executablePath } : {}),
		});
		try {
			const page = await browser.newPage();
			await page.goto(task.startUrl);
			const taskPage = createPlaywrightTaskPage(page);
			const observed = await taskPage.observe();
			expect(observed.ok).toBe(true);
			if (!observed.ok) throw new Error("page should be observable");
			const candidates = collectActionCandidates(observed.value.snapshot, { action: "fill" });
			expect(candidates.ok).toBe(true);
			if (!candidates.ok) throw new Error("fixture should have a textbox");
			const textbox = candidates.value.candidates[0];
			if (!textbox) throw new Error("fixture textbox should be a candidate");

			await expect(
				taskPage.act({
					action: "fill",
					ref: textbox.ref,
					value: "boots",
					timeoutMs: 5_000,
				}),
			).resolves.toEqual({ ok: true, value: undefined });
			await expect(
				taskPage.verify({ type: "value", selector: "#query", equals: "boots" }),
			).resolves.toEqual({ ok: true, value: undefined });
			const failed = await taskPage.verify({
				type: "value",
				selector: "#query",
				equals: "sandals",
			});
			expect(failed.ok).toBe(false);
		} finally {
			await browser.close();
		}
	});

	it("polls a deterministic postcondition within the action timeout", async () => {
		const browser = await chromium.launch({
			headless: true,
			...(executablePath ? { executablePath } : {}),
		});
		try {
			const page = await browser.newPage();
			await page.setContent("<output id='result'>waiting</output>");
			await page.evaluate(() => {
				setTimeout(() => {
					const result = document.querySelector("#result");
					if (result) result.textContent = "done";
				}, 100);
			});
			const taskPage = createPlaywrightTaskPage(page);

			await expect(
				taskPage.verify({ type: "text", selector: "#result", equals: "done" }, 1_000),
			).resolves.toEqual({ ok: true, value: undefined });
		} finally {
			await browser.close();
		}
	});

	it("completes a four-action task in a fresh browser", async () => {
		const result = await runSyntheticTaskInNewBrowser(
			task,
			oracleEvaluator(),
			executablePath ? { executablePath } : {},
		);

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("synthetic task should complete");
		expect(result.value.status).toBe("completed");
		expect(result.value.executedStepCount).toBe(4);
		expect(result.value.jevRequestCount).toBe(4);
		expect(result.value.steps.map((step) => step.action)).toEqual([
			"fill",
			"select",
			"check",
			"click",
		]);
	});

	it("keeps data fixtures offline while executing browser actions", async () => {
		let externalRequests = 0;
		const server = createServer((_request, response) => {
			externalRequests += 1;
			response.writeHead(204).end();
		});
		await new Promise<void>((resolveListen, reject) => {
			server.once("error", reject);
			server.listen(0, "127.0.0.1", resolveListen);
		});
		try {
			const port = (server.address() as AddressInfo).port;
			const offlineHtml = `<button onclick="document.querySelector('output').textContent='done'; new Image().src='http://127.0.0.1:${port}/beacon'">Run</button><output></output>`;
			const offlineTask: SyntheticTaskPlan = {
				...task,
				goal: "Run an offline synthetic action",
				startUrl: `data:text/html,${encodeURIComponent(offlineHtml)}`,
				budget: { maxSteps: 1, maxJevRequests: 1, actionTimeoutMs: 5_000 },
				steps: [
					{
						id: "run",
						action: "click",
						goal: "Click Run",
						target: { role: "button", name: "Run" },
						postconditions: [{ type: "text", selector: "output", equals: "done" }],
					},
				],
			};
			const evaluator: JevEvaluator = {
				async evaluate(request) {
					return {
						ok: true,
						value: {
							provenance: { provider: "synthetic-oracle" },
							answers: {
								next_element: { choice: request.state.candidates[0]?.id ?? "none" },
								unambiguous_match: { noul: 1 },
							},
						},
					};
				},
			};

			const result = await runSyntheticTaskInNewBrowser(
				offlineTask,
				evaluator,
				executablePath ? { executablePath } : {},
			);

			expect(result.ok && result.value.status).toBe("completed");
			expect(externalRequests).toBe(0);
		} finally {
			await new Promise<void>((resolveClose, reject) => {
				server.close((error) => (error ? reject(error) : resolveClose()));
			});
		}
	});
});
