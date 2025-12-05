/**
 * Generic CLI argument parser for SIDFlow CLI tools.
 * 
 * Provides a declarative way to define CLI arguments and generates
 * consistent parsing logic and help text.
 */

/**
 * Argument value type for parsing
 */
export type ArgType = "string" | "number" | "boolean" | "integer" | "float";

/**
 * Numeric value constraints
 */
export interface NumericConstraint {
  /** Minimum allowed value (inclusive) */
  min?: number;
  /** Maximum allowed value (inclusive) */
  max?: number;
  /** Whether the value must be positive (> 0) */
  positive?: boolean;
}

/**
 * Argument definition for CLI parsing
 */
export interface ArgDef {
  /** Full argument name (e.g., "--config") */
  name: string;
  /** Short alias (e.g., "-c") */
  alias?: string;
  /** Value type; "boolean" means flag-only, no value needed */
  type: ArgType;
  /** Description for help text */
  description: string;
  /** Whether a value is required when the flag is present */
  required?: boolean;
  /** Default value if not provided */
  defaultValue?: string | number | boolean;
  /** Numeric constraints for number/integer/float types */
  constraints?: NumericConstraint;
  /** Negation flag name for boolean (e.g., "--no-evaluate" for "--evaluate") */
  negation?: string;
}

/**
 * Result of parsing CLI arguments
 */
export interface ParseResult<T> {
  /** Parsed options */
  options: T;
  /** Parsing errors encountered */
  errors: string[];
  /** Whether --help was requested */
  helpRequested: boolean;
  /** Positional arguments (non-flag values) */
  positional: string[];
}

/**
 * Options for the argument parser
 */
export interface ParseOptions {
  /** Allow unknown arguments without error (default: false) */
  allowUnknown?: boolean;
  /** Allow positional arguments (default: false) */
  allowPositional?: boolean;
  /** Stop parsing on first non-option (default: false) */
  stopOnFirstNonOption?: boolean;
}

function createFlagMap(defs: ArgDef[]): Map<string, ArgDef> {
  const map = new Map<string, ArgDef>();
  for (const def of defs) {
    map.set(def.name, def);
    if (def.alias) {
      map.set(def.alias, def);
    }
    if (def.negation) {
      map.set(def.negation, def);
    }
  }
  // Always add --help
  if (!map.has("--help")) {
    map.set("--help", {
      name: "--help",
      alias: "-h",
      type: "boolean",
      description: "Show this message and exit"
    });
    map.set("-h", map.get("--help")!);
  }
  return map;
}

function parseValue(
  def: ArgDef,
  value: string | undefined,
  isNegation: boolean
): { value: unknown; error?: string } {
  // Boolean flags
  if (def.type === "boolean") {
    return { value: !isNegation };
  }

  // Value required - but allow negative numbers (starting with - followed by digit)
  if (value === undefined) {
    return { value: undefined, error: `${def.name} requires a value` };
  }
  
  // Check if it looks like a flag vs a negative number
  const looksLikeFlag = value.startsWith("-") && !/^-\d/.test(value);
  if (looksLikeFlag) {
    return { value: undefined, error: `${def.name} requires a value` };
  }

  switch (def.type) {
    case "string":
      return { value };

    case "number":
    case "float": {
      const num = Number.parseFloat(value);
      if (Number.isNaN(num)) {
        return { value: undefined, error: `${def.name} must be a number` };
      }
      const constraintError = checkConstraints(def, num);
      if (constraintError) {
        return { value: undefined, error: constraintError };
      }
      return { value: num };
    }

    case "integer": {
      const num = Number.parseInt(value, 10);
      if (Number.isNaN(num)) {
        return { value: undefined, error: `${def.name} must be an integer` };
      }
      const constraintError = checkConstraints(def, num);
      if (constraintError) {
        return { value: undefined, error: constraintError };
      }
      return { value: num };
    }

    default:
      return { value };
  }
}

function checkConstraints(def: ArgDef, value: number): string | undefined {
  const { constraints } = def;
  if (!constraints) {
    return undefined;
  }

  if (constraints.positive && value <= 0) {
    return `${def.name} must be a positive number`;
  }
  if (constraints.min !== undefined && value < constraints.min) {
    return `${def.name} must be at least ${constraints.min}`;
  }
  if (constraints.max !== undefined && value > constraints.max) {
    return `${def.name} must be at most ${constraints.max}`;
  }
  return undefined;
}

function getOptionKey(def: ArgDef): string {
  // Convert "--config-path" to "configPath"
  const key = def.name
    .replace(/^-+/, "")
    .replace(/-([a-z])/g, (_, char) => char.toUpperCase());
  return key;
}

