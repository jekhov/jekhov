// pattern: Imperative Shell
import type { Browser } from "playwright";
import { chromium } from "playwright";
import type { BrowserObserver } from "./types.js";

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
			} finally {
				await browser?.close().catch(() => undefined);
			}
		},
	};
}
