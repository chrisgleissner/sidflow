import path from "node:path";
import { DEFAULT_PACING_SECONDS } from "./constants.js";
import { type JourneySpec } from "./types.js";

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
  const selectorTimeoutMs = 3000;

  const stepLines = spec.steps
    .map((step) => {
      switch (step.action) {
        case "navigate":
          return `  await page.goto(baseUrl + ${JSON.stringify((step as any).target)});`;
        case "click": {
          const selector = JSON.stringify((step as any).selector);
          return [
            `  try {`,
            `    await page.waitForSelector(${selector}, { timeout: ${selectorTimeoutMs} });`,
            `    await page.click(${selector});`,
            `  } catch (err) {`,
            `    console.warn("click skipped", ${selector}, err?.message ?? err);`,
            `  }`
          ].join("\n");
        }
        case "type": {
          const selector = JSON.stringify((step as any).selector);
          const value = JSON.stringify((step as any).value);
          return [
            `  try {`,
            `    await page.waitForSelector(${selector}, { timeout: ${selectorTimeoutMs} });`,
            `    await page.fill(${selector}, ${value});`,
            `  } catch (err) {`,
            `    console.warn("type skipped", ${selector}, err?.message ?? err);`,
            `  }`
          ].join("\n");
        }
        case "waitForText":
          return [
            `  try {`,
            `    await page.getByText(${JSON.stringify((step as any).text)}).waitFor({ timeout: ${selectorTimeoutMs} });`,
            `  } catch (err) {`,
            `    console.warn("waitForText skipped", ${JSON.stringify((step as any).text)}, err?.message ?? err);`,
            `  }`
          ].join("\n");
        case "selectTrack":
          return [
            `  try {`,
            `    await page.getByTestId(${JSON.stringify(`track-${(step as any).trackRef}`)}).click({ timeout: ${selectorTimeoutMs} });`,
            `  } catch (err) {`,
            `    console.warn("selectTrack skipped", ${JSON.stringify((step as any).trackRef)}, err?.message ?? err);`,
            `  }`
          ].join("\n");
        case "startPlayback":
          return `  await page.waitForTimeout(500); // allow stream start${
            (step as any).expectStream ? " (expect stream)" : ""
          }`;
        case "favoriteToggle":
          return `  await page.getByTestId(${JSON.stringify(
            `favorite-${(step as any).trackRef}`
          )}).click();`;
        default:
          return `  // Unsupported action: ${(step as any).action}`;
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
    `  await page.goto(baseUrl);`,
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
