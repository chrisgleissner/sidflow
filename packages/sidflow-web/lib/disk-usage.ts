import { statfs } from 'node:fs/promises';
import type { ClassifyStorageStats } from '@/lib/types/classify-progress';
import { resolveSidCollectionContext } from '@/lib/sid-collection';

export type DiskUsageStats = ClassifyStorageStats;

export async function getClassificationDiskUsage(): Promise<ClassifyStorageStats | null> {
  try {
    const context = await resolveSidCollectionContext();
    const hvscPath = context.collectionRoot;
    const stats = await statfs(hvscPath);
    const totalBytes = Number(stats.blocks) * Number(stats.bsize);
    const freeBytes = Number(stats.bavail) * Number(stats.bsize);
    const usedBytes = totalBytes - freeBytes;
    return {
      totalBytes,
      freeBytes,
      usedBytes,
    };
  } catch {
    return null;
  }
}
