import path from "node:path";

export const MANUAL_TAG_EXTENSION = ".sid.tags.json" as const;
export const METADATA_EXTENSION = ".sid.meta.json" as const;

function assertSidWithinHvsc(sidPath: string, sidFile: string): string {
  const relative = path.relative(sidPath, sidFile);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`SID file ${sidFile} is not within HVSC path ${sidPath}`);
  }
  return relative;
}

export function resolveRelativeSidPath(sidPath: string, sidFile: string): string {
  return assertSidWithinHvsc(sidPath, sidFile);
}

export function resolveManualTagPath(sidPath: string, tagsPath: string, sidFile: string): string {
  const relative = resolveRelativeSidPath(sidPath, sidFile);
  const directory = path.dirname(relative);
  const baseName = path.basename(sidFile, ".sid");
  const filename = `${baseName}${MANUAL_TAG_EXTENSION}`;
  return path.join(tagsPath, directory, filename);
}

export function resolveMetadataPath(sidPath: string, tagsPath: string, sidFile: string): string {
  const relative = resolveRelativeSidPath(sidPath, sidFile);
  const directory = path.dirname(relative);
  const baseName = path.basename(sidFile, ".sid");
  const filename = `${baseName}${METADATA_EXTENSION}`;
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
  const normalised = toPosixRelative(relativePath);
  return normalised.split("/").filter(Boolean);
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
  const replaced = relativePath.replace(/\\/g, "/");
  return replaced.replace(/\/+/g, "/");
}