/**
 * Parse CLI arguments according to the provided definitions.
 * 
 * @param argv Array of CLI arguments (e.g., process.argv.slice(2))
 * @param defs Array of argument definitions
 * @param parseOptions Optional parsing configuration
 * @returns Parsed result with options, errors, and helpRequested flag
 */
export function parseArgs<T>(
  argv: string[],
  defs: ArgDef[],
  parseOptions: ParseOptions = {}
): ParseResult<T> {
  const flagMap = createFlagMap(defs);
  const options: Record<string, unknown> = {};
  const errors: string[] = [];
  const positional: string[] = [];
  let helpRequested = false;

  // Set defaults
  for (const def of defs) {
    if (def.defaultValue !== undefined) {
      options[getOptionKey(def)] = def.defaultValue;
    }
  }

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];

    // Check for help
    if (token === "--help" || token === "-h") {
      helpRequested = true;
      break;
    }

    // Check if it's a flag
    if (token.startsWith("-")) {
      const def = flagMap.get(token);

      if (!def) {
        if (!parseOptions.allowUnknown) {
          errors.push(`Unknown option: ${token}`);
        }
        continue;
      }

      const isNegation = def.negation === token;
      const key = getOptionKey(def);

      if (def.type === "boolean") {
        options[key] = !isNegation;
      } else {
        const nextValue = argv[i + 1];
        const { value, error } = parseValue(def, nextValue, false);

        if (error) {
          errors.push(error);
        } else {
          options[key] = value;
          i++; // Skip the value token
        }
      }
    } else {
      // Positional argument
      if (parseOptions.stopOnFirstNonOption) {
        positional.push(...argv.slice(i));
        break;
      }

      if (parseOptions.allowPositional) {
        positional.push(token);
      } else {
        errors.push(`Unexpected argument: ${token}`);
      }
    }
  }

  return {
    options: options as T,
    errors,
    helpRequested,
    positional
  };
}

/**
 * Format help text from argument definitions.
 * 
 * @param usage Usage line (e.g., "sidflow fetch [options]")
 * @param description Short description of the command
 * @param defs Argument definitions
 * @param examples Optional example commands
 * @returns Formatted help text
 */
export function formatHelp(
  usage: string,
  description: string,
  defs: ArgDef[],
  examples?: string[]
): string {
  const lines: string[] = [
    `Usage: ${usage}`,
    "",
    description,
    "",
    "Options:"
  ];

  // Calculate alignment
  const maxFlagLen = Math.max(
    ...defs.map((d) => {
      const parts = [d.name];
      if (d.alias) {
        parts.unshift(d.alias + ",");
      }
      if (d.type !== "boolean") {
        parts.push("<value>");
      }
      return parts.join(" ").length;
    }),
    "--help".length
  );

  // Add help option first
  lines.push(`  ${"--help, -h".padEnd(maxFlagLen + 2)}  Show this message and exit`);

  // Add defined options
  for (const def of defs) {
    const parts: string[] = [];
    if (def.alias) {
      parts.push(def.alias + ",");
    }
    parts.push(def.name);
    if (def.type !== "boolean") {
      parts.push("<value>");
    }

    const flag = parts.join(" ").padEnd(maxFlagLen + 2);
    let desc = def.description;
    
    if (def.defaultValue !== undefined) {
      desc += ` (default: ${def.defaultValue})`;
    }

    lines.push(`  ${flag}  ${desc}`);

    // Add negation if present
    if (def.negation) {
      const negFlag = def.negation.padEnd(maxFlagLen + 2);
      lines.push(`  ${negFlag}  Disable ${def.name.replace(/^--/, "")}`);
    }
  }

  if (examples && examples.length > 0) {
    lines.push("");
    lines.push("Examples:");
    for (const example of examples) {
      lines.push(`  ${example}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}

/**
 * Standard CLI result handler that writes help/errors and returns exit code.
 * 
 * @param result Parse result
 * @param helpText Help text to display
 * @param stdout Output stream (default: process.stdout)
 * @param stderr Error stream (default: process.stderr)
 * @returns Exit code: 0 for help, 1 for errors, undefined to continue
 */
export function handleParseResult<T>(
  result: ParseResult<T>,
  helpText: string,
  stdout: NodeJS.WritableStream = process.stdout,
  stderr: NodeJS.WritableStream = process.stderr
): number | undefined {
  if (result.helpRequested) {
    stdout.write(helpText);
    return result.errors.length > 0 ? 1 : 0;
  }

  if (result.errors.length > 0) {
    for (const error of result.errors) {
      stderr.write(`${error}\n`);
    }
    stderr.write("Use --help to list supported options.\n");
    return 1;
  }

  return undefined; // Continue with command execution
}

