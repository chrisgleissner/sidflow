import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { DEFAULT_PACING_SECONDS } from "../src/constants.js";
import { buildK6ScriptPath, generateK6ScriptContent } from "../src/k6-executor.js";
import { type JourneySpec } from "../src/types.js";

async function createTempDir() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "sidflow-k6-"));
}

describe("k6-executor", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await createTempDir();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe("generateK6ScriptContent", () => {
    it("generates basic k6 script with required imports", () => {
      const spec: JourneySpec = {
        id: "basic",
        steps: [{ action: "navigate", target: "/" }]
      };
      const content = generateK6ScriptContent(spec, {
        baseUrl: "http://localhost:3000",
        users: 1
      });

      expect(content).toContain('import http from "k6/http"');
      expect(content).toContain('import { sleep } from "k6"');
    });

    it("sets VUs to specified users", () => {
      const spec: JourneySpec = {
        id: "vus",
        steps: [{ action: "navigate", target: "/" }]
      };
      const content = generateK6ScriptContent(spec, {
        baseUrl: "http://localhost:3000",
        users: 25
      });

      expect(content).toContain("vus: 25");
    });

    it("uses spec pacing when provided", () => {
      const spec: JourneySpec = {
        id: "spec-pacing",
        pacingSeconds: 5,
        steps: [{ action: "navigate", target: "/" }]
      };
      const content = generateK6ScriptContent(spec, {
        baseUrl: "http://localhost:3000",
        users: 1
      });

      expect(content).toContain("sleep(5)");
      expect(content).toContain("const pacingSeconds = 5");
    });

    it("uses options pacing when spec pacing not provided", () => {
      const spec: JourneySpec = {
        id: "options-pacing",
        steps: [{ action: "navigate", target: "/" }]
      };
      const content = generateK6ScriptContent(spec, {
        baseUrl: "http://localhost:3000",
        users: 1,
        pacingSeconds: 7
      });

      expect(content).toContain("sleep(7)");
    });

    it("uses default pacing when neither spec nor options provide it", () => {
      const spec: JourneySpec = {
        id: "default-pacing",
        steps: [{ action: "navigate", target: "/" }]
      };
      const content = generateK6ScriptContent(spec, {
        baseUrl: "http://localhost:3000",
        users: 1
      });

      expect(content).toContain(`sleep(${DEFAULT_PACING_SECONDS})`);
    });

    it("sets per-VU journey iterations when provided", () => {
      const spec: JourneySpec = {
        id: "custom-iterations",
        steps: [
          { action: "navigate", target: "/" },
          { action: "click", selector: "#btn" }
        ]
      };
      const content = generateK6ScriptContent(spec, {
        baseUrl: "http://localhost:3000",
        users: 1,
        journeysPerVu: 5
      });

      expect(content).toContain('executor: "per-vu-iterations"');
      expect(content).toContain("iterations: 5");
    });

    it("defaults journeysPerVu to 1 when not provided", () => {
      const spec: JourneySpec = {
        id: "default-iterations",
        steps: [
          { action: "navigate", target: "/" },
          { action: "click", selector: "#btn" },
          { action: "waitForText", text: "Done" }
        ]
      };
      const content = generateK6ScriptContent(spec, {
        baseUrl: "http://localhost:3000",
        users: 1
      });

      expect(content).toContain('executor: "per-vu-iterations"');
      expect(content).toContain("iterations: 1");
    });

    it("includes strict thresholds by default", () => {
      const spec: JourneySpec = {
        id: "thresholds",
        steps: [{ action: "navigate", target: "/" }]
      };
      const content = generateK6ScriptContent(spec, {
        baseUrl: "http://localhost:3000",
        users: 1
      });

      expect(content).toContain('thresholds: { http_req_failed: ["rate<0.05"] }');
      expect(content).toContain('summaryTrendStats: ["avg", "min", "med", "max", "p(90)", "p(95)", "p(99)"]');
    });

    it("disables thresholds when strictThresholds is false", () => {
      const spec: JourneySpec = {
        id: "no-thresholds",
        steps: [{ action: "navigate", target: "/" }]
      };
      const content = generateK6ScriptContent(spec, {
        baseUrl: "http://localhost:3000",
        users: 1,
        strictThresholds: false
      });

      expect(content).toContain("thresholds: {}");
    });

    it("includes baseUrl constant", () => {
      const spec: JourneySpec = {
        id: "baseurl",
        steps: [{ action: "navigate", target: "/" }]
      };
      const content = generateK6ScriptContent(spec, {
        baseUrl: "https://example.com:8080",
        users: 1
      });

      expect(content).toContain('const baseUrl = "https://example.com:8080"');
    });

    it("includes trackRefs data when present", () => {
      const spec: JourneySpec = {
        id: "tracks",
        steps: [{ action: "selectTrack", trackRef: "track1" }],
        data: {
          trackRefs: {
            track1: { sidPath: "/path/to/track1.sid", displayName: "Track 1" },
            track2: { sidPath: "/path/to/track2.sid" }
          }
        }
      };
      const content = generateK6ScriptContent(spec, {
        baseUrl: "http://localhost:3000",
        users: 1
      });

      expect(content).toContain('"track1"');
      expect(content).toContain('"/path/to/track1.sid"');
      expect(content).toContain('"Track 1"');
      expect(content).toContain('"track2"');
    });

    it("handles empty trackRefs gracefully", () => {
      const spec: JourneySpec = {
        id: "no-tracks",
        steps: [{ action: "navigate", target: "/" }],
        data: {
          trackRefs: {}
        }
      };
      const content = generateK6ScriptContent(spec, {
        baseUrl: "http://localhost:3000",
        users: 1
      });

      expect(content).toContain("const trackRefs = {");
      expect(content).toContain("};");
    });

    it("handles missing data field gracefully", () => {
      const spec: JourneySpec = {
        id: "no-data",
        steps: [{ action: "navigate", target: "/" }]
      };
      const content = generateK6ScriptContent(spec, {
        baseUrl: "http://localhost:3000",
        users: 1
      });

      expect(content).toContain("const trackRefs = {");
    });

    it("generates complete function body with all step types", () => {
      const spec: JourneySpec = {
        id: "complete",
        steps: [
          { action: "navigate", target: "/" },
          { action: "type", selector: "#search", value: "query" },
          { action: "selectTrack", trackRef: "track1" },
          { action: "startPlayback" },
          { action: "favoriteToggle", trackRef: "track1", toggle: "add" }
        ],
        data: {
          trackRefs: {
            track1: { sidPath: "/track.sid" }
          }
        }
      };
      const content = generateK6ScriptContent(spec, {
        baseUrl: "http://localhost:3000",
        users: 1
      });

      expect(content).toContain("export default function ()");
      expect(content).toContain("http.get"); // navigate/startPlayback
      expect(content).toContain("/api/search"); // type
      expect(content).toContain("http.post"); // selectTrack/favoriteToggle
      expect(content).toContain("/api/play");
      expect(content).toContain("/api/favorites");
    });

    it("handles empty steps array", () => {
      const spec: JourneySpec = {
        id: "empty",
        steps: []
      };
      const content = generateK6ScriptContent(spec, {
        baseUrl: "http://localhost:3000",
        users: 1
      });

      expect(content).toContain("export default function ()");
      expect(content).toContain("// No steps provided");
    });

    it("adds sleep after each step", () => {
      const spec: JourneySpec = {
        id: "sleep",
        pacingSeconds: 2,
        steps: [
          { action: "navigate", target: "/" },
          { action: "click", selector: "#btn" }
        ]
      };
      const content = generateK6ScriptContent(spec, {
        baseUrl: "http://localhost:3000",
        users: 1
      });

      const sleepCount = (content.match(/sleep\(2\)/g) || []).length;
      expect(sleepCount).toBe(2); // One after each step
    });
  });

  describe("buildK6ScriptPath", () => {
    it("generates correct script path structure", () => {
      const scriptPath = buildK6ScriptPath(tmpDir, "2024-01-15_120000", "test-journey", 10);
      
      expect(scriptPath).toContain(tmpDir);
      expect(scriptPath).toContain("2024-01-15_120000");
      expect(scriptPath).toContain("k6");
      expect(scriptPath).toContain("test-journey-u010.js");
    });

    it("pads user count to 3 digits", () => {
      const path1 = buildK6ScriptPath(tmpDir, "2024-01-15", "journey", 1);
      const path5 = buildK6ScriptPath(tmpDir, "2024-01-15", "journey", 5);
      const path100 = buildK6ScriptPath(tmpDir, "2024-01-15", "journey", 100);

      expect(path1).toContain("u001.js");
      expect(path5).toContain("u005.js");
      expect(path100).toContain("u100.js");
    });

    it("includes journey id in filename", () => {
      const scriptPath = buildK6ScriptPath(tmpDir, "timestamp", "my-journey-name", 1);
      
      expect(scriptPath).toContain("my-journey-name");
    });

    it("creates path under k6 subdirectory", () => {
      const scriptPath = buildK6ScriptPath(tmpDir, "ts", "journey", 1);
      
      expect(scriptPath).toContain(path.sep + "k6" + path.sep);
    });
  });
});
