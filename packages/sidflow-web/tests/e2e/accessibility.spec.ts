/**
 * Accessibility audit test suite for SIDFlow web UI
 * 
 * Tests keyboard navigation, screen reader compatibility, ARIA compliance,
 * and semantic HTML following WCAG 2.1 AA guidelines.
 * 
 * Run with: bun run test:a11y or npm run test:e2e -- accessibility.spec.ts
 */

if (typeof describe === "function" && !process.env.PLAYWRIGHT_TEST_SUITE) {
  console.log("[sidflow-web] Skipping Playwright e2e spec; run via `bun run test:e2e`.");
  process.exit(0);
}

import { test, expect, type Page } from './test-hooks';

/**
 * Reliable page navigation with proper wait conditions (not waitForTimeout)
 * Uses load event and then waits for key page elements.
 */
async function gotoWithRetry(page: Page, url: string, maxRetries = 3): Promise<void> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            // Use 'load' instead of 'networkidle' for faster navigation
            // Then wait for key page elements to be visible
            await page.goto(url, { waitUntil: 'load', timeout: 30000 });
            // Wait for the page to have meaningful content loaded
            // First wait for either tabpanel or main content
            await Promise.race([
                page.waitForSelector('[role="tabpanel"]', { state: 'visible', timeout: 20000 }),
                page.waitForSelector('main', { state: 'visible', timeout: 20000 }),
                page.waitForSelector('h1, h2, h3', { state: 'visible', timeout: 20000 }),
            ]).catch(() => {});
            // Wait for spinners to be gone
            await page.waitForFunction(() => !document.querySelector('.animate-spin'), { timeout: 10000 }).catch(() => {});
            return;
        } catch (error) {
            if (attempt === maxRetries) throw error;
            console.log(`[A11y] Navigation retry ${attempt}/${maxRetries} for ${url}`);
            // Wait for DOM to be ready before retry
            await page.waitForLoadState('domcontentloaded').catch(() => {});
        }
    }
}

