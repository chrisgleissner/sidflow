export interface RomManifestFile {
  fileName: string;
  size: number;
  sha256: string;
  modifiedAt: string;
}

export type SupportedChip = '6581' | '8580r5';

export interface RomManifestBundle {
  id: string;
  label: string;
  description?: string;
  defaultChip: SupportedChip;
  files: {
    basic: RomManifestFile;
    kernal: RomManifestFile;
    chargen: RomManifestFile;
  };
  kind: 'curated' | 'manual';
  updatedAt: string;
}

export interface RomManifest {
  version: string;
  generatedAt: string;
  bundles: RomManifestBundle[];
  allowManualSelection: boolean;
}

export interface RomValidationResult {
  bundleId: string;
  fileName: string;
  ok: boolean;
  reason?: string;
}
