import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { DEFAULT_PACING_SECONDS } from "../src/constants.js";
import { loadJourneyFile, loadJourneysFromDir } from "../src/journey-loader.js";
import { type JourneySpec } from "../src/types.js";

async function createTempDir() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "sidflow-loader-"));
}

describe("journey-loader", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await createTempDir();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe("loadJourneyFile", () => {
    it("loads JSON journey file", async () => {
      const spec: JourneySpec = {
        id: "test-json",
        description: "Test JSON journey",
        steps: [{ action: "navigate", target: "/" }]
      };
      const filePath = path.join(tmpDir, "journey.json");
      await fs.writeFile(filePath, JSON.stringify(spec));

      const loaded = await loadJourneyFile(filePath);
      expect(loaded.id).toBe("test-json");
      expect(loaded.description).toBe("Test JSON journey");
      expect(loaded.steps.length).toBe(1);
    });

    it("loads JSON journey file with // comments", async () => {
      const raw = `{
// top comment describing the journey
"id": "comment-json",
"description": "http://example.com/resource",
"steps": [
  { "action": "navigate", "target": "/" }, // go home
  { "action": "waitForText", "text": "Ready" }
]
}`;
      const filePath = path.join(tmpDir, "commented.json");
      await fs.writeFile(filePath, raw);

      const loaded = await loadJourneyFile(filePath);
      expect(loaded.id).toBe("comment-json");
      expect(loaded.description).toBe("http://example.com/resource");
      expect(loaded.steps.length).toBe(2);
    });

    it("loads YAML journey file with .yaml extension", async () => {
      const yamlContent = `id: test-yaml
description: Test YAML journey
steps:
  - action: navigate
    target: /
  - action: click
    selector: "#button"
`;
      const filePath = path.join(tmpDir, "journey.yaml");
      await fs.writeFile(filePath, yamlContent);

      const loaded = await loadJourneyFile(filePath);
      expect(loaded.id).toBe("test-yaml");
      expect(loaded.description).toBe("Test YAML journey");
      expect(loaded.steps.length).toBe(2);
      expect(loaded.steps[0].action).toBe("navigate");
      expect(loaded.steps[1].action).toBe("click");
    });

    it("loads YAML journey file with .yml extension", async () => {
      const yamlContent = `id: test-yml
steps:
  - action: waitForText
    text: "Ready"
`;
      const filePath = path.join(tmpDir, "journey.yml");
      await fs.writeFile(filePath, yamlContent);

      const loaded = await loadJourneyFile(filePath);
      expect(loaded.id).toBe("test-yml");
      expect(loaded.steps.length).toBe(1);
    });

    it("applies default pacing when not specified", async () => {
      const spec: JourneySpec = {
        id: "no-pacing",
        steps: [{ action: "navigate", target: "/" }]
      };
      const filePath = path.join(tmpDir, "journey.json");
      await fs.writeFile(filePath, JSON.stringify(spec));

      const loaded = await loadJourneyFile(filePath);
      expect(loaded.pacingSeconds).toBe(DEFAULT_PACING_SECONDS);
    });

    it("uses spec pacing when provided", async () => {
      const spec: JourneySpec = {
        id: "with-pacing",
        pacingSeconds: 5,
        steps: [{ action: "navigate", target: "/" }]
      };
      const filePath = path.join(tmpDir, "journey.json");
      await fs.writeFile(filePath, JSON.stringify(spec));

      const loaded = await loadJourneyFile(filePath);
      expect(loaded.pacingSeconds).toBe(5);
    });

    it("uses options pacing when spec pacing not provided", async () => {
      const spec: JourneySpec = {
        id: "options-pacing",
        steps: [{ action: "navigate", target: "/" }]
      };
      const filePath = path.join(tmpDir, "journey.json");
      await fs.writeFile(filePath, JSON.stringify(spec));

      const loaded = await loadJourneyFile(filePath, { pacingSeconds: 10 });
      expect(loaded.pacingSeconds).toBe(10);
    });

    it("prefers spec pacing over options pacing", async () => {
      const spec: JourneySpec = {
        id: "spec-wins",
        pacingSeconds: 7,
        steps: [{ action: "navigate", target: "/" }]
      };
      const filePath = path.join(tmpDir, "journey.json");
      await fs.writeFile(filePath, JSON.stringify(spec));

      const loaded = await loadJourneyFile(filePath, { pacingSeconds: 15 });
      expect(loaded.pacingSeconds).toBe(7);
    });

    it("throws error for unsupported file extension", async () => {
      const filePath = path.join(tmpDir, "journey.txt");
      await fs.writeFile(filePath, "some content");

      await expect(loadJourneyFile(filePath)).rejects.toThrow("Unsupported journey file extension");
    });

    it("throws error for missing id field", async () => {
      const spec = {
        steps: [{ action: "navigate", target: "/" }]
      };
      const filePath = path.join(tmpDir, "no-id.json");
      await fs.writeFile(filePath, JSON.stringify(spec));

      await expect(loadJourneyFile(filePath)).rejects.toThrow('missing "id"');
    });

    it("throws error for non-string id field", async () => {
      const spec = {
        id: 123,
        steps: [{ action: "navigate", target: "/" }]
      };
      const filePath = path.join(tmpDir, "bad-id.json");
      await fs.writeFile(filePath, JSON.stringify(spec));

      await expect(loadJourneyFile(filePath)).rejects.toThrow('missing "id"');
    });

    it("throws error for missing steps array", async () => {
      const spec = {
        id: "no-steps"
      };
      const filePath = path.join(tmpDir, "no-steps.json");
      await fs.writeFile(filePath, JSON.stringify(spec));

      await expect(loadJourneyFile(filePath)).rejects.toThrow("has no steps");
    });

    it("throws error for empty steps array", async () => {
      const spec = {
        id: "empty-steps",
        steps: []
      };
      const filePath = path.join(tmpDir, "empty-steps.json");
      await fs.writeFile(filePath, JSON.stringify(spec));

      await expect(loadJourneyFile(filePath)).rejects.toThrow("has no steps");
    });

    it("throws error for invalid JSON", async () => {
      const filePath = path.join(tmpDir, "invalid.json");
      await fs.writeFile(filePath, "{ invalid json }");

      await expect(loadJourneyFile(filePath)).rejects.toThrow();
    });

    it("throws error for invalid YAML", async () => {
      const filePath = path.join(tmpDir, "invalid.yaml");
      await fs.writeFile(filePath, ":\n  - invalid\n  : yaml");

      await expect(loadJourneyFile(filePath)).rejects.toThrow();
    });
  });

  describe("loadJourneysFromDir", () => {
    it("loads multiple journey files from directory", async () => {
      const spec1: JourneySpec = {
        id: "journey-1",
        steps: [{ action: "navigate", target: "/" }]
      };
      const spec2: JourneySpec = {
        id: "journey-2",
        steps: [{ action: "click", selector: "#btn" }]
      };

      await fs.writeFile(path.join(tmpDir, "journey1.json"), JSON.stringify(spec1));
      await fs.writeFile(path.join(tmpDir, "journey2.yaml"), "id: journey-2\nsteps:\n  - action: click\n    selector: '#btn'");

      const journeys = await loadJourneysFromDir(tmpDir);
      expect(journeys.length).toBe(2);
      expect(journeys.find(j => j.id === "journey-1")).toBeDefined();
      expect(journeys.find(j => j.id === "journey-2")).toBeDefined();
    });

    it("ignores non-journey files", async () => {
      const spec: JourneySpec = {
        id: "valid",
        steps: [{ action: "navigate", target: "/" }]
      };

      await fs.writeFile(path.join(tmpDir, "journey.json"), JSON.stringify(spec));
      await fs.writeFile(path.join(tmpDir, "readme.txt"), "This is a readme");
      await fs.writeFile(path.join(tmpDir, "script.js"), "console.log('hi')");

      const journeys = await loadJourneysFromDir(tmpDir);
      expect(journeys.length).toBe(1);
      expect(journeys[0].id).toBe("valid");
    });

    it("ignores subdirectories", async () => {
      const spec: JourneySpec = {
        id: "top-level",
        steps: [{ action: "navigate", target: "/" }]
      };

      await fs.writeFile(path.join(tmpDir, "journey.json"), JSON.stringify(spec));
      
      const subDir = path.join(tmpDir, "subdir");
      await fs.mkdir(subDir);
      await fs.writeFile(path.join(subDir, "nested.json"), JSON.stringify({ id: "nested", steps: [] }));

      const journeys = await loadJourneysFromDir(tmpDir);
      expect(journeys.length).toBe(1);
      expect(journeys[0].id).toBe("top-level");
    });

    it("returns empty array for empty directory", async () => {
      const journeys = await loadJourneysFromDir(tmpDir);
      expect(journeys.length).toBe(0);
    });

    it("applies options pacing to all loaded journeys", async () => {
      const spec1: JourneySpec = {
        id: "journey-1",
        steps: [{ action: "navigate", target: "/" }]
      };
      const spec2: JourneySpec = {
        id: "journey-2",
        pacingSeconds: 8,
        steps: [{ action: "click", selector: "#btn" }]
      };

      await fs.writeFile(path.join(tmpDir, "journey1.json"), JSON.stringify(spec1));
      await fs.writeFile(path.join(tmpDir, "journey2.json"), JSON.stringify(spec2));

      const journeys = await loadJourneysFromDir(tmpDir, { pacingSeconds: 12 });
      
      const j1 = journeys.find(j => j.id === "journey-1");
      const j2 = journeys.find(j => j.id === "journey-2");
      
      expect(j1?.pacingSeconds).toBe(12);
      expect(j2?.pacingSeconds).toBe(8); // spec pacing takes precedence
    });
  });
});
