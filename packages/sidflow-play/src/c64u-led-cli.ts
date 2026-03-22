import process from "node:process";
import {
  buildC64ULedSnapshot,
  C64U_LED_CATEGORY,
  C64U_LED_ITEMS,
  formatHelp,
  handleParseResult,
  loadConfig,
  parseArgs,
  Ultimate64Client,
  validateC64ULedPatch,
  type ArgDef,
  type SidflowConfig,
} from "@sidflow/common";

interface C64ULedCliOptions {
  config?: string;
  c64uHost?: string;
  c64uPassword?: string;
  c64uHttps?: boolean;
  mode?: string;
  autoSidMode?: string;
  pattern?: string;
  intensity?: number;
  fixedColor?: string;
}

interface C64ULedCliRuntime {
  loadConfig: (configPath?: string) => Promise<SidflowConfig>;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  env: NodeJS.ProcessEnv;
}

const ARG_DEFS: ArgDef[] = [
  {
    name: "--config",
    type: "string",
    description: "Load an alternate .sidflow.json",
  },
  {
    name: "--c64u-host",
    type: "string",
    description: "Override the C64U host",
  },
  {
    name: "--c64u-password",
    type: "string",
    description: "Override the C64U Network Password (sent as X-Password)",
  },
  {
    name: "--c64u-https",
    type: "boolean",
    description: "Use HTTPS for C64U REST requests",
  },
  {
    name: "--mode",
    type: "string",
    description: "LED strip mode",
  },
  {
    name: "--auto-sid-mode",
    type: "string",
    description: "LED auto SID mode",
  },
  {
    name: "--pattern",
    type: "string",
    description: "LED strip pattern",
  },
  {
    name: "--intensity",
    type: "integer",
    description: "LED strip intensity (0-31)",
    constraints: { min: 0, max: 31 },
  },
  {
    name: "--fixed-color",
    type: "string",
    description: "Fixed LED color",
  },
];

const HELP_TEXT = formatHelp(
  "sidflow-play c64u-led [options]",
  "Read or update C64U LED Strip Settings via the documented REST config endpoints.",
  ARG_DEFS,
  [
    "sidflow-play c64u-led --c64u-host 192.168.1.13",
    "sidflow-play c64u-led --c64u-host 192.168.1.13 --mode 'SID Music' --auto-sid-mode Enabled --pattern SingleColor --intensity 25 --fixed-color Indigo",
  ],
);

const defaultRuntime: C64ULedCliRuntime = {
  loadConfig,
  stdout: process.stdout,
  stderr: process.stderr,
  env: process.env,
};

function mergeRuntime(overrides?: Partial<C64ULedCliRuntime>): C64ULedCliRuntime {
  if (!overrides) {
    return defaultRuntime;
  }
  return {
    ...defaultRuntime,
    ...overrides,
    stdout: overrides.stdout ?? process.stdout,
    stderr: overrides.stderr ?? process.stderr,
    env: overrides.env ?? process.env,
  };
}

function resolveClientConfig(config: SidflowConfig, options: C64ULedCliOptions, env: NodeJS.ProcessEnv) {
  const configured = config.render?.ultimate64;
  const host = options.c64uHost ?? configured?.host;
  const https = options.c64uHttps ?? configured?.https;
  const password = options.c64uPassword ?? env.SIDFLOW_C64U_PASSWORD ?? configured?.password;

  if (!host) {
    throw new Error("C64U LED control requires render.ultimate64.host in config or --c64u-host");
  }

  return { host, https, password };
}

function buildPatch(options: C64ULedCliOptions) {
  return {
    ...(options.mode !== undefined ? { mode: options.mode } : {}),
    ...(options.autoSidMode !== undefined ? { autoSidMode: options.autoSidMode } : {}),
    ...(options.pattern !== undefined ? { pattern: options.pattern } : {}),
    ...(options.intensity !== undefined ? { intensity: options.intensity } : {}),
    ...(options.fixedColor !== undefined ? { fixedColor: options.fixedColor } : {}),
  };
}

export async function runC64ULedCli(argv: string[], overrides?: Partial<C64ULedCliRuntime>): Promise<number> {
  const runtime = mergeRuntime(overrides);
  const result = parseArgs<C64ULedCliOptions>(argv, ARG_DEFS);
  const exitCode = handleParseResult(result, HELP_TEXT, runtime.stdout, runtime.stderr);
  if (exitCode !== undefined) {
    return exitCode;
  }

  const { options } = result;
  const patch = buildPatch(options);
  const validationErrors = validateC64ULedPatch(patch);
  if (validationErrors.length > 0) {
    runtime.stderr.write(`Error: ${validationErrors.join("; ")}\n`);
    return 1;
  }

  let config: SidflowConfig;
  try {
    config = await runtime.loadConfig(options.config);
  } catch (error) {
    runtime.stderr.write(`Error: ${(error as Error).message}\n`);
    return 1;
  }

  try {
    const client = new Ultimate64Client(resolveClientConfig(config, options, runtime.env));
    if (Object.keys(patch).length > 0) {
      const updates: Array<[string, string]> = [
        ...(patch.mode !== undefined ? [[C64U_LED_ITEMS.mode, patch.mode]] as Array<[string, string]> : []),
        ...(patch.autoSidMode !== undefined ? [[C64U_LED_ITEMS.autoSidMode, patch.autoSidMode]] as Array<[string, string]> : []),
        ...(patch.pattern !== undefined ? [[C64U_LED_ITEMS.pattern, patch.pattern]] as Array<[string, string]> : []),
        ...(patch.intensity !== undefined ? [[C64U_LED_ITEMS.intensity, String(patch.intensity)]] as Array<[string, string]> : []),
        ...(patch.fixedColor !== undefined ? [[C64U_LED_ITEMS.fixedColor, patch.fixedColor]] as Array<[string, string]> : []),
      ];
      for (const [item, value] of updates) {
        await client.setConfig(C64U_LED_CATEGORY, item, value);
      }
    }

    const snapshot = buildC64ULedSnapshot(await client.getConfig(C64U_LED_CATEGORY));
    runtime.stdout.write(`${JSON.stringify(snapshot)}\n`);
    return 0;
  } catch (error) {
    runtime.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}