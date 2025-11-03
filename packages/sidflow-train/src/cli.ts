#!/usr/bin/env bun

import process from "node:process";
import { trainModel, type TrainModelOptions } from "./index.js";

interface CliOptions {
  configPath?: string;
  epochs?: number;
  batchSize?: number;
  learningRate?: number;
  evaluate?: boolean;
  force?: boolean;
  help?: boolean;
}

interface ParseResult {
  options: CliOptions;
  errors: string[];
}

function printHelp(): void {
  const lines = [
    "Usage: sidflow train [options]",
    "",
    "Train the ML model on explicit and implicit feedback data.",
    "",
    "Options:",
    "  --config <path>        Load an alternate .sidflow.json",
    "  --epochs <n>           Number of training epochs (default: 5)",
    "  --batch-size <n>       Training batch size (default: 8)",
    "  --learning-rate <n>    Learning rate (default: 0.001)",
    "  --evaluate             Evaluate on test set (default: true)",
    "  --no-evaluate          Skip evaluation on test set",
    "  --force                Force complete retraining from scratch",
    "  --help                 Show this message and exit",
    "",
    "Examples:",
    "  sidflow train                      # Train with default settings",
    "  sidflow train --epochs 10          # Train for 10 epochs",
    "  sidflow train --force              # Force complete retraining",
    "  sidflow train --no-evaluate        # Skip test set evaluation",
    ""
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

function parseArgs(argv: string[]): ParseResult {
  const options: CliOptions = {
    evaluate: true // default to true
  };
  const errors: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    
    switch (token) {
      case "--help":
        options.help = true;
        break;
        
      case "--config": {
        const next = argv[i + 1];
        if (!next) {
          errors.push("--config requires a value");
        } else {
          options.configPath = next;
          i += 1;
        }
        break;
      }
      
      case "--epochs": {
        const next = argv[i + 1];
        if (!next) {
          errors.push("--epochs requires a value");
        } else {
          const value = Number.parseInt(next, 10);
          if (Number.isNaN(value) || value <= 0) {
            errors.push("--epochs must be a positive integer");
          } else {
            options.epochs = value;
            i += 1;
          }
        }
        break;
      }
      
      case "--batch-size": {
        const next = argv[i + 1];
        if (!next) {
          errors.push("--batch-size requires a value");
        } else {
          const value = Number.parseInt(next, 10);
          if (Number.isNaN(value) || value <= 0) {
            errors.push("--batch-size must be a positive integer");
          } else {
            options.batchSize = value;
            i += 1;
          }
        }
        break;
      }
      
      case "--learning-rate": {
        const next = argv[i + 1];
        if (!next) {
          errors.push("--learning-rate requires a value");
        } else {
          const value = Number.parseFloat(next);
          if (Number.isNaN(value) || value <= 0) {
            errors.push("--learning-rate must be a positive number");
          } else {
            options.learningRate = value;
            i += 1;
          }
        }
        break;
      }
      
      case "--evaluate":
        options.evaluate = true;
        break;
        
      case "--no-evaluate":
        options.evaluate = false;
        break;
        
      case "--force":
        options.force = true;
        break;
        
      default:
        if (token.startsWith("--")) {
          errors.push(`Unknown option: ${token}`);
        } else {
          errors.push(`Unexpected argument: ${token}`);
        }
    }
  }

  return { options, errors };
}

export async function runTrainCli(argv: string[]): Promise<number> {
  const { options, errors } = parseArgs(argv);

  if (options.help) {
    printHelp();
    return errors.length > 0 ? 1 : 0;
  }

  if (errors.length > 0) {
    for (const message of errors) {
      process.stderr.write(`${message}\n`);
    }
    process.stderr.write("Use --help to list supported options.\n");
    return 1;
  }

  try {
    const trainOptions: TrainModelOptions = {
      trainOptions: {
        epochs: options.epochs,
        batchSize: options.batchSize,
        learningRate: options.learningRate
      },
      evaluate: options.evaluate
    };

    const result = await trainModel(trainOptions);

    // Print summary
    process.stdout.write("\n=== Training Summary ===\n");
    process.stdout.write(`Training samples: ${result.trainSamples}\n`);
    process.stdout.write(`Test samples: ${result.testSamples}\n`);
    process.stdout.write(`Training loss: ${result.trainLoss.toFixed(4)}\n`);
    process.stdout.write(`Training MAE: ${result.trainMAE.toFixed(4)}\n`);
    
    if (result.testMAE !== undefined) {
      process.stdout.write(`Test MAE: ${result.testMAE.toFixed(4)}\n`);
    }
    
    if (result.testR2 !== undefined) {
      process.stdout.write(`Test R²: ${result.testR2.toFixed(4)}\n`);
    }
    
    process.stdout.write("\nModel saved to data/model/\n");
    process.stdout.write("Training summary saved to data/training/training-log.jsonl\n");

    return 0;
  } catch (error) {
    process.stderr.write(`Training failed: ${(error as Error).message}\n`);
    if (process.env.DEBUG) {
      console.error(error);
    }
    return 1;
  }
}

if (import.meta.main) {
  runTrainCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
