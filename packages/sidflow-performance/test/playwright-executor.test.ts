import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { DEFAULT_PACING_SECONDS } from "../src/constants.js";
import {
  buildPlaywrightScriptPath,
  generatePlaywrightScriptContent
} from "../src/playwright-executor.js";
import { type JourneySpec } from "../src/types.js";

async function createTempDir() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "sidflow-pw-"));
}

describe("playwright-executor", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await createTempDir();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe("generatePlaywrightScriptContent", () => {
    it("generates script with required imports", () => {
      const spec: JourneySpec = {
        id: "imports",
        steps: [{ action: "navigate", target: "/" }]
      };
      const content = generatePlaywrightScriptContent(spec, {
        baseUrl: "http://localhost:3000",
        users: 1
      });

      expect(content).toContain('import { chromium } from "playwright"');
    });

    it("includes baseUrl constant", () => {
      const spec: JourneySpec = {
        id: "baseurl",
        steps: [{ action: "navigate", target: "/" }]
      };
      const content = generatePlaywrightScriptContent(spec, {
        baseUrl: "https://example.com",
        users: 1
      });

      expect(content).toContain('const baseUrl = "https://example.com"');
    });

    it("uses spec pacing when provided", () => {
      const spec: JourneySpec = {
        id: "spec-pacing",
        pacingSeconds: 5,
        steps: [{ action: "navigate", target: "/" }]
      };
      const content = generatePlaywrightScriptContent(spec, {
        baseUrl: "http://localhost:3000",
        users: 1
      });

      expect(content).toContain("const pacingMs = 5 * 1000");
    });

    it("uses options pacing when spec pacing not provided", () => {
      const spec: JourneySpec = {
        id: "options-pacing",
        steps: [{ action: "navigate", target: "/" }]
      };
      const content = generatePlaywrightScriptContent(spec, {
        baseUrl: "http://localhost:3000",
        users: 1,
        pacingSeconds: 7
      });

      expect(content).toContain("const pacingMs = 7 * 1000");
    });

    it("uses default pacing when neither spec nor options provide it", () => {
      const spec: JourneySpec = {
        id: "default-pacing",
        steps: [{ action: "navigate", target: "/" }]
      };
      const content = generatePlaywrightScriptContent(spec, {
        baseUrl: "http://localhost:3000",
        users: 1
      });

      expect(content).toContain(`const pacingMs = ${DEFAULT_PACING_SECONDS} * 1000`);
    });

    it("launches browser in headless mode by default", () => {
      const spec: JourneySpec = {
        id: "headless",
        steps: [{ action: "navigate", target: "/" }]
      };
      const content = generatePlaywrightScriptContent(spec, {
        baseUrl: "http://localhost:3000",
        users: 1
      });

      expect(content).toContain("chromium.launch({ headless: true })");
    });

    it("launches browser in headed mode when specified", () => {
      const spec: JourneySpec = {
        id: "headed",
        steps: [{ action: "navigate", target: "/" }]
      };
      const content = generatePlaywrightScriptContent(spec, {
        baseUrl: "http://localhost:3000",
        users: 1,
        headless: false
      });

      expect(content).toContain("chromium.launch({ headless: false })");
    });

    it("creates multiple user journeys in parallel", () => {
      const spec: JourneySpec = {
        id: "multi-user",
        steps: [{ action: "navigate", target: "/" }]
      };
      const content = generatePlaywrightScriptContent(spec, {
        baseUrl: "http://localhost:3000",
        users: 5
      });

      expect(content).toContain("Promise.all(Array.from({ length: 5 }");
    });

    it("converts navigate step correctly", () => {
      const spec: JourneySpec = {
        id: "navigate",
        steps: [{ action: "navigate", target: "/browse" }]
      };
      const content = generatePlaywrightScriptContent(spec, {
        baseUrl: "http://localhost:3000",
        users: 1
      });

      expect(content).toContain('await page.goto(baseUrl + "/browse")');
    });

    it("converts click step with error handling", () => {
      const spec: JourneySpec = {
        id: "click",
        steps: [{ action: "click", selector: "#submit-button" }]
      };
      const content = generatePlaywrightScriptContent(spec, {
        baseUrl: "http://localhost:3000",
        users: 1
      });

      expect(content).toContain('await page.waitForSelector("#submit-button"');
      expect(content).toContain('await page.click("#submit-button")');
      expect(content).toContain("try {");
      expect(content).toContain("} catch (err) {");
      expect(content).toContain('console.warn("click skipped"');
    });

    it("converts type step with error handling", () => {
      const spec: JourneySpec = {
        id: "type",
        steps: [{ action: "type", selector: "#search", value: "test query" }]
      };
      const content = generatePlaywrightScriptContent(spec, {
        baseUrl: "http://localhost:3000",
        users: 1
      });

      expect(content).toContain('await page.waitForSelector("#search"');
      expect(content).toContain('await page.fill("#search", "test query")');
      expect(content).toContain("try {");
      expect(content).toContain("} catch (err) {");
      expect(content).toContain('console.warn("type skipped"');
    });

    it("converts waitForText step with error handling", () => {
      const spec: JourneySpec = {
        id: "wait",
        steps: [{ action: "waitForText", text: "Loading complete" }]
      };
      const content = generatePlaywrightScriptContent(spec, {
        baseUrl: "http://localhost:3000",
        users: 1
      });

      expect(content).toContain('await page.getByText("Loading complete").waitFor(');
      expect(content).toContain("try {");
      expect(content).toContain("} catch (err) {");
      expect(content).toContain('console.warn("waitForText skipped"');
    });

    it("converts selectTrack step with testId", () => {
      const spec: JourneySpec = {
        id: "select",
        steps: [{ action: "selectTrack", trackRef: "track123" }]
      };
      const content = generatePlaywrightScriptContent(spec, {
        baseUrl: "http://localhost:3000",
        users: 1
      });

      expect(content).toContain('await page.getByTestId("track-track123").click(');
      expect(content).toContain("try {");
      expect(content).toContain("} catch (err) {");
      expect(content).toContain('console.warn("selectTrack skipped"');
    });

    it("converts startPlayback step without expectStream", () => {
      const spec: JourneySpec = {
        id: "playback",
        steps: [{ action: "startPlayback" }]
      };
      const content = generatePlaywrightScriptContent(spec, {
        baseUrl: "http://localhost:3000",
        users: 1
      });

      expect(content).toContain("await page.waitForTimeout(500)");
      expect(content).toContain("// allow stream start");
      expect(content).not.toContain("(expect stream)");
    });

    it("converts startPlayback step with expectStream", () => {
      const spec: JourneySpec = {
        id: "playback-stream",
        steps: [{ action: "startPlayback", expectStream: true }]
      };
      const content = generatePlaywrightScriptContent(spec, {
        baseUrl: "http://localhost:3000",
        users: 1
      });

      expect(content).toContain("await page.waitForTimeout(500)");
      expect(content).toContain("(expect stream)");
    });

    it("converts favoriteToggle step", () => {
      const spec: JourneySpec = {
        id: "favorite",
        steps: [{ action: "favoriteToggle", trackRef: "track456", toggle: "add" }]
      };
      const content = generatePlaywrightScriptContent(spec, {
        baseUrl: "http://localhost:3000",
        users: 1
      });

      expect(content).toContain('await page.getByTestId("favorite-track456").click()');
    });

    it("handles unsupported action types", () => {
      const spec: JourneySpec = {
        id: "unsupported",
        steps: [{ action: "unknownAction" } as any]
      };
      const content = generatePlaywrightScriptContent(spec, {
        baseUrl: "http://localhost:3000",
        users: 1
      });

      expect(content).toContain("// Unsupported action: unknownAction");
    });

    it("adds pacing wait after each step", () => {
      const spec: JourneySpec = {
        id: "pacing",
        pacingSeconds: 2,
        steps: [
          { action: "navigate", target: "/" },
          { action: "click", selector: "#btn" }
        ]
      };
      const content = generatePlaywrightScriptContent(spec, {
        baseUrl: "http://localhost:3000",
        users: 1
      });

      const pacingCount = (content.match(/await page\.waitForTimeout\(pacingMs\)/g) || []).length;
      expect(pacingCount).toBe(2); // One after each step
    });

    it("generates complete journey function structure", () => {
      const spec: JourneySpec = {
        id: "complete",
        steps: [
          { action: "navigate", target: "/" },
          { action: "type", selector: "#search", value: "query" },
          { action: "selectTrack", trackRef: "track1" }
        ]
      };
      const content = generatePlaywrightScriptContent(spec, {
        baseUrl: "http://localhost:3000",
        users: 3
      });

      expect(content).toContain("async function runJourney(userIndex: number)");
      expect(content).toContain("const browser = await chromium.launch");
      expect(content).toContain("const context = await browser.newContext");
      expect(content).toContain("const page = await context.newPage()");
      expect(content).toContain("await page.goto(baseUrl)");
      expect(content).toContain("await browser.close()");
      expect(content).toContain("async function main()");
      expect(content).toContain("main()");
    });

    it("sets browser context with baseURL and viewport", () => {
      const spec: JourneySpec = {
        id: "context",
        steps: [{ action: "navigate", target: "/" }]
      };
      const content = generatePlaywrightScriptContent(spec, {
        baseUrl: "http://localhost:3000",
        users: 1
      });

      expect(content).toContain("baseURL: baseUrl");
      expect(content).toContain("viewport: { width: 1280, height: 720 }");
    });

    it("includes selector timeout in step error handling", () => {
      const spec: JourneySpec = {
        id: "timeout",
        steps: [{ action: "click", selector: "#btn" }]
      };
      const content = generatePlaywrightScriptContent(spec, {
        baseUrl: "http://localhost:3000",
        users: 1
      });

      expect(content).toContain("timeout: 3000");
    });

    it("handles steps with special characters in selectors", () => {
      const spec: JourneySpec = {
        id: "special-chars",
        steps: [
          { action: "click", selector: "[data-testid='button-123']" },
          { action: "type", selector: "input[name='search']", value: "test" }
        ]
      };
      const content = generatePlaywrightScriptContent(spec, {
        baseUrl: "http://localhost:3000",
        users: 1
      });

      expect(content).toContain("[data-testid='button-123']");
      expect(content).toContain("input[name='search']");
    });

    it("handles steps with special characters in values", () => {
      const spec: JourneySpec = {
        id: "special-values",
        steps: [
          { action: "type", selector: "#input", value: "quote's test" },
          { action: "waitForText", text: 'Display "ready"' }
        ]
      };
      const content = generatePlaywrightScriptContent(spec, {
        baseUrl: "http://localhost:3000",
        users: 1
      });

      expect(content).toContain("quote's test");
      expect(content).toContain('Display \\"ready\\"');
    });
  });

  describe("buildPlaywrightScriptPath", () => {
    it("generates correct script path structure", () => {
      const scriptPath = buildPlaywrightScriptPath(tmpDir, "2024-01-15_120000", "test-journey", 10);

      expect(scriptPath).toContain(tmpDir);
      expect(scriptPath).toContain("2024-01-15_120000");
      expect(scriptPath).toContain("playwright");
      expect(scriptPath).toContain("test-journey-u010.spec.ts");
    });

    it("pads user count to 3 digits", () => {
      const path1 = buildPlaywrightScriptPath(tmpDir, "2024-01-15", "journey", 1);
      const path5 = buildPlaywrightScriptPath(tmpDir, "2024-01-15", "journey", 5);
      const path100 = buildPlaywrightScriptPath(tmpDir, "2024-01-15", "journey", 100);

      expect(path1).toContain("u001.spec.ts");
      expect(path5).toContain("u005.spec.ts");
      expect(path100).toContain("u100.spec.ts");
    });

    it("includes journey id in filename", () => {
      const scriptPath = buildPlaywrightScriptPath(tmpDir, "timestamp", "my-journey-name", 1);

      expect(scriptPath).toContain("my-journey-name");
    });

    it("creates path under playwright subdirectory", () => {
      const scriptPath = buildPlaywrightScriptPath(tmpDir, "ts", "journey", 1);

      expect(scriptPath).toContain(path.sep + "playwright" + path.sep);
    });

    it("uses .spec.ts extension", () => {
      const scriptPath = buildPlaywrightScriptPath(tmpDir, "ts", "journey", 1);

      expect(scriptPath).toEndWith(".spec.ts");
    });
  });
});
