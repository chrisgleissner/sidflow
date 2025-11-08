import path from 'node:path';
import { promises as fsp } from 'node:fs';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';

interface SonglengthsData {
  map: Map<string, string>;
  paths: string[];
  lengthByPath: Map<string, string>;
}

const songlengthsCache = new Map<string, Promise<SonglengthsData>>();
const lengthCache = new Map<string, string | null>();

export async function loadSonglengthsData(hvscPath: string): Promise<SonglengthsData> {
  if (songlengthsCache.has(hvscPath)) {
    return songlengthsCache.get(hvscPath)!;
  }

  const loader = (async () => {
    const candidates = [
      path.join(hvscPath, 'DOCUMENTS', 'Songlengths.md5'),
      path.join(hvscPath, 'C64Music', 'DOCUMENTS', 'Songlengths.md5'),
      path.join(hvscPath, 'update', 'DOCUMENTS', 'Songlengths.md5'),
    ];

    for (const candidate of candidates) {
      try {
        await fsp.access(candidate);
        const contents = await fsp.readFile(candidate, 'utf8');
        const map = new Map<string, string>();
        const paths: string[] = [];
        const lengthByPath = new Map<string, string>();
        let currentPath: string | null = null;
        const lines = contents.split(/\r?\n/);
        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line) {
            continue;
          }
          if (line.startsWith(';')) {
            const relative = line.slice(1).trim();
            if (relative.toLowerCase().endsWith('.sid')) {
              currentPath = relative.replace(/^\//, '');
            }
            continue;
          }
          if (line.startsWith('[')) {
            continue;
          }
          const match = line.match(/^([0-9a-fA-F]{32})=(.+)$/);
          if (match) {
            map.set(match[1].toLowerCase(), match[2].trim());
            if (currentPath) {
              paths.push(currentPath);
              lengthByPath.set(currentPath, match[2].trim());
              currentPath = null;
            }
          }
        }
        return { map, paths, lengthByPath };
      } catch {
        // try next candidate
      }
    }
    return { map: new Map<string, string>(), paths: [], lengthByPath: new Map() };
  })();

  songlengthsCache.set(hvscPath, loader);
  return loader;
}

async function computeFileMd5(filePath: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const hash = createHash('md5');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk as Buffer));
    stream.once('error', reject);
    stream.once('end', () => resolve(hash.digest('hex')));
  });
}

export async function lookupSongLength(
  filePath: string,
  hvscPath: string,
  musicRoot: string
): Promise<string | undefined> {
  if (lengthCache.has(filePath)) {
    return lengthCache.get(filePath) ?? undefined;
  }
  const { map, lengthByPath } = await loadSonglengthsData(hvscPath);
  const relativePosix = path.relative(musicRoot, filePath).split(path.sep).join('/');
  const fromCatalog = lengthByPath.get(relativePosix);
  if (fromCatalog) {
    lengthCache.set(filePath, fromCatalog);
    return fromCatalog;
  }
  if (map.size === 0) {
    lengthCache.set(filePath, null);
    return undefined;
  }
  try {
    const md5 = await computeFileMd5(filePath);
    const length = map.get(md5.toLowerCase());
    lengthCache.set(filePath, length ?? null);
    return length;
  } catch (error) {
    console.warn('[songlengths] Failed to compute MD5 for song length lookup', {
      filePath,
      error,
    });
    lengthCache.set(filePath, null);
    return undefined;
  }
}

export function clearSonglengthCaches(): void {
  songlengthsCache.clear();
  lengthCache.clear();
}
