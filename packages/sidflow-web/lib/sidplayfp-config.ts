import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

const CONFIG_FILENAME = 'sidplayfp.ini';
const SECTION_NAME = 'SIDPlayfp';
const KEY_KERNAL = 'Kernal Rom';
const KEY_BASIC = 'Basic Rom';

export interface SidplayfpConfigSnapshot {
  path: string;
  exists: boolean;
  contents: string;
  kernalRomPath: string | null;
  basicRomPath: string | null;
}

interface ResolveResult {
  path: string;
  exists: boolean;
}

function unique<T>(values: T[]): T[] {
  const seen = new Set<T>();
  const result: T[] = [];
  for (const value of values) {
    if (value && !seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result;
}

function candidateConfigPaths(): string[] {
  const explicit = process.env.SIDPLAYFP_CONFIG_PATH;
  const home = os.homedir();
  const xdgConfig =
    process.env.XDG_CONFIG_HOME ?? (home ? path.join(home, '.config') : undefined);
  const xdgData =
    process.env.XDG_DATA_HOME ?? (home ? path.join(home, '.local', 'share') : undefined);

  const defaults = [
    explicit,
    xdgConfig ? path.join(xdgConfig, 'sidplayfp', CONFIG_FILENAME) : undefined,
    xdgData ? path.join(xdgData, 'sidplayfp', CONFIG_FILENAME) : undefined,
    home ? path.join(home, '.sidplayfp.ini') : undefined,
    path.join('/usr/local/share', 'sidplayfp', CONFIG_FILENAME),
    path.join('/usr/share', 'sidplayfp', CONFIG_FILENAME),
  ]
    .filter(Boolean)
    .map((candidate) => path.resolve(candidate as string));

  if (defaults.length === 0 && home) {
    defaults.push(path.join(home, '.config', 'sidplayfp', CONFIG_FILENAME));
  }

  return unique(defaults);
}

async function resolveConfigPath(): Promise<ResolveResult> {
  const candidates = candidateConfigPaths();
  for (const candidate of candidates) {
    try {
      const stats = await fs.stat(candidate);
      if (stats.isFile()) {
        return { path: candidate, exists: true };
      }
    } catch {
      // ignore and keep scanning
    }
  }
  const fallback = candidates[0] ?? path.join(os.tmpdir(), CONFIG_FILENAME);
  return { path: fallback, exists: false };
}

function extractRomPaths(contents: string): { kernalRomPath: string | null; basicRomPath: string | null } {
  const lines = contents.split(/\r?\n/);
  let currentSection = '';
  let kernalRomPath: string | null = null;
  let basicRomPath: string | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) {
      continue;
    }
    if (line.startsWith('[') && line.endsWith(']')) {
      currentSection = line.slice(1, -1).trim();
      continue;
    }
    if (currentSection !== SECTION_NAME) {
      continue;
    }
    const separator = rawLine.indexOf('=');
    if (separator === -1) {
      continue;
    }
    const key = rawLine.slice(0, separator).trim().toLowerCase();
    const value = rawLine.slice(separator + 1).trim();
    if (key === KEY_KERNAL.toLowerCase()) {
      kernalRomPath = value.length > 0 ? value : null;
    } else if (key === KEY_BASIC.toLowerCase()) {
      basicRomPath = value.length > 0 ? value : null;
    }
  }

  return { kernalRomPath, basicRomPath };
}

function ensureTrailingNewline(text: string): string {
  return text.endsWith('\n') ? text : `${text}\n`;
}

function setIniValue(
  lines: string[],
  key: string,
  value: string | null | undefined
): boolean {
  if (value === undefined) {
    return false;
  }

  const normalizedSection = SECTION_NAME.toLowerCase();
  const normalizedKey = key.toLowerCase();
  let currentSection = '';
  let sectionStart = -1;
  let sectionEnd = lines.length;
  let updated = false;

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      if (
        sectionStart !== -1 &&
        sectionEnd === lines.length &&
        currentSection.toLowerCase() === normalizedSection
      ) {
        sectionEnd = index;
      }
      currentSection = trimmed.slice(1, -1).trim();
      if (currentSection.toLowerCase() === normalizedSection) {
        sectionStart = index;
        sectionEnd = lines.length;
      }
      continue;
    }

    if (currentSection.toLowerCase() !== normalizedSection) {
      continue;
    }

    const separator = lines[index].indexOf('=');
    if (separator === -1) {
      continue;
    }
    const currentKey = lines[index].slice(0, separator).trim();
    if (currentKey.toLowerCase() !== normalizedKey) {
      continue;
    }

    if (value === null) {
      lines.splice(index, 1);
    } else {
      lines[index] = `${currentKey}=${value}`;
    }
    updated = true;
    return updated;
  }

  if (value === null) {
    return updated;
  }

  const insertion = `${key}=${value}`;
  if (sectionStart === -1) {
    if (lines.length > 0 && lines[lines.length - 1].trim() !== '') {
      lines.push('');
    }
    lines.push(`[${SECTION_NAME}]`);
    lines.push(insertion);
  } else {
    const insertIndex = sectionEnd === lines.length ? lines.length : sectionEnd;
    lines.splice(insertIndex, 0, insertion);
  }
  return true;
}

function applyRomOverrides(
  contents: string,
  overrides: { kernalRomPath?: string | null; basicRomPath?: string | null }
): { text: string; changed: boolean } {
  const lines = contents.length > 0 ? contents.split(/\r?\n/) : [];
  let changed = false;
  changed = setIniValue(lines, KEY_KERNAL, overrides.kernalRomPath) || changed;
  changed = setIniValue(lines, KEY_BASIC, overrides.basicRomPath) || changed;

  const joined = lines.join('\n').replace(/\s*$/, '');
  const text = ensureTrailingNewline(joined);
  return { text, changed };
}

export async function readSidplayfpConfig(): Promise<SidplayfpConfigSnapshot> {
  const { path: configPath, exists } = await resolveConfigPath();
  if (!exists) {
    return {
      path: configPath,
      exists: false,
      contents: '',
      kernalRomPath: null,
      basicRomPath: null,
    };
  }
  const contents = await fs.readFile(configPath, 'utf8');
  const roms = extractRomPaths(contents);
  return {
    path: configPath,
    exists: true,
    contents,
    ...roms,
  };
}

export async function updateSidplayfpConfig(
  overrides: { kernalRomPath?: string | null; basicRomPath?: string | null }
): Promise<SidplayfpConfigSnapshot> {
  const { path: configPath, exists } = await resolveConfigPath();
  const currentContents = exists ? await fs.readFile(configPath, 'utf8') : '';
  const { text, changed } = applyRomOverrides(currentContents, overrides);

  if (changed || !exists) {
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, text, 'utf8');
  }

  const roms = extractRomPaths(text);
  return {
    path: configPath,
    exists: true,
    contents: text,
    ...roms,
  };
}
