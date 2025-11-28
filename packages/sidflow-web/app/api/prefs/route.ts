import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { getWebPreferences, updateWebPreferences, type WebPreferences } from '@/lib/preferences-store';
import type { RenderTechnology } from '@sidflow/common';
import { resolveSidCollectionContext } from '@/lib/sid-collection';
import { getRepoRoot } from '@/lib/server-env';
import type { ApiResponse } from '@/lib/validation';
import { promises as fs } from 'node:fs';
import { readSidplayfpConfig, updateSidplayfpConfig } from '@/lib/sidplayfp-config';

interface PreferencesResponse {
  hvscRoot: string;
  defaultCollectionPath: string;
  activeCollectionPath: string;
  preferenceSource: 'default' | 'custom';
  preferences: Awaited<ReturnType<typeof getWebPreferences>>;
  sidplayfpConfig: Awaited<ReturnType<typeof readSidplayfpConfig>>;
}

function buildResponsePayload(
  context: Awaited<ReturnType<typeof resolveSidCollectionContext>>,
  preferences: Awaited<ReturnType<typeof getWebPreferences>>,
  configSnapshot: Awaited<ReturnType<typeof readSidplayfpConfig>>
): PreferencesResponse {
  return {
    hvscRoot: context.hvscRoot,
    defaultCollectionPath: context.defaultCollectionRoot,
    activeCollectionPath: context.collectionRoot,
    preferenceSource: context.preferenceSource,
    preferences,
    sidplayfpConfig: configSnapshot,
  };
}

