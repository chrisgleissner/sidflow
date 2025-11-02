import type { SidflowLogger } from "@sidflow/common";

export interface HvscArchiveDescriptor {
  version: number;
  filename: string;
  url: string;
}

export interface HvscManifest {
  base: HvscArchiveDescriptor;
  deltas: HvscArchiveDescriptor[];
}

export interface HvscSyncDependencies {
  fetchManifest?: (baseUrl: string) => Promise<HvscManifest>;
  downloadArchive?: (descriptor: HvscArchiveDescriptor, destination: string) => Promise<void>;
  extractArchive?: (archivePath: string, destination: string) => Promise<void>;
  computeChecksum?: (archivePath: string) => Promise<string>;
  logger?: SidflowLogger;
  now?: () => Date;
}

export interface HvscSyncOptions {
  configPath?: string;
  hvscVersionPath?: string;
  remoteBaseUrl?: string;
  dependencies?: HvscSyncDependencies;
}

export interface HvscSyncResult {
  baseUpdated: boolean;
  appliedDeltas: number[];
}

export interface HvscVersionRecord {
  baseVersion: number;
  baseFilename: string;
  baseChecksum: string;
  baseAppliedAt: string;
  deltas: Array<{
    version: number;
    filename: string;
    checksum: string;
    appliedAt: string;
  }>;
  lastUpdated: string;
}
