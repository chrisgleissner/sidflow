import { test, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

test.describe('UI Screenshots', () => {
  const screenshotDir = path.resolve(__dirname, '../../..', '..', 'doc/web-screenshots');

  test.beforeAll(() => {
    // Ensure screenshot directory exists
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }
  });

  test('capture wizard tab', async ({ page }) => {
    await page.goto('/');
    
    // Click Wizard tab
    await page.click('text=WIZARD');
    await page.waitForTimeout(500);
    
    await page.screenshot({
      path: path.join(screenshotDir, '01-wizard.png'),
      fullPage: true,
    });
  });

  test('capture prefs tab', async ({ page }) => {
    await page.goto('/');
    
    // Click Prefs tab
    await page.click('text=PREFS');
    await page.waitForTimeout(500);
    
    await page.screenshot({
      path: path.join(screenshotDir, '02-prefs.png'),
      fullPage: true,
    });
  });

  test('capture fetch tab', async ({ page }) => {
    await page.goto('/');
    
    // Click Fetch tab
    await page.click('text=FETCH');
    await page.waitForTimeout(500);
    
    await page.screenshot({
      path: path.join(screenshotDir, '03-fetch.png'),
      fullPage: true,
    });
  });

  test('capture rate tab', async ({ page }) => {
    await page.goto('/');
    
    // Click Rate tab
    await page.click('text=RATE');
    await page.waitForTimeout(500);
    
    // Fill in a sample path to show metadata
    await page.fill('input[placeholder*="music.sid"]', '/test/hvsc/MUSICIANS/H/Hubbard_Rob/Commando.sid');
    await page.waitForTimeout(500);
    
    await page.screenshot({
      path: path.join(screenshotDir, '04-rate.png'),
      fullPage: true,
    });
  });

  test('capture classify tab', async ({ page }) => {
    await page.goto('/');
    
    // Click Classify tab
    await page.click('text=CLASSIFY');
    await page.waitForTimeout(500);
    
    await page.screenshot({
      path: path.join(screenshotDir, '05-classify.png'),
      fullPage: true,
    });
  });

  test('capture train tab', async ({ page }) => {
    await page.goto('/');
    
    // Click Train tab
    await page.click('text=TRAIN');
    await page.waitForTimeout(500);
    
    await page.screenshot({
      path: path.join(screenshotDir, '06-train.png'),
      fullPage: true,
    });
  });

  test('capture play tab with metadata', async ({ page }) => {
    await page.goto('/');
    
    // Click Play tab
    await page.click('text=PLAY');
    await page.waitForTimeout(500);
    
    // Fill in a sample path and start playback to show metadata
    await page.fill('input[placeholder*="music.sid"]', '/test/hvsc/MUSICIANS/H/Hubbard_Rob/Commando.sid');
    await page.click('button:has-text("Play")');
    await page.waitForTimeout(1000);
    
    await page.screenshot({
      path: path.join(screenshotDir, '07-play.png'),
      fullPage: true,
    });
  });
});
