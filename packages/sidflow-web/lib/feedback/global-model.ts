export interface GlobalModelManifest {
  modelVersion: string;
  featureStats?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  modelTopology?: Record<string, unknown> | null;
  weightSpecs?: Array<Record<string, unknown>> | null;
  weightData?: ArrayBuffer | null;
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  details?: string;
}

let manifestPromise: Promise<GlobalModelManifest> | null = null;

function decodeBase64ToArrayBuffer(encoded?: string | null): ArrayBuffer | null {
  if (!encoded) {
    return null;
  }
  if (typeof atob !== 'function') {
    return null;
  }
  const binary = atob(encoded);
  const buffer = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    buffer[index] = binary.charCodeAt(index);
  }
  return buffer.buffer;
}

export async function fetchGlobalModelManifest(): Promise<GlobalModelManifest> {
  if (!manifestPromise) {
    manifestPromise = (async () => {
      const response = await fetch('/api/model/latest', {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch global model manifest (${response.status})`);
      }
      const payload = (await response.json()) as ApiResponse<{
        modelVersion: string;
        featureStats?: Record<string, unknown> | null;
        metadata?: Record<string, unknown> | null;
        modelTopology?: Record<string, unknown> | null;
        weightSpecs?: Array<Record<string, unknown>> | null;
        weightDataBase64?: string | null;
      }>;
      if (!payload.success || !payload.data) {
        throw new Error(payload.error || 'Global model manifest unavailable');
      }
      return {
        modelVersion: payload.data.modelVersion,
        featureStats: payload.data.featureStats ?? null,
        metadata: payload.data.metadata ?? null,
        modelTopology: payload.data.modelTopology ?? null,
        weightSpecs: payload.data.weightSpecs ?? null,
        weightData: decodeBase64ToArrayBuffer(payload.data.weightDataBase64 ?? null),
      } satisfies GlobalModelManifest;
    })();
  }
  return manifestPromise;
}

export function resetGlobalModelManifestCache(): void {
  manifestPromise = null;
}
