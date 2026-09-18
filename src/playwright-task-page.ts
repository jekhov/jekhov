// pattern: Imperative Shell
import type { Browser, Page } from "playwright";
import { chromium } from "playwright";
import { observePlaywrightPage } from "./playwright-observation.js";
import type {
	SyntheticTaskAction,
	SyntheticTaskPage,
	SyntheticTaskPostcondition,
} from "./synthetic-task.js";
import { parseSyntheticTaskPlan } from "./synthetic-task.js";
import type { SyntheticTaskReport } from "./synthetic-task-run.js";
import { runSyntheticTask } from "./synthetic-task-run.js";
import type { JevEvaluator, Result } from "./types.js";

function failed(code: string, message: string): Result<undefined> {
	return { ok: false, error: { code, message } };
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

function within<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
	return new Promise<T>((resolveWithin, rejectWithin) => {
		const timer = setTimeout(
			() => rejectWithin(new Error("postcondition check timed out")),
			timeoutMs,
		);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolveWithin(value);
			},
			(error: unknown) => {
				clearTimeout(timer);
				rejectWithin(error);
			},
		);
	});
}

async function postconditionMatches(
	page: Page,
	postcondition: SyntheticTaskPostcondition,
): Promise<boolean> {
	const locator = page.locator(postcondition.selector);
	if ((await locator.count()) !== 1) return false;
	if (postcondition.type === "checked") {
		return (await locator.isChecked()) === postcondition.equals;
	}
	if (postcondition.type === "visible") {
		return (await locator.isVisible()) === postcondition.equals;
	}
	if (postcondition.type === "value") {
		return (await locator.inputValue()) === postcondition.equals;
	}
	return normalizeText(await locator.textContent()) === normalizeText(postcondition.equals);
}

async function verify(
	page: Page,
	postcondition: SyntheticTaskPostcondition,
	timeoutMs: number,
): Promise<Result<undefined>> {
	const deadline = Date.now() + timeoutMs;
	try {
		while (Date.now() <= deadline) {
			const remainingForCheck = Math.max(1, deadline - Date.now());
			const matches = await within(postconditionMatches(page, postcondition), remainingForCheck);
			if (matches) return { ok: true, value: undefined };
			const remaining = deadline - Date.now();
			if (remaining <= 0) break;
			await new Promise((resolveDelay) => setTimeout(resolveDelay, Math.min(50, remaining)));
		}
		return failed(
			"postcondition-failed",
			`postcondition ${postcondition.type} did not match within ${timeoutMs} milliseconds for ${JSON.stringify(postcondition.selector)}`,
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
		observe: (timeoutMs) => observePlaywrightPage(page, timeoutMs),
		currentUrl: () => page.url(),
		act: (action) => act(page, action),
		verify: (postcondition, timeoutMs = 5_000) => verify(page, postcondition, timeoutMs),
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
