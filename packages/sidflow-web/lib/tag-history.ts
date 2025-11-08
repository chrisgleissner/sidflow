import path from 'node:path';
import { promises as fs } from 'node:fs';
import type { Dirent } from 'node:fs';
import { pathExists } from '@sidflow/common';

const TAG_EXTENSION = '.sid.tags.json';

export interface ManualRatingRecord {
  id: string;
  sidPath: string;
  relativePath: string;
  filename: string;
  ratings: {
    e?: number;
    m?: number;
    c?: number;
    p?: number;
  };
  timestamp?: string;
  tagPath: string;
}

interface ListRatingsOptions {
  tagsPath: string;
  hvscRoot: string;
  collectionRoot: string;
  query?: string;
  page: number;
  pageSize: number;
}

async function collectTagFiles(root: string): Promise<string[]> {
  const results: string[] = [];
  const stack: string[] = [root];

  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries: Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (!entry.name.endsWith(TAG_EXTENSION)) {
        continue;
      }
      results.push(fullPath);
    }
  }

  return results;
}

async function readJson(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as Record<string, unknown>;
  } catch (error) {
    console.warn('[tag-history] Failed to read rating file', filePath, error);
    return null;
  }
}

function resolveRelativeSidPath(tagsPath: string, filePath: string): string {
  const relative = path.relative(tagsPath, filePath);
  const withoutExtension = relative.replace(
    new RegExp(`${TAG_EXTENSION.replace('.', '\\.')}$`, 'i'),
    ''
  );
  const normalized = withoutExtension.replace(/\\/g, '/');
  return normalized.toLowerCase().endsWith('.sid') ? normalized : `${normalized}.sid`;
}

async function locateSidPath(
  hvscRoot: string,
  collectionRoot: string,
  relativePath: string
): Promise<string> {
  const hvscCandidate = path.join(hvscRoot, relativePath);
  if (await pathExists(hvscCandidate)) {
    return hvscCandidate;
  }
  const collectionCandidate = path.join(collectionRoot, relativePath);
  return collectionCandidate;
}

function stripHvscFolderPrefix(relativePath: string, hvscRoot: string): string {
  const hvscFolder = path.basename(hvscRoot);
  const normalized = relativePath.replace(/^\/+/, '');
  if (normalized.toLowerCase().startsWith(`${hvscFolder.toLowerCase()}/`)) {
    return normalized.slice(hvscFolder.length + 1);
  }
  return normalized;
}

export async function listManualRatings(options: ListRatingsOptions): Promise<{
  total: number;
  page: number;
  pageSize: number;
  items: ManualRatingRecord[];
}> {
  const { tagsPath, hvscRoot, collectionRoot, query, page, pageSize } = options;
  const normalizedQuery = query?.trim().toLowerCase() ?? '';
  const files = await collectTagFiles(tagsPath);

  const records: ManualRatingRecord[] = [];

  for (const filePath of files) {
    const payload = await readJson(filePath);
    if (!payload) {
      continue;
    }
    const relativePath = resolveRelativeSidPath(tagsPath, filePath);
    const relativeNormalized = relativePath.replace(/\\/g, '/');
    const relativeTrimmed = stripHvscFolderPrefix(relativeNormalized, hvscRoot);
    if (normalizedQuery.length > 0) {
      if (
        !relativeTrimmed.toLowerCase().includes(normalizedQuery) &&
        !path.basename(relativeTrimmed).toLowerCase().includes(normalizedQuery)
      ) {
        continue;
      }
    }
    const sidPath = await locateSidPath(hvscRoot, collectionRoot, relativeTrimmed);
    const entry: ManualRatingRecord = {
      id: filePath,
      sidPath,
      relativePath: relativeTrimmed,
      filename: path.basename(relativeTrimmed),
      ratings: {
        e: typeof payload.e === 'number' ? payload.e : undefined,
        m: typeof payload.m === 'number' ? payload.m : undefined,
        c: typeof payload.c === 'number' ? payload.c : undefined,
        p: typeof payload.p === 'number' ? payload.p : undefined,
      },
      timestamp: typeof payload.timestamp === 'string' ? payload.timestamp : undefined,
      tagPath: filePath,
    };
    records.push(entry);
  }

  records.sort((a, b) => {
    const aTime = a.timestamp ? Date.parse(a.timestamp) : 0;
    const bTime = b.timestamp ? Date.parse(b.timestamp) : 0;
    return bTime - aTime;
  });

  const total = records.length;
  const safePageSize = Math.max(1, Math.min(pageSize, 100));
  const totalPages = Math.max(1, Math.ceil(total / safePageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * safePageSize;
  const items = records.slice(start, start + safePageSize);

  return {
    total,
    page: safePage,
    pageSize: safePageSize,
    items,
  };
}
