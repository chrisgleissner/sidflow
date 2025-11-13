import type { Page } from '@playwright/test';

type ScreenshotPreferences = {
    version: number;
    theme: string;
};

export const PREFERENCES_STORAGE_KEY = 'sidflow.preferences';
export const DARK_SCREENSHOT_THEME = 'c64-dark';

const DARK_SCREENSHOT_PREFERENCES: ScreenshotPreferences = Object.freeze({
    version: 2,
    theme: DARK_SCREENSHOT_THEME,
});

export async function applyDarkScreenshotTheme(page: Page): Promise<void> {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.addInitScript(
        ({ key, preferences, theme }) => {
            try {
                window.localStorage.setItem(key, JSON.stringify(preferences));
                window.localStorage.setItem('sidflow-color-scheme', theme);
                window.localStorage.setItem('sidflow-font-scheme', 'mono');
            } catch (error) {
                console.warn('[screenshots] Failed to seed preferences', error);
            }
            try {
                document.documentElement.setAttribute('data-theme', theme);
                document.documentElement.classList.add('font-mono');
            } catch (error) {
                console.warn('[screenshots] Failed to force theme attribute', error);
            }
        },
        {
            key: PREFERENCES_STORAGE_KEY,
            preferences: DARK_SCREENSHOT_PREFERENCES,
            theme: DARK_SCREENSHOT_THEME,
        },
    );
}

export async function resetThemeState(page: Page): Promise<void> {
    try {
        await page.evaluate((key) => {
            try {
                window.localStorage.removeItem(key);
                window.localStorage.removeItem('sidflow-color-scheme');
                window.localStorage.removeItem('sidflow-font-scheme');
            } catch (error) {
                console.warn('[screenshots] Failed to clear seeded preferences', error);
            }
            document.documentElement.removeAttribute('data-theme');
            document.documentElement.classList.remove('font-mono');
        }, PREFERENCES_STORAGE_KEY);
    } catch (error) {
        // The page may already be closed during teardown; ignore silently to avoid noisy logs.
        if (process.env.DEBUG_TEARDOWN_THEME === '1') {
            console.warn('[screenshots] Theme reset skipped', error);
        }
    }
}
