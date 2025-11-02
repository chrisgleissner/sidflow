import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
export const DEFAULT_CONFIG_FILENAME = ".sidflow.json";
let cachedConfig = null;
let cachedPath = null;
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
    return {
        hvscPath: requiredString("hvscPath"),
        wavCachePath: requiredString("wavCachePath"),
        tagsPath: requiredString("tagsPath"),
        sidplayPath: requiredString("sidplayPath"),
        threads: requiredNumber("threads", (n) => Number.isInteger(n) && n >= 0),
        classificationDepth: requiredNumber("classificationDepth", (n) => Number.isInteger(n) && n > 0)
    };
}
//# sourceMappingURL=config.js.map