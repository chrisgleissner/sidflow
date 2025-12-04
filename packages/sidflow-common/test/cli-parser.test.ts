import { describe, expect, it } from "bun:test";
import {
  parseArgs,
  formatHelp,
  handleParseResult,
  type ArgDef,
  type ParseResult
} from "../src/cli-parser.js";

describe("cli-parser", () => {
  describe("parseArgs", () => {
    it("parses string arguments", () => {
      const defs: ArgDef[] = [
        { name: "--config", type: "string", description: "Config path" }
      ];

      const result = parseArgs<{ config?: string }>(
        ["--config", "my.json"],
        defs
      );

      expect(result.errors).toEqual([]);
      expect(result.options.config).toBe("my.json");
      expect(result.helpRequested).toBe(false);
    });

    it("parses boolean flags", () => {
      const defs: ArgDef[] = [
        { name: "--force", type: "boolean", description: "Force rebuild" }
      ];

      const result = parseArgs<{ force?: boolean }>(["--force"], defs);

      expect(result.errors).toEqual([]);
      expect(result.options.force).toBe(true);
    });

    it("parses negation flags", () => {
      const defs: ArgDef[] = [
        {
          name: "--evaluate",
          type: "boolean",
          description: "Run evaluation",
          negation: "--no-evaluate",
          defaultValue: true
        }
      ];

      const result = parseArgs<{ evaluate?: boolean }>(["--no-evaluate"], defs);

      expect(result.errors).toEqual([]);
      expect(result.options.evaluate).toBe(false);
    });

    it("parses integer arguments with validation", () => {
      const defs: ArgDef[] = [
        {
          name: "--epochs",
          type: "integer",
          description: "Number of epochs",
          constraints: { positive: true }
        }
      ];

      const validResult = parseArgs<{ epochs?: number }>(["--epochs", "10"], defs);
      expect(validResult.errors).toEqual([]);
      expect(validResult.options.epochs).toBe(10);

      const invalidResult = parseArgs<{ epochs?: number }>(["--epochs", "abc"], defs);
      expect(invalidResult.errors).toContain("--epochs must be an integer");

      const negativeResult = parseArgs<{ epochs?: number }>(["--epochs", "-5"], defs);
      expect(negativeResult.errors).toContain("--epochs must be a positive number");
    });

    it("parses float arguments with constraints", () => {
      const defs: ArgDef[] = [
        {
          name: "--rate",
          type: "float",
          description: "Learning rate",
          constraints: { min: 0, max: 1 }
        }
      ];

      const validResult = parseArgs<{ rate?: number }>(["--rate", "0.5"], defs);
      expect(validResult.errors).toEqual([]);
      expect(validResult.options.rate).toBe(0.5);

      const tooHighResult = parseArgs<{ rate?: number }>(["--rate", "2.0"], defs);
      expect(tooHighResult.errors).toContain("--rate must be at most 1");

      const tooLowResult = parseArgs<{ rate?: number }>(["--rate", "-0.1"], defs);
      expect(tooLowResult.errors).toContain("--rate must be at least 0");
    });

    it("handles missing required values", () => {
      const defs: ArgDef[] = [
        { name: "--config", type: "string", description: "Config path" }
      ];

      const result = parseArgs<{ config?: string }>(["--config"], defs);

      expect(result.errors).toContain("--config requires a value");
    });

    it("handles missing values when next token is a flag", () => {
      const defs: ArgDef[] = [
        { name: "--config", type: "string", description: "Config path" },
        { name: "--force", type: "boolean", description: "Force" }
      ];

      const result = parseArgs<{ config?: string; force?: boolean }>(
        ["--config", "--force"],
        defs
      );

      expect(result.errors).toContain("--config requires a value");
    });

    it("reports unknown options", () => {
      const defs: ArgDef[] = [];

      const result = parseArgs(["--unknown"], defs);

      expect(result.errors).toContain("Unknown option: --unknown");
    });

    it("reports unexpected positional arguments", () => {
      const defs: ArgDef[] = [];

      const result = parseArgs(["something"], defs);

      expect(result.errors).toContain("Unexpected argument: something");
    });

    it("allows unknown options when configured", () => {
      const defs: ArgDef[] = [];

      const result = parseArgs(["--unknown"], defs, { allowUnknown: true });

      expect(result.errors).toEqual([]);
    });

    it("allows positional arguments when configured", () => {
      const defs: ArgDef[] = [];

      const result = parseArgs(["file.txt", "another.txt"], defs, {
        allowPositional: true
      });

      expect(result.errors).toEqual([]);
      expect(result.positional).toEqual(["file.txt", "another.txt"]);
    });

    it("detects --help flag", () => {
      const defs: ArgDef[] = [];

      const result = parseArgs(["--help"], defs);

      expect(result.helpRequested).toBe(true);
    });

    it("detects -h alias", () => {
      const defs: ArgDef[] = [];

      const result = parseArgs(["-h"], defs);

      expect(result.helpRequested).toBe(true);
    });

    it("stops parsing on --help", () => {
      const defs: ArgDef[] = [
        { name: "--config", type: "string", description: "Config" }
      ];

      // --config without value after --help should not error
      const result = parseArgs(["--help", "--config"], defs);

      expect(result.helpRequested).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("applies default values", () => {
      const defs: ArgDef[] = [
        {
          name: "--limit",
          type: "integer",
          description: "Limit",
          defaultValue: 20
        }
      ];

      const result = parseArgs<{ limit?: number }>([], defs);

      expect(result.options.limit).toBe(20);
    });

    it("overrides default values when provided", () => {
      const defs: ArgDef[] = [
        {
          name: "--limit",
          type: "integer",
          description: "Limit",
          defaultValue: 20
        }
      ];

      const result = parseArgs<{ limit?: number }>(["--limit", "50"], defs);

      expect(result.options.limit).toBe(50);
    });

    it("parses short aliases", () => {
      const defs: ArgDef[] = [
        { name: "--verbose", alias: "-v", type: "boolean", description: "Verbose" }
      ];

      const result = parseArgs<{ verbose?: boolean }>(["-v"], defs);

      expect(result.options.verbose).toBe(true);
    });

    it("converts kebab-case to camelCase", () => {
      const defs: ArgDef[] = [
        { name: "--config-path", type: "string", description: "Config path" }
      ];

      const result = parseArgs<{ configPath?: string }>(
        ["--config-path", "test.json"],
        defs
      );

      expect(result.options.configPath).toBe("test.json");
    });

    it("handles multiple arguments", () => {
      const defs: ArgDef[] = [
        { name: "--config", type: "string", description: "Config" },
        { name: "--force", type: "boolean", description: "Force" },
        { name: "--epochs", type: "integer", description: "Epochs" }
      ];

      const result = parseArgs<{ config?: string; force?: boolean; epochs?: number }>(
        ["--config", "my.json", "--force", "--epochs", "10"],
        defs
      );

      expect(result.errors).toEqual([]);
      expect(result.options.config).toBe("my.json");
      expect(result.options.force).toBe(true);
      expect(result.options.epochs).toBe(10);
    });

    it("stops on first non-option when configured", () => {
      const defs: ArgDef[] = [
        { name: "--verbose", type: "boolean", description: "Verbose" }
      ];

      const result = parseArgs<{ verbose?: boolean }>(
        ["--verbose", "subcommand", "--other"],
        defs,
        { stopOnFirstNonOption: true, allowPositional: true }
      );

      expect(result.options.verbose).toBe(true);
      expect(result.positional).toEqual(["subcommand", "--other"]);
    });
  });

  describe("formatHelp", () => {
    it("generates help text with usage and description", () => {
      const defs: ArgDef[] = [
        { name: "--config", type: "string", description: "Config file path" }
      ];

      const help = formatHelp(
        "sidflow fetch [options]",
        "Download the HVSC collection.",
        defs
      );

      expect(help).toContain("Usage: sidflow fetch [options]");
      expect(help).toContain("Download the HVSC collection.");
      expect(help).toContain("--config");
      expect(help).toContain("Config file path");
      expect(help).toContain("--help");
    });

    it("includes default values", () => {
      const defs: ArgDef[] = [
        {
          name: "--limit",
          type: "integer",
          description: "Max items",
          defaultValue: 20
        }
      ];

      const help = formatHelp("cmd", "Description", defs);

      expect(help).toContain("(default: 20)");
    });

    it("includes examples", () => {
      const defs: ArgDef[] = [];
      const examples = ["cmd --force", "cmd --config custom.json"];

      const help = formatHelp("cmd", "Description", defs, examples);

      expect(help).toContain("Examples:");
      expect(help).toContain("cmd --force");
      expect(help).toContain("cmd --config custom.json");
    });

    it("shows aliases", () => {
      const defs: ArgDef[] = [
        { name: "--verbose", alias: "-v", type: "boolean", description: "Verbose" }
      ];

      const help = formatHelp("cmd", "Description", defs);

      expect(help).toContain("-v,");
      expect(help).toContain("--verbose");
    });

    it("shows negation flags", () => {
      const defs: ArgDef[] = [
        {
          name: "--evaluate",
          type: "boolean",
          description: "Run evaluation",
          negation: "--no-evaluate"
        }
      ];

      const help = formatHelp("cmd", "Description", defs);

      expect(help).toContain("--no-evaluate");
      expect(help).toContain("Disable evaluate");
    });
  });

  describe("handleParseResult", () => {
    it("returns 0 for help requested with no errors", () => {
      const result: ParseResult<Record<string, unknown>> = {
        options: {},
        errors: [],
        helpRequested: true,
        positional: []
      };

      const chunks: string[] = [];
      const stdout = { write: (s: string) => { chunks.push(s); return true; } } as NodeJS.WritableStream;

      const code = handleParseResult(result, "Help text", stdout);

      expect(code).toBe(0);
      expect(chunks).toContain("Help text");
    });

    it("returns 1 for help requested with errors", () => {
      const result: ParseResult<Record<string, unknown>> = {
        options: {},
        errors: ["Some error"],
        helpRequested: true,
        positional: []
      };

      const chunks: string[] = [];
      const stdout = { write: (s: string) => { chunks.push(s); return true; } } as NodeJS.WritableStream;

      const code = handleParseResult(result, "Help text", stdout);

      expect(code).toBe(1);
    });

    it("returns 1 for errors without help", () => {
      const result: ParseResult<Record<string, unknown>> = {
        options: {},
        errors: ["Error 1", "Error 2"],
        helpRequested: false,
        positional: []
      };

      const chunks: string[] = [];
      const stderr = { write: (s: string) => { chunks.push(s); return true; } } as NodeJS.WritableStream;
      const stdout = { write: () => true } as NodeJS.WritableStream;

      const code = handleParseResult(result, "Help", stdout, stderr);

      expect(code).toBe(1);
      expect(chunks.join("")).toContain("Error 1");
      expect(chunks.join("")).toContain("Error 2");
      expect(chunks.join("")).toContain("--help");
    });

    it("returns undefined to continue when no help or errors", () => {
      const result: ParseResult<Record<string, unknown>> = {
        options: {},
        errors: [],
        helpRequested: false,
        positional: []
      };

      const code = handleParseResult(result, "Help");

      expect(code).toBeUndefined();
    });
  });
});

