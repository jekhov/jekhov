// pattern: Imperative Shell
import type { Browser, Page } from "playwright";
import { chromium } from "playwright";
import type { BrowserObserver, PageObservation, Result } from "./types.js";

async function observePage(page: Page): Promise<Result<PageObservation>> {
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

export function createPlaywrightPageObserver(page: Page): BrowserObserver {
	return {
		observe: () => observePage(page),
	};
}

export function createPlaywrightObserver(
	options: { executablePath?: string; navigationTimeoutMs?: number } = {},
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
				return await observePage(page);
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
