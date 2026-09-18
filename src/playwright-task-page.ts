// pattern: Imperative Shell
import type { Browser, Page } from "playwright";
import { chromium } from "playwright";
import type {
	SyntheticTaskAction,
	SyntheticTaskPage,
	SyntheticTaskPostcondition,
} from "./synthetic-task.js";
import { parseSyntheticTaskPlan } from "./synthetic-task.js";
import type { SyntheticTaskReport } from "./synthetic-task-run.js";
import { runSyntheticTask } from "./synthetic-task-run.js";
import type { JevEvaluator, PageObservation, Result } from "./types.js";

function failed(code: string, message: string): Result<undefined> {
	return { ok: false, error: { code, message } };
}

async function observe(page: Page): Promise<Result<PageObservation>> {
	try {
		return {
			ok: true,
			value: {
				url: page.url(),
				title: await page.title(),
				snapshot: await page.ariaSnapshotJSON({ mode: "ai" }),
			},
		};
	} catch (error) {
		return {
			ok: false,
			error: {
				code: "browser-observation-failed",
				message: error instanceof Error ? error.message : "Playwright observation failed",
			},
		};
	}
}

async function act(page: Page, action: SyntheticTaskAction): Promise<Result<undefined>> {
	if (!/^[A-Za-z0-9_-]{1,80}$/.test(action.ref)) {
		return failed("browser-action-failed", "action reference is invalid");
	}
	try {
		const locator = page.locator(`aria-ref=${action.ref}`);
		if ((await locator.count()) !== 1) {
			return failed("browser-action-failed", "action reference is missing or ambiguous");
		}
		if (action.action === "click") await locator.click({ timeout: action.timeoutMs });
		else if (action.action === "fill") {
			await locator.fill(action.value, { timeout: action.timeoutMs });
		} else if (action.action === "select") {
			await locator.selectOption(action.value, { timeout: action.timeoutMs });
		} else if (action.action === "check" && action.checked) {
			await locator.check({ timeout: action.timeoutMs });
		} else if (action.action === "check") {
			await locator.uncheck({ timeout: action.timeoutMs });
		}
		return { ok: true, value: undefined };
	} catch (error) {
		return failed(
			"browser-action-failed",
			error instanceof Error ? error.message : "Playwright action failed",
		);
	}
}

function normalizeText(value: string | null): string {
	return (value ?? "").replace(/\s+/g, " ").trim();
}

async function verify(
	page: Page,
	postcondition: SyntheticTaskPostcondition,
): Promise<Result<undefined>> {
	try {
		const locator = page.locator(postcondition.selector);
		if ((await locator.count()) !== 1) {
			return failed(
				"postcondition-failed",
				`postcondition selector ${JSON.stringify(postcondition.selector)} did not resolve once`,
			);
		}
		let matches = false;
		if (postcondition.type === "checked") {
			matches = (await locator.isChecked()) === postcondition.equals;
		} else if (postcondition.type === "visible") {
			matches = (await locator.isVisible()) === postcondition.equals;
		} else if (postcondition.type === "value") {
			matches = (await locator.inputValue()) === postcondition.equals;
		} else {
			matches = normalizeText(await locator.textContent()) === normalizeText(postcondition.equals);
		}
		return matches
			? { ok: true, value: undefined }
			: failed(
					"postcondition-failed",
					`postcondition ${postcondition.type} did not match for ${JSON.stringify(postcondition.selector)}`,
				);
	} catch (error) {
		return failed(
			"postcondition-failed",
			error instanceof Error ? error.message : "Postcondition verification failed",
		);
	}
}

export function createPlaywrightTaskPage(page: Page): SyntheticTaskPage {
	return {
		observe: () => observe(page),
		currentUrl: () => page.url(),
		act: (action) => act(page, action),
		verify: (postcondition) => verify(page, postcondition),
	};
}

export async function runSyntheticTaskInNewBrowser(
	input: unknown,
	jev: JevEvaluator,
	options: { executablePath?: string; navigationTimeoutMs?: number } = {},
): Promise<Result<SyntheticTaskReport>> {
	const parsed = parseSyntheticTaskPlan(input);
	if (!parsed.ok) return parsed;
	let browser: Browser | undefined;
	try {
		browser = await chromium.launch({
			headless: true,
			...(options.executablePath ? { executablePath: options.executablePath } : {}),
		});
		const context = await browser.newContext({ serviceWorkers: "block" });
		await context.setOffline(true);
		const page = await context.newPage();
		await page.goto(parsed.value.startUrl, {
			waitUntil: "domcontentloaded",
			timeout: options.navigationTimeoutMs ?? 20_000,
		});
		return await runSyntheticTask(parsed.value, {
			page: createPlaywrightTaskPage(page),
			jev,
		});
	} catch (error) {
		return {
			ok: false,
			error: {
				code: "browser-task-failed",
				message: error instanceof Error ? error.message : "Playwright task failed",
			},
		};
	} finally {
		await browser?.close().catch(() => undefined);
	}
}