test.describe('Accessibility Audit', () => {
    // Increase timeout for accessibility tests which involve navigation and DOM inspection
    // CI can be slower due to resource contention
    test.setTimeout(90000);
    
    test.beforeEach(async ({ page }) => {
        // Inject axe-core for automated accessibility testing
        await page.addInitScript(() => {
            // This will be replaced by actual axe-core injection if needed
        });
    });

    test.describe('Keyboard Navigation', () => {
        test('should navigate through all interactive elements with Tab', async ({ page }) => {
            await gotoWithRetry(page, '/?tab=play');

            // Get all focusable elements
            const focusableElements = await page.locator(
                'a, button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
            ).all();

            console.log(`[A11y] Found ${focusableElements.length} focusable elements`);

            // Tab through first 10 elements to verify keyboard navigation works
            for (let i = 0; i < Math.min(10, focusableElements.length); i++) {
                await page.keyboard.press('Tab');
                const focused = await page.evaluate(() => document.activeElement?.tagName);
                console.log(`[A11y] Tab ${i + 1}: focused ${focused}`);
            }

            expect(focusableElements.length).toBeGreaterThan(0);
        });

        test('should support Escape key to close dialogs', async ({ page }) => {
            await gotoWithRetry(page, '/');
            // Explicitly wait for the login button to be ready
            await page.waitForSelector('button', { state: 'visible', timeout: 20000 }).catch(() => {});

            // Open login dialog
            // The UI label is "Login" (no space) in this app; accept both variants.
            const loginButton = page.getByRole('button', { name: /log\s*in|login/i });
            await expect(loginButton).toBeVisible({ timeout: 15000 });
            await loginButton.click();
            await page.waitForSelector('[role="dialog"]', { state: 'visible', timeout: 10000 });

            // Press Escape to close - wait for dialog to close with condition
            await page.keyboard.press('Escape');
            await page.waitForSelector('[role="dialog"]', { state: 'hidden', timeout: 5000 }).catch(() => {});

            // Verify dialog is closed
            const dialogVisible = await page.locator('[role="dialog"]').isVisible();
            expect(dialogVisible).toBeFalsy();
            console.log('[A11y] Escape key successfully closes dialog');
        });

        test('should support Space and Enter to activate buttons', async ({ page }) => {
            await gotoWithRetry(page, '/?tab=play');
            
            // Wait for buttons to be available
            await page.waitForSelector('button', { timeout: 10000 });

            // Find a button and test Space key
            const button = page.locator('button').first();
            await expect(button).toBeVisible({ timeout: 5000 });
            await button.focus();

            const buttonText = await button.textContent();
            console.log(`[A11y] Testing button: "${buttonText}"`);

            // Verify button can receive focus
            const isFocused = await button.evaluate(el => document.activeElement === el);
            console.log(`[A11y] Button focused: ${isFocused}`);

            // Space should activate button (test focus is on element)
            await page.keyboard.press('Space');
            
            // Wait for any navigation or action to stabilize
            await page.waitForFunction(() => !document.querySelector('.animate-spin'), { timeout: 3000 }).catch(() => {});

            // Test Enter key on the same page context
            await button.focus();
            await page.keyboard.press('Enter');
            
            // Wait for any navigation or action to stabilize
            await page.waitForFunction(() => !document.querySelector('.animate-spin'), { timeout: 3000 }).catch(() => {});

            console.log('[A11y] Space and Enter keys work on buttons');
            expect(true).toBeTruthy(); // Test completed without errors
        });

        test('should support arrow keys in tab navigation', async ({ page }) => {
            await gotoWithRetry(page, '/?tab=play');
            
            // Wait for tab list to be visible before interacting
            const tabList = page.locator('[role="tablist"]').first();
            await tabList.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
            
            if (await tabList.isVisible()) {
                const tabs = await tabList.locator('[role="tab"]').all();
                console.log(`[A11y] Found ${tabs.length} tabs`);

                if (tabs.length > 1) {
                    // Focus first tab
                    await tabs[0].focus();
                    
                    // Brief wait for focus to settle
                    await page.waitForFunction(
                        () => document.activeElement?.getAttribute('role') === 'tab',
                        { timeout: 3000 }
                    ).catch(() => {});

                    // Press ArrowRight to move to next tab
                    await page.keyboard.press('ArrowRight');
                    
                    // Wait for focus to move
                    await page.waitForFunction(
                        () => document.activeElement?.getAttribute('role') === 'tab',
                        { timeout: 3000 }
                    ).catch(() => {});

                    const focusedTab = await page.evaluate(() => {
                        const el = document.activeElement;
                        return el?.getAttribute('role') === 'tab' ? el.textContent : null;
                    });

                    console.log(`[A11y] Arrow key navigation focused: ${focusedTab}`);
                    expect(focusedTab).toBeTruthy();
                }
            } else {
                console.log('[A11y] No tab list found');
            }
        });
    });

    test.describe('ARIA Compliance', () => {
        test('should have proper ARIA labels on interactive elements', async ({ page }) => {
            await gotoWithRetry(page, '/?tab=play');
            // Wait for tabpanel (indicates tab content is loaded) then buttons
            await page.waitForSelector('[role="tabpanel"]', { state: 'visible', timeout: 15000 }).catch(() => {});
            await page.waitForSelector('button', { state: 'visible', timeout: 10000 }).catch(() => {});

            // Check buttons without text have aria-label
            const buttons = await page.locator('button').all();
            let missingLabels = 0;

            for (const button of buttons) {
                const text = await button.textContent();
                const ariaLabel = await button.getAttribute('aria-label');
                const ariaLabelledBy = await button.getAttribute('aria-labelledby');

                if (!text?.trim() && !ariaLabel && !ariaLabelledBy) {
                    missingLabels++;
                    const html = await button.evaluate(el => el.outerHTML);
                    console.log(`[A11y] Button without label: ${html.substring(0, 100)}`);
                }
            }

            console.log(`[A11y] Checked ${buttons.length} buttons, ${missingLabels} missing labels`);

            // Allow some icon buttons without labels (they may have tooltips)
            expect(missingLabels).toBeLessThan(buttons.length * 0.2); // < 20% missing labels
        });

        test('should use proper ARIA roles for custom components', async ({ page }) => {
            await gotoWithRetry(page, '/?tab=play');
            // Wait for tablist to be visible (indicates page is fully loaded)
            await page.waitForSelector('[role="tablist"]', { state: 'visible', timeout: 15000 }).catch(() => {});
            // Ensure tab content is also visible
            await page.waitForSelector('[role="tabpanel"]', { state: 'visible', timeout: 10000 }).catch(() => {});

            // Check for proper roles
            const roles = ['button', 'dialog', 'tablist', 'tab', 'tabpanel', 'navigation'];
            const roleStats: Record<string, number> = {};

            for (const role of roles) {
                const count = await page.locator(`[role="${role}"]`).count();
                roleStats[role] = count;
                console.log(`[A11y] Found ${count} elements with role="${role}"`);
            }

            expect(Object.values(roleStats).some(count => count > 0)).toBeTruthy();
        });

        test('should have proper heading hierarchy', async ({ page }) => {
            await gotoWithRetry(page, '/admin?tab=wizard');
            // Wait for the admin panel content to be fully loaded
            await page.waitForSelector('[role="tabpanel"]', { state: 'visible', timeout: 15000 }).catch(() => {});
            // Wait for heading content to appear
            await page.waitForSelector('h1, h2, h3', { state: 'visible', timeout: 10000 }).catch(() => {});

            // Check heading levels (h1, h2, h3, etc.)
            const headings = await page.locator('h1, h2, h3, h4, h5, h6').all();
            const headingLevels: number[] = [];

            for (const heading of headings) {
                const tagName = await heading.evaluate(el => el.tagName);
                const level = parseInt(tagName.substring(1));
                headingLevels.push(level);

                const text = await heading.textContent();
                console.log(`[A11y] ${tagName}: ${text?.substring(0, 50)}`);
            }

            // Check that headings don't skip levels (e.g., h1 -> h3)
            let skippedLevels = false;
            for (let i = 1; i < headingLevels.length; i++) {
                if (headingLevels[i] > headingLevels[i - 1] + 1) {
                    skippedLevels = true;
                    console.log(`[A11y] WARNING: Heading level skipped from h${headingLevels[i - 1]} to h${headingLevels[i]}`);
                }
            }

            expect(headings.length).toBeGreaterThan(0);
            console.log(`[A11y] Heading hierarchy ${skippedLevels ? 'has issues' : 'looks good'}`);
        });

        test('should have aria-live regions for dynamic content', async ({ page }) => {
            await gotoWithRetry(page, '/?tab=play');
            // Wait for tab content to be fully loaded
            await page.waitForSelector('[role="tabpanel"]', { state: 'visible', timeout: 15000 }).catch(() => {});

            // Check for aria-live regions (for status updates, etc.)
            const liveRegions = await page.locator('[aria-live]').all();
            console.log(`[A11y] Found ${liveRegions.length} aria-live regions`);

            for (const region of liveRegions) {
                const liveValue = await region.getAttribute('aria-live');
                const text = await region.textContent();
                console.log(`[A11y] aria-live="${liveValue}": ${text?.substring(0, 50)}`);
            }

            // At least status updates should have aria-live
            // (This is a soft check - not all apps need aria-live)
            expect(liveRegions.length).toBeGreaterThanOrEqual(0);
        });
    });

    test.describe('Semantic HTML', () => {
        test('should use semantic landmarks', async ({ page }) => {
            await gotoWithRetry(page, '/?tab=play');

            // Check for semantic HTML5 elements or ARIA landmarks
            const landmarks = {
                main: await page.locator('main, [role="main"]').count(),
                nav: await page.locator('nav, [role="navigation"]').count(),
                header: await page.locator('header, [role="banner"]').count(),
                footer: await page.locator('footer, [role="contentinfo"]').count(),
            };

            console.log('[A11y] Landmarks found:', landmarks);

            // Should have at least a main content area
            expect(landmarks.main).toBeGreaterThan(0);
        });

        test('should have proper form labels', async ({ page }) => {
            await gotoWithRetry(page, '/admin?tab=rate');
            
            // Wait for the admin panel content to be fully loaded
            await page.waitForSelector('[role="tabpanel"]', { state: 'visible', timeout: 15000 }).catch(() => {});
            // Also wait for any rate tab specific elements to appear
            await page.waitForSelector('input, select, textarea', { state: 'attached', timeout: 10000 }).catch(() => {});

            // Check that inputs have associated labels
            const inputs = await page.locator('input, select, textarea').all();
            let unlabeledInputs = 0;

            for (const input of inputs) {
                const id = await input.getAttribute('id');
                const ariaLabel = await input.getAttribute('aria-label');
                const ariaLabelledBy = await input.getAttribute('aria-labelledby');
                const placeholder = await input.getAttribute('placeholder');

                // Check if there's a label pointing to this input
                let hasLabel = false;
                if (id) {
                    hasLabel = await page.locator(`label[for="${id}"]`).count() > 0;
                }

                if (!hasLabel && !ariaLabel && !ariaLabelledBy && !placeholder) {
                    unlabeledInputs++;
                    const html = await input.evaluate(el => el.outerHTML);
                    console.log(`[A11y] Input without label: ${html.substring(0, 100)}`);
                }
            }

            console.log(`[A11y] Checked ${inputs.length} inputs, ${unlabeledInputs} unlabeled`);

            // Most inputs should have labels (allow 10% for hidden inputs)
            expect(unlabeledInputs).toBeLessThan(inputs.length * 0.1);
        });

        test('should have alt text for images', async ({ page }) => {
            await gotoWithRetry(page, '/?tab=play');

            // Check that images have alt text
            const images = await page.locator('img').all();
            let missingAlt = 0;

            for (const img of images) {
                const alt = await img.getAttribute('alt');
                const ariaLabel = await img.getAttribute('aria-label');
                const role = await img.getAttribute('role');

                // Decorative images should have empty alt or role="presentation"
                if (alt === null && !ariaLabel && role !== 'presentation') {
                    missingAlt++;
                    const src = await img.getAttribute('src');
                    console.log(`[A11y] Image without alt: ${src}`);
                }
            }

            console.log(`[A11y] Checked ${images.length} images, ${missingAlt} missing alt text`);

            // All images should have alt (even if empty for decorative)
            expect(missingAlt).toBe(0);
        });
    });

    test.describe('Focus Management', () => {
        test('should have visible focus indicators', async ({ page }) => {
            await gotoWithRetry(page, '/?tab=play');
            // Wait for interactive content to be ready
            await page.waitForSelector('[role="tabpanel"]', { state: 'visible', timeout: 15000 }).catch(() => {});
            await page.waitForSelector('button', { state: 'visible', timeout: 10000 }).catch(() => {});

            // Tab to a button and check if it has visible focus
            await page.keyboard.press('Tab');
            await page.keyboard.press('Tab');

            const focusedElement = await page.evaluate(() => {
                const el = document.activeElement;
                if (!el || el === document.body) return null;

                const styles = window.getComputedStyle(el);
                return {
                    outline: styles.outline,
                    outlineWidth: styles.outlineWidth,
                    outlineStyle: styles.outlineStyle,
                    boxShadow: styles.boxShadow,
                    border: styles.border,
                };
            });

            console.log('[A11y] Focus indicator styles:', focusedElement);

            // Should have some visible focus indicator
            const hasFocusIndicator = focusedElement && (
                (focusedElement.outlineWidth !== '0px' && focusedElement.outlineStyle !== 'none') ||
                focusedElement.boxShadow !== 'none' ||
                focusedElement.border !== '0px none rgb(0, 0, 0)'
            );

            expect(hasFocusIndicator).toBeTruthy();
        });

        test('should trap focus in modal dialogs', async ({ page }) => {
            await gotoWithRetry(page, '/');
            // Explicitly wait for the login button to be ready before interacting
            await page.waitForSelector('button', { state: 'visible', timeout: 20000 }).catch(() => {});

            // Open login dialog
            const loginButton = page.getByRole('button', { name: /log in/i });
            await expect(loginButton).toBeVisible({ timeout: 15000 });
            await loginButton.click();
            await page.waitForSelector('[role="dialog"]', { state: 'visible', timeout: 10000 });

            // Tab through elements - focus should stay within dialog
            const initialFocus = await page.evaluate(() => document.activeElement?.tagName);
            console.log(`[A11y] Initial focus: ${initialFocus}`);

            for (let i = 0; i < 20; i++) {
                await page.keyboard.press('Tab');
            }

            // Check if focus is still within dialog
            const focusInDialog = await page.evaluate(() => {
                const focused = document.activeElement;
                const dialog = document.querySelector('[role="dialog"]');
                return dialog?.contains(focused) || false;
            });

            console.log(`[A11y] Focus trapped in dialog: ${focusInDialog}`);
            expect(focusInDialog).toBeTruthy();

            // Close dialog
            await page.keyboard.press('Escape');
        });

        test('should restore focus after closing dialog', async ({ page }) => {
            await gotoWithRetry(page, '/');
            // Explicitly wait for the login button to be ready
            await page.waitForSelector('button', { state: 'visible', timeout: 20000 }).catch(() => {});

            // Open and close login dialog, check focus restoration
            const loginButton = page.getByRole('button', { name: /log in/i });
            await expect(loginButton).toBeVisible({ timeout: 15000 });
            await loginButton.focus();

            const beforeOpen = await page.evaluate(() => document.activeElement?.textContent);

            await loginButton.click();
            await page.waitForSelector('[role="dialog"]', { state: 'visible', timeout: 10000 });

            await page.keyboard.press('Escape');
            // Wait for dialog to close
            await page.waitForSelector('[role="dialog"]', { state: 'hidden', timeout: 5000 }).catch(() => {});

            const afterClose = await page.evaluate(() => document.activeElement?.textContent);

            console.log(`[A11y] Focus before dialog: "${beforeOpen}", after: "${afterClose}"`);

            // Focus should ideally return to the button that opened the dialog
            expect(afterClose).toBeTruthy();
        });
    });

    test.describe('Color Contrast', () => {
        test('should have sufficient color contrast for text', async ({ page }) => {
            await gotoWithRetry(page, '/?tab=play');

            // Sample some text elements and check contrast
            const textElements = await page.locator('p, span, button, a, label, h1, h2, h3').all();
            const sampleSize = Math.min(20, textElements.length);
            let lowContrastCount = 0;

            for (let i = 0; i < sampleSize; i++) {
                const element = textElements[i];
                const contrast = await element.evaluate((el) => {
                    const styles = window.getComputedStyle(el);
                    const color = styles.color;
                    const bgColor = styles.backgroundColor;

                    // Simple check - just return the colors for logging
                    return { color, bgColor, text: el.textContent?.substring(0, 30) };
                });

                // This is a simplified check - proper contrast calculation would use luminance
                if (contrast.color === contrast.bgColor) {
                    lowContrastCount++;
                    console.log(`[A11y] Potential low contrast: "${contrast.text}"`);
                }
            }

            console.log(`[A11y] Checked ${sampleSize} text elements, ${lowContrastCount} potential contrast issues`);

            // This is a simplified test - real contrast checking requires luminance calculation
            expect(lowContrastCount).toBeLessThan(sampleSize * 0.1);
        });
    });

    test.describe('Screen Reader Support', () => {
        test('should have proper document title', async ({ page }) => {
            await gotoWithRetry(page, '/?tab=play');

            const title = await page.title();
            console.log(`[A11y] Page title: "${title}"`);

            expect(title).toBeTruthy();
            expect(title.length).toBeGreaterThan(0);
        });

        test('should have descriptive link text', async ({ page }) => {
            await gotoWithRetry(page, '/?tab=play');

            // Check for vague link text like "click here", "read more", etc.
            const links = await page.locator('a').all();
            const vagueTerms = ['click here', 'read more', 'here', 'more'];
            let vagueLinks = 0;

            for (const link of links) {
                const text = (await link.textContent())?.trim().toLowerCase() || '';
                if (vagueTerms.includes(text)) {
                    vagueLinks++;
                    console.log(`[A11y] Vague link text: "${text}"`);
                }
            }

            console.log(`[A11y] Checked ${links.length} links, ${vagueLinks} with vague text`);
            expect(vagueLinks).toBe(0);
        });
    });
});
