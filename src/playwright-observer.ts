// pattern: Imperative Shell
import type { Browser, Page } from "playwright";
import { chromium } from "playwright";
import { observePlaywrightPage } from "./playwright-observation.js";
import type { BrowserObserver } from "./types.js";

export function createPlaywrightPageObserver(
	page: Page,
	options: { observationTimeoutMs?: number } = {},
): BrowserObserver {
	return {
		observe: () => observePlaywrightPage(page, options.observationTimeoutMs),
	};
}

export function createPlaywrightObserver(
	options: {
		executablePath?: string;
		navigationTimeoutMs?: number;
		observationTimeoutMs?: number;
	} = {},
): BrowserObserver {
	return {
		async observe(url) {
			let browser: Browser | undefined;
			try {
				browser = await chromium.launch({
					headless: true,
					...(options.executablePath ? { executablePath: options.executablePath } : {}),
				});
				const page = await browser.newPage();
				await page.goto(url, {
					waitUntil: "domcontentloaded",
					timeout: options.navigationTimeoutMs ?? 20_000,
				});
				return await observePlaywrightPage(page, options.observationTimeoutMs);
			} catch (error) {
				return {
					ok: false,
					error: {
						code: "browser-observation-failed",
						message: error instanceof Error ? error.message : "Playwright observation failed",
					},
				};
			} finally {
				await browser?.close().catch(() => undefined);
			}
		},
	};
}
