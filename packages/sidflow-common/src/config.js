import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
export const DEFAULT_CONFIG_FILENAME = ".sidflow.json";
let cachedConfig = null;
let cachedPath = null;
let sidplayWarningEmitted = false;
export class SidflowConfigError extends Error {
    constructor(message, options) {
        super(message);
        this.name = "SidflowConfigError";
        if (options?.cause !== undefined) {
            this.cause = options.cause;
        }
    }
}
export function getDefaultConfigPath(cwd = process.cwd()) {
    return path.resolve(cwd, DEFAULT_CONFIG_FILENAME);
}
export function resetConfigCache() {
    cachedConfig = null;
    cachedPath = null;
}
export async function loadConfig(configPath) {
    const resolvedPath = path.resolve(configPath ?? getDefaultConfigPath());
    if (cachedConfig && cachedPath === resolvedPath) {
        return cachedConfig;
    }
    let fileContents;
    try {
        fileContents = await readFile(resolvedPath, "utf8");
    }
    catch (error) {
        throw new SidflowConfigError(`Unable to read SIDFlow config at ${resolvedPath}`, { cause: error });
    }
    let data;
    try {
        data = JSON.parse(fileContents);
    }
    catch (error) {
        throw new SidflowConfigError(`Invalid JSON in SIDFlow config at ${resolvedPath}`, { cause: error });
    }
    const config = validateConfig(data, resolvedPath);
    const overrideSidBase = process.env.SIDFLOW_SID_BASE_PATH;
    if (overrideSidBase && overrideSidBase.trim().length > 0) {
        config.sidPath = path.normalize(overrideSidBase);
    }
    if (config.sidplayPath && !sidplayWarningEmitted) {
        sidplayWarningEmitted = true;
        process.stderr.write("[sidflow] Config key \"sidplayPath\" is deprecated. The WASM renderer is now used by default; remove this key once native fallbacks are retired.\n");
    }
    cachedConfig = config;
    cachedPath = resolvedPath;
    return config;
}
export function getCachedConfig() {
    if (!cachedConfig) {
        throw new SidflowConfigError("Config has not been loaded yet. Call loadConfig() first.");
    }
    return cachedConfig;
}
function validateConfig(value, configPath) {
    if (!value || typeof value !== "object") {
        throw new SidflowConfigError(`Config at ${configPath} must be a JSON object`);
    }
    const record = value;
    const requiredString = (key) => {
        const raw = record[key];
        if (typeof raw !== "string" || raw.trim() === "") {
            throw new SidflowConfigError(`Config key \"${String(key)}\" must be a non-empty string`);
        }
        return path.normalize(raw);
    };
    const requiredNumber = (key, predicate) => {
        const raw = record[key];
        if (typeof raw !== "number" || Number.isNaN(raw)) {
            throw new SidflowConfigError(`Config key \"${String(key)}\" must be a number`);
        }
        if (!predicate(raw)) {
            throw new SidflowConfigError(`Config key \"${String(key)}\" failed validation`);
        }
        return raw;
    };
    const optionalString = (key) => {
        const raw = record[key];
        if (raw === undefined) {
            return undefined;
        }
        if (typeof raw !== "string" || raw.trim() === "") {
            throw new SidflowConfigError(`Config key "${String(key)}" must be a non-empty string`);
        }
        return path.normalize(raw);
    };
    const parseRender = () => {
        const raw = record["render"];
        if (raw === undefined) return undefined;
        if (!raw || typeof raw !== "object") {
            throw new SidflowConfigError(`Config key "render" must be an object when provided`);
        }
        const r = raw;
        const allowedFormats = new Set(["wav", "m4a", "flac"]);
    const allowedEngines = new Set(["wasm", "sidplayfp-cli", "ultimate64"]);
        const allowedChips = new Set(["6581", "8580r5"]);

        // Optional output path (validate string if provided)
        let outputPath;
        if (r.outputPath !== undefined) {
            if (typeof r.outputPath !== "string" || r.outputPath.trim() === "") {
                throw new SidflowConfigError(`Config key "render.outputPath" must be a non-empty string`);
            }
            outputPath = path.normalize(r.outputPath);
        }

        // defaultFormats: if provided, must be non-empty array of allowed formats
        let defaultFormats;
        if (r.defaultFormats !== undefined) {
            if (!Array.isArray(r.defaultFormats) || r.defaultFormats.length === 0) {
                throw new SidflowConfigError(`Config key "render.defaultFormats" must be a non-empty array`);
            }
            defaultFormats = r.defaultFormats.map((f) => {
                if (typeof f !== "string" || !allowedFormats.has(f)) {
                    throw new SidflowConfigError(`Unsupported render format: ${String(f)}`);
                }
                return f;
            });
        }

        // preferredEngines: if provided, each must be allowed
        let preferredEngines;
        if (r.preferredEngines !== undefined) {
            if (!Array.isArray(r.preferredEngines) || r.preferredEngines.length === 0) {
                throw new SidflowConfigError(`Config key "render.preferredEngines" must be a non-empty array`);
            }
            preferredEngines = r.preferredEngines.map((e) => {
                if (typeof e !== "string" || !allowedEngines.has(e)) {
                    throw new SidflowConfigError(`Unsupported render engine: ${String(e)}`);
                }
                return e;
            });
        }

        // defaultChip: optional, must be allowed if provided
        let defaultChip;
        if (r.defaultChip !== undefined) {
            if (typeof r.defaultChip !== "string" || !allowedChips.has(r.defaultChip)) {
                throw new SidflowConfigError(`Unsupported default chip: ${String(r.defaultChip)}`);
            }
            defaultChip = r.defaultChip;
        }

        // ultimate64: optional object; if provided, must include host (non-empty string)
        let ultimate64;
        if (r.ultimate64 !== undefined) {
            const u = r.ultimate64;
            if (!u || typeof u !== "object") {
                throw new SidflowConfigError(`Config key "render.ultimate64" must be an object when provided`);
            }
            const host = u.host;
            if (typeof host !== "string" || host.trim() === "") {
                throw new SidflowConfigError(`Config key "render.ultimate64.host" must be a non-empty string`);
            }
            ultimate64 = {
                host: host,
                https: Boolean(u.https),
                password: typeof u.password === "string" && u.password.trim() !== "" ? u.password : undefined,
                audioPort: typeof u.audioPort === "number" && Number.isInteger(u.audioPort) && u.audioPort > 0
                    ? u.audioPort
                    : undefined,
                streamIp: typeof u.streamIp === "string" && u.streamIp.trim() !== "" ? u.streamIp : undefined
            };
        }

        return {
            outputPath: outputPath,
            defaultFormats,
            preferredEngines,
            defaultChip,
            ultimate64
        };
    };

    return {
        sidPath: requiredString("sidPath"),
        wavCachePath: requiredString("wavCachePath"),
        tagsPath: requiredString("tagsPath"),
        classifiedPath: optionalString("classifiedPath"),
        sidplayPath: optionalString("sidplayPath"),
        threads: requiredNumber("threads", (n) => Number.isInteger(n) && n >= 0),
        classificationDepth: requiredNumber("classificationDepth", (n) => Number.isInteger(n) && n > 0),
        render: parseRender()
    };
}
//# sourceMappingURL=config.js.map