import path from "node:path";
import { DEFAULT_PACING_SECONDS } from "./constants.js";
import {
  type ClickStep,
  type FavoriteToggleStep,
  type JourneySpec,
  type NavigateStep,
  type SelectTrackStep,
  type StartPlaybackStep,
  type TypeStep,
  type WaitForTextStep,
} from "./types.js";

export interface PlaywrightOptions {
  baseUrl: string;
  users: number;
  pacingSeconds?: number;
  headless?: boolean;
}

export function generatePlaywrightScriptContent(
  spec: JourneySpec,
  options: PlaywrightOptions
): string {
  const pacingSeconds = spec.pacingSeconds ?? options.pacingSeconds ?? DEFAULT_PACING_SECONDS;
  const baseUrlLiteral = JSON.stringify(options.baseUrl);
  const headless = options.headless ?? true;
  const selectorTimeoutMs = 30000;

  const stepLines = spec.steps
    .map((step) => {
      switch (step.action) {
        case "navigate": {
          const navStep = step as NavigateStep;
          return `  await page.goto(baseUrl + ${JSON.stringify(navStep.target)});`;
        }
        case "click": {
          const clickStep = step as ClickStep;
          const selector = JSON.stringify(clickStep.selector);
          return [
            `  try {`,
            `    await page.waitForSelector(${selector}, { timeout: ${selectorTimeoutMs} });`,
            `    await page.click(${selector});`,
            `  } catch (err) {`,
            `    console.error("[click failed] selector=" + ${selector} + " url=" + page.url() + " error=" + (err?.message ?? err));`,
            `    console.error("Stack:", err?.stack ?? 'no stack');`,
            `  }`
          ].join("\n");
        }
        case "type": {
          const typeStep = step as TypeStep;
          const selector = JSON.stringify(typeStep.selector);
          const value = JSON.stringify(typeStep.value);
          return [
            `  try {`,
            `    await page.waitForSelector(${selector}, { timeout: ${selectorTimeoutMs} });`,
            `    await page.fill(${selector}, ${value});`,
            `  } catch (err) {`,
            `    console.error("[type failed] selector=" + ${selector} + " url=" + page.url() + " error=" + (err?.message ?? err));`,
            `    console.error("Stack:", err?.stack ?? 'no stack');`,
            `  }`
          ].join("\n");
        }
        case "waitForText": {
          const waitStep = step as WaitForTextStep;
          return [
            `  try {`,
            `    await page.getByText(${JSON.stringify(waitStep.text)}).waitFor({ timeout: ${selectorTimeoutMs} });`,
            `  } catch (err) {`,
            `    console.error("[waitForText failed] text=" + ${JSON.stringify(waitStep.text)} + " url=" + page.url() + " error=" + (err?.message ?? err));`,
            `    console.error("Stack:", err?.stack ?? 'no stack');`,
            `  }`
          ].join("\n");
        }
        case "selectTrack": {
          const selectStep = step as SelectTrackStep;
          return [
            `  try {`,
            `    await page.getByTestId(${JSON.stringify(`track-${selectStep.trackRef}`)}).click({ timeout: ${selectorTimeoutMs} });`,
            `  } catch (err) {`,
            `    console.error("[selectTrack failed] trackRef=" + ${JSON.stringify(selectStep.trackRef)} + " url=" + page.url() + " error=" + (err?.message ?? err));`,
            `    console.error("Stack:", err?.stack ?? 'no stack');`,
            `  }`
          ].join("\n");
        }
        case "startPlayback": {
          const playStep = step as StartPlaybackStep;
          return `  await page.waitForTimeout(500); // allow stream start${playStep.expectStream ? " (expect stream)" : ""
            }`;
        }
        case "favoriteToggle": {
          const favStep = step as FavoriteToggleStep;
          return `  await page.getByTestId(${JSON.stringify(
            `favorite-${favStep.trackRef}`
          )}).click();`;
        }
        default: {
          // Exhaustive check: all JourneyStep actions should be handled above
          const _exhaustiveCheck: never = step;
          const actionName = (step as any).action ?? "unknown";
          return `  // Unsupported action: ${actionName}`;
        }
      }
    })
    .map((line) => `${line}\n  await page.waitForTimeout(pacingMs);`)
    .join("\n");

  return [
    `import { chromium } from "playwright";`,
    `const baseUrl = ${baseUrlLiteral};`,
    `const pacingMs = ${pacingSeconds} * 1000;`,
    ``,
    `async function runJourney(userIndex: number) {`,
    `  const browser = await chromium.launch({ headless: ${headless} });`,
    `  const context = await browser.newContext({ baseURL: baseUrl, viewport: { width: 1280, height: 720 } });`,
    `  const page = await context.newPage();`,
    `  `,
    `  // Capture console messages for debugging`,
    `  page.on('console', msg => {`,
    `    const type = msg.type();`,
    `    const text = msg.text();`,
    `    if (type === 'error' || type === 'warning') {`,
    `      console.log(\`[browser \${type}] \${text}\`);`,
    `    }`,
    `  });`,
    `  `,
    `  page.on('pageerror', err => {`,
    `    console.error('[browser pageerror]', err.message);`,
    `  });`,
    `  `,
    `  console.log(\`[journey] Starting at \${baseUrl}\`);`,
    `  await page.goto(baseUrl);`,
    `  console.log(\`[journey] Navigation complete, page title: \${await page.title()}\`);`,
    stepLines,
    `  await browser.close();`,
    `}`,
    ``,
    `async function main() {`,
    `  await Promise.all(Array.from({ length: ${options.users} }, (_, i) => runJourney(i)));`,
    `}`,
    `main();`
  ].join("\n");
}

export function buildPlaywrightScriptPath(
  tmpRoot: string,
  timestamp: string,
  journeyId: string,
  users: number
): string {
  return path.join(tmpRoot, timestamp, "playwright", `${journeyId}-u${String(users).padStart(3, "0")}.spec.ts`);
}
