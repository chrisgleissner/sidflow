import { describe, expect, it } from "bun:test";
import path from "node:path";

import {
  resolveAutoTagDirectory,
  resolveAutoTagFilePath,
  resolveAutoTagKey,
  resolveManualTagPath,
  resolveMetadataPath,
  resolveRelativeSidPath,
  toPosixRelative
} from "@sidflow/common";

describe("tag path helpers", () => {
  const hvscPath = path.join("/repo", "hvsc");
  const tagsPath = path.join("/repo", "tags");

  it("computes relative sid paths", () => {
    const sidFile = path.join(hvscPath, "C64Music", "Authors", "Track.sid");
    expect(resolveRelativeSidPath(hvscPath, sidFile)).toBe(
      path.join("C64Music", "Authors", "Track.sid")
    );
  });

  it("throws when sid file is outside hvsc path", () => {
    expect(() => {
      resolveRelativeSidPath(hvscPath, path.join("/tmp", "song.sid"));
    }).toThrow("SID file");
  });

  it("resolves manual tag path mirroring hvsc layout", () => {
    const sidFile = path.join(hvscPath, "C64Music", "Authors", "Track.sid");
    expect(resolveManualTagPath(hvscPath, tagsPath, sidFile)).toBe(
      path.join(tagsPath, "C64Music", "Authors", "Track.sid.tags.json")
    );
  });

  it("resolves metadata path beside manual tags", () => {
    const sidFile = path.join(hvscPath, "Track.sid");
    expect(resolveMetadataPath(hvscPath, tagsPath, sidFile)).toBe(
      path.join(tagsPath, "Track.sid.meta.json")
    );
  });

  it("computes auto-tag directory using classification depth", () => {
    const relative = path.join("C64Music", "MUSICIANS", "B", "Berry", "Song.sid");
    expect(resolveAutoTagDirectory(tagsPath, relative, 3)).toBe(
      path.join(tagsPath, "C64Music", "MUSICIANS", "B")
    );
  });

  it("falls back to tags root when depth exceeds path segments", () => {
    const relative = "Song.sid";
    expect(resolveAutoTagDirectory(tagsPath, relative, 3)).toBe(tagsPath);
  });

  it("builds auto-tag file path", () => {
    const relative = path.join("dir", "Song.sid");
    expect(resolveAutoTagFilePath(tagsPath, relative, 1)).toBe(
      path.join(tagsPath, "dir", "auto-tags.json")
    );
  });

  it("computes auto-tag keys with POSIX separators", () => {
    const relative = path.join("C64Music", "MUSICIANS", "B", "Berry", "Song.sid");
    expect(resolveAutoTagKey(relative, 3)).toBe("Berry/Song.sid");
  });

  it("uses filename when there are no directory segments", () => {
    expect(resolveAutoTagKey("Song.sid", 3)).toBe("Song.sid");
  });

  it("normalises to posix separators", () => {
    const windowsStyle = "C64Music\\MUSICIANS\\B\\Berry\\Song.sid";
    expect(toPosixRelative(windowsStyle)).toBe("C64Music/MUSICIANS/B/Berry/Song.sid");
  });

  it("handles empty path in toPosixRelative", () => {
    expect(toPosixRelative("")).toBe("");
  });
});