export async function GET() {
  const context = await resolveSidCollectionContext();
  const preferences = await getWebPreferences();
  const configSnapshot = await readSidplayfpConfig();
  const response: ApiResponse<PreferencesResponse> = {
    success: true,
    data: buildResponsePayload(context, preferences, configSnapshot),
  };
  return NextResponse.json(response, { status: 200 });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const repoRoot = getRepoRoot();

    const normalizeDirectory = async (
      value: unknown,
      label: string
    ): Promise<string | null | undefined> => {
      if (value === undefined) {
        return undefined;
      }
      if (value === null) {
        return null;
      }
      if (typeof value !== 'string') {
        throw new Error(`${label} must be a string or null`);
      }
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        return null;
      }
      const targetPath = path.isAbsolute(trimmed)
        ? path.normalize(trimmed)
        : path.resolve(repoRoot, trimmed);
      const stats = await fs.stat(targetPath);
      if (!stats.isDirectory()) {
        throw new Error(`${label} must be a directory`);
      }
      return targetPath;
    };

    const normalizeFile = async (
      value: unknown,
      label: string
    ): Promise<string | null | undefined> => {
      if (value === undefined) {
        return undefined;
      }
      if (value === null) {
        return null;
      }
      if (typeof value !== 'string') {
        throw new Error(`${label} must be a string or null`);
      }
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        return null;
      }
      const targetPath = path.isAbsolute(trimmed)
        ? path.normalize(trimmed)
        : path.resolve(repoRoot, trimmed);
      const stats = await fs.stat(targetPath);
      if (!stats.isFile()) {
        throw new Error(`${label} must be a file`);
      }
      return targetPath;
    };

    const normalizedSidBasePath = await normalizeDirectory(body?.sidBasePath ?? undefined, 'sidBasePath');
    const normalizedKernalRomPath = await normalizeFile(body?.kernalRomPath ?? undefined, 'kernalRomPath');
    const normalizedBasicRomPath = await normalizeFile(body?.basicRomPath ?? undefined, 'basicRomPath');
    const normalizedChargenRomPath = await normalizeFile(body?.chargenRomPath ?? undefined, 'chargenRomPath');
    const allowedEngines: RenderTechnology[] = ['wasm', 'sidplayfp-cli', 'ultimate64'];
    const normalizeRenderEngine = (value: unknown): RenderTechnology | undefined => {
      if (value === undefined) {
        return undefined;
      }
      if (value === null) {
        // Null signals reset to default (wasm)
        return 'wasm';
      }
      if (typeof value !== 'string') {
        throw new Error('renderEngine must be a string or null');
      }
      const trimmed = value.trim();
      if (!allowedEngines.includes(trimmed as RenderTechnology)) {
        throw new Error(`Unsupported renderEngine: ${trimmed}`);
      }
      return trimmed as RenderTechnology;
    };
    const normalizedRenderEngine = normalizeRenderEngine(body?.renderEngine ?? undefined);
    const normalizePreferredEngines = (
      value: unknown
    ): RenderTechnology[] | null | undefined => {
      if (value === undefined) {
        return undefined;
      }
      if (value === null) {
        return null;
      }
      if (!Array.isArray(value)) {
        throw new Error('preferredEngines must be an array or null');
      }
      const deduped: RenderTechnology[] = [];
      const seen = new Set<RenderTechnology>();
      value.forEach((entry, index) => {
        if (typeof entry !== 'string') {
          throw new Error(`preferredEngines[${index}] must be a string`);
        }
        const trimmed = entry.trim();
        if (!allowedEngines.includes(trimmed as RenderTechnology)) {
          throw new Error(`Unsupported preferredEngines[${index}]: ${trimmed}`);
        }
        const casted = trimmed as RenderTechnology;
        if (!seen.has(casted)) {
          seen.add(casted);
          deduped.push(casted);
        }
      });
      if (deduped.length === 0) {
        throw new Error('preferredEngines cannot be empty; use null to reset to defaults');
      }
      return deduped;
    };
    const normalizedPreferredEngines = normalizePreferredEngines(body?.preferredEngines ?? undefined);
    const normalizeSidplayFlags = (value: unknown): string | null | undefined => {
      if (value === undefined) {
        return undefined;
      }
      if (value === null) {
        return null;
      }
      if (typeof value !== 'string') {
        throw new Error('sidplayfpCliFlags must be a string or null');
      }
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        return null;
      }
      return trimmed;
    };
    const normalizedSidplayFlags = normalizeSidplayFlags(body?.sidplayfpCliFlags ?? undefined);
    const normalizeDefaultFormats = (
      value: unknown
    ): string[] | null | undefined => {
      if (value === undefined) {
        return undefined;
      }
      if (value === null) {
        return null;
      }
      if (!Array.isArray(value)) {
        throw new Error('defaultFormats must be an array or null');
      }
      const allowedFormats = ['wav', 'flac', 'm4a'];
      const deduped: string[] = [];
      const seen = new Set<string>();
      value.forEach((entry, index) => {
        if (typeof entry !== 'string') {
          throw new Error(`defaultFormats[${index}] must be a string`);
        }
        const trimmed = entry.trim().toLowerCase();
        if (!allowedFormats.includes(trimmed)) {
          throw new Error(`Unsupported defaultFormats[${index}]: ${trimmed}`);
        }
        if (!seen.has(trimmed)) {
          seen.add(trimmed);
          deduped.push(trimmed);
        }
      });
      if (deduped.length === 0) {
        throw new Error('defaultFormats cannot be empty; use null to reset to defaults');
      }
      // Ensure wav is always first
      if (deduped.includes('wav')) {
        const filtered = deduped.filter(f => f !== 'wav');
        return ['wav', ...filtered];
      }
      return ['wav', ...deduped];
    };
    const normalizedDefaultFormats = normalizeDefaultFormats(body?.defaultFormats ?? undefined);

    if (
      normalizedSidBasePath === undefined &&
      normalizedKernalRomPath === undefined &&
      normalizedBasicRomPath === undefined &&
      normalizedChargenRomPath === undefined &&
      normalizedSidplayFlags === undefined &&
      normalizedRenderEngine === undefined &&
      normalizedPreferredEngines === undefined &&
      normalizedDefaultFormats === undefined
    ) {
      throw new Error('No preferences provided');
    }

    const preferenceUpdates: Partial<WebPreferences> = {};
    if (normalizedSidBasePath !== undefined) {
      preferenceUpdates.sidBasePath = normalizedSidBasePath;
    }
    if (normalizedKernalRomPath !== undefined) {
      preferenceUpdates.kernalRomPath = normalizedKernalRomPath;
    }
    if (normalizedBasicRomPath !== undefined) {
      preferenceUpdates.basicRomPath = normalizedBasicRomPath;
    }
    if (normalizedChargenRomPath !== undefined) {
      preferenceUpdates.chargenRomPath = normalizedChargenRomPath;
    }
    if (normalizedSidplayFlags !== undefined) {
      preferenceUpdates.sidplayfpCliFlags = normalizedSidplayFlags;
    }
    if (normalizedRenderEngine !== undefined) {
      preferenceUpdates.renderEngine = normalizedRenderEngine;
    }
    if (normalizedPreferredEngines !== undefined) {
      preferenceUpdates.preferredEngines = normalizedPreferredEngines;
    }
    if (normalizedDefaultFormats !== undefined) {
      preferenceUpdates.defaultFormats = normalizedDefaultFormats;
    }

    const romOverrides =
      normalizedKernalRomPath !== undefined ||
        normalizedBasicRomPath !== undefined ||
        normalizedChargenRomPath !== undefined
        ? {
          kernalRomPath: normalizedKernalRomPath ?? null,
          basicRomPath: normalizedBasicRomPath ?? null,
          chargenRomPath: normalizedChargenRomPath ?? null,
        }
        : null;

    const updatedPrefs = Object.keys(preferenceUpdates).length
      ? await updateWebPreferences(preferenceUpdates)
      : await getWebPreferences();

    const configSnapshot = romOverrides
      ? await updateSidplayfpConfig(romOverrides)
      : await readSidplayfpConfig();

    const context = await resolveSidCollectionContext();
    const response: ApiResponse<PreferencesResponse> = {
      success: true,
      data: buildResponsePayload(context, updatedPrefs, configSnapshot),
    };
    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    const response: ApiResponse = {
      success: false,
      error: 'Failed to update preferences',
      details: error instanceof Error ? error.message : String(error),
    };
    return NextResponse.json(response, { status: 400 });
  }
}
