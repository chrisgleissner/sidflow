import path from "node:path";

export const MANUAL_TAG_EXTENSION = ".sid.tags.json" as const;
export const METADATA_EXTENSION = ".sid.meta.json" as const;

function assertSidWithinHvsc(hvscPath: string, sidFile: string): string {
  const relative = path.relative(hvscPath, sidFile);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`SID file ${sidFile} is not within HVSC path ${hvscPath}`);
  }
  return relative;
}

export function resolveRelativeSidPath(hvscPath: string, sidFile: string): string {
  return assertSidWithinHvsc(hvscPath, sidFile);
}

export function resolveManualTagPath(hvscPath: string, tagsPath: string, sidFile: string): string {
  const relative = resolveRelativeSidPath(hvscPath, sidFile);
  const directory = path.dirname(relative);
  const filename = `${path.basename(sidFile)}${MANUAL_TAG_EXTENSION}`;
  return path.join(tagsPath, directory, filename);
}

export function resolveMetadataPath(hvscPath: string, tagsPath: string, sidFile: string): string {
  const relative = resolveRelativeSidPath(hvscPath, sidFile);
  const directory = path.dirname(relative);
  const filename = `${path.basename(sidFile)}${METADATA_EXTENSION}`;
  return path.join(tagsPath, directory, filename);
}

function determineFolderDepth(relativeSidPath: string, depth: number): number {
  const segments = splitPathSegments(relativeSidPath);
  if (segments.length <= 1) {
    return 0;
  }
  return Math.min(depth, segments.length - 1);
}

function splitPathSegments(relativePath: string): string[] {
  return relativePath.split(path.sep).filter(Boolean);
}

export function resolveAutoTagDirectory(
  tagsPath: string,
  relativeSidPath: string,
  depth: number
): string {
  const segments = splitPathSegments(relativeSidPath);
  const folderDepth = determineFolderDepth(relativeSidPath, depth);
  const directorySegments = segments.slice(0, folderDepth);
  return path.join(tagsPath, ...directorySegments);
}

export function resolveAutoTagFilePath(
  tagsPath: string,
  relativeSidPath: string,
  depth: number
): string {
  return path.join(resolveAutoTagDirectory(tagsPath, relativeSidPath, depth), "auto-tags.json");
}

export function resolveAutoTagKey(relativeSidPath: string, depth: number): string {
  const segments = splitPathSegments(relativeSidPath);
  const folderDepth = determineFolderDepth(relativeSidPath, depth);
  const remainder = segments.slice(folderDepth);
  if (remainder.length === 0 && segments.length > 0) {
    return segments[segments.length - 1];
  }
  return remainder.join("/");
}

export function toPosixRelative(relativePath: string): string {
  if (!relativePath) {
    return "";
  }
  return relativePath.split(path.sep).join("/");
}
