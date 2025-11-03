import { describe, expect, it } from "bun:test";
import { runTrainCli } from "../src/cli.js";

describe("Train CLI", () => {
  it("shows help message with --help flag", async () => {
    // Capture stdout
    let output = "";
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output += chunk.toString();
      return true;
    }) as typeof process.stdout.write;

    try {
      const exitCode = await runTrainCli(["--help"]);

      expect(exitCode).toBe(0);
      expect(output).toContain("Usage: sidflow train");
      expect(output).toContain("--epochs");
      expect(output).toContain("--batch-size");
      expect(output).toContain("--evaluate");
    } finally {
      process.stdout.write = originalWrite;
    }
  });

  it("returns error for unknown options", async () => {
    // Capture stderr
    let errorOutput = "";
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      errorOutput += chunk.toString();
      return true;
    }) as typeof process.stderr.write;

    try {
      const exitCode = await runTrainCli(["--unknown-option"]);

      expect(exitCode).toBe(1);
      expect(errorOutput).toContain("Unknown option");
    } finally {
      process.stderr.write = originalWrite;
    }
  });

  it("returns error for invalid epoch value", async () => {
    let errorOutput = "";
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      errorOutput += chunk.toString();
      return true;
    }) as typeof process.stderr.write;

    try {
      const exitCode = await runTrainCli(["--epochs", "invalid"]);

      expect(exitCode).toBe(1);
      expect(errorOutput).toContain("--epochs must be a positive integer");
    } finally {
      process.stderr.write = originalWrite;
    }
  });

  it("returns error for missing epoch value", async () => {
    let errorOutput = "";
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      errorOutput += chunk.toString();
      return true;
    }) as typeof process.stderr.write;

    try {
      const exitCode = await runTrainCli(["--epochs"]);

      expect(exitCode).toBe(1);
      expect(errorOutput).toContain("--epochs requires a value");
    } finally {
      process.stderr.write = originalWrite;
    }
  });

  it("parses epochs option correctly", async () => {
    // This test would try to train, which we can't do without data
    // So we just verify it doesn't fail on option parsing
    let errorOutput = "";
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      errorOutput += chunk.toString();
      return true;
    }) as typeof process.stderr.write;

    try {
      const exitCode = await runTrainCli(["--epochs", "10"]);
      
      // It will fail because there's no data, but shouldn't fail on option parsing
      expect(exitCode).toBe(1);
      expect(errorOutput).not.toContain("--epochs must be a positive integer");
    } finally {
      process.stderr.write = originalWrite;
    }
  });

  it("parses batch-size option correctly", async () => {
    let errorOutput = "";
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      errorOutput += chunk.toString();
      return true;
    }) as typeof process.stderr.write;

    try {
      const exitCode = await runTrainCli(["--batch-size", "16"]);
      
      expect(exitCode).toBe(1);
      expect(errorOutput).not.toContain("--batch-size must be a positive integer");
    } finally {
      process.stderr.write = originalWrite;
    }
  });

  it("parses learning-rate option correctly", async () => {
    let errorOutput = "";
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      errorOutput += chunk.toString();
      return true;
    }) as typeof process.stderr.write;

    try {
      const exitCode = await runTrainCli(["--learning-rate", "0.01"]);
      
      expect(exitCode).toBe(1);
      expect(errorOutput).not.toContain("--learning-rate must be a positive number");
    } finally {
      process.stderr.write = originalWrite;
    }
  });

  it("handles --no-evaluate flag", async () => {
    let errorOutput = "";
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      errorOutput += chunk.toString();
      return true;
    }) as typeof process.stderr.write;

    try {
      const exitCode = await runTrainCli(["--no-evaluate"]);
      
      expect(exitCode).toBe(1);
      // Should fail due to no data, not due to option parsing
      expect(errorOutput).not.toContain("Unknown option");
    } finally {
      process.stderr.write = originalWrite;
    }
  });

  it("handles --force flag", async () => {
    let errorOutput = "";
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      errorOutput += chunk.toString();
      return true;
    }) as typeof process.stderr.write;

    try {
      const exitCode = await runTrainCli(["--force"]);
      
      expect(exitCode).toBe(1);
      expect(errorOutput).not.toContain("Unknown option");
    } finally {
      process.stderr.write = originalWrite;
    }
  });
});
