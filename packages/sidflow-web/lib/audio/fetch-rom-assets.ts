import type { PlaybackSessionDescriptor, SessionRomUrls } from '@/lib/types/playback-session';

export interface RomAssetMap {
    kernal: Uint8Array | null;
    basic: Uint8Array | null;
    chargen: Uint8Array | null;
}

async function fetchRom(url: string, kind: keyof SessionRomUrls, signal?: AbortSignal): Promise<Uint8Array> {
    const response = await fetch(url, {
        method: 'GET',
        headers: {
            Accept: 'application/octet-stream',
        },
        signal,
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch ${kind.toUpperCase()} ROM (${response.status})`);
    }

    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
}

export async function fetchRomAssets(
    session: PlaybackSessionDescriptor,
    signal?: AbortSignal
): Promise<RomAssetMap> {
    const urls = session.romUrls ?? {};
    const roms: RomAssetMap = {
        kernal: null,
        basic: null,
        chargen: null,
    };

    const tasks: Array<Promise<void>> = [];

    for (const kind of ['kernal', 'basic', 'chargen'] as const) {
        const url = urls[kind];
        if (!url) {
            continue;
        }
        tasks.push(
            fetchRom(url, kind, signal)
                .then((data) => {
                    roms[kind] = data;
                })
        );
    }

    await Promise.all(tasks);

    return roms;
}
