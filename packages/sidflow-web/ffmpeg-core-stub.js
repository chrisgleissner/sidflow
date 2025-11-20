/**
 * Minimal stub used during production test builds to avoid bundling heavy ffmpeg assets.
 * These functions should never be invoked during e2e tests; if they are, throw loudly.
 */
export function createFFmpeg() {
  throw new Error('ffmpeg.wasm is disabled for test builds');
}

export async function fetchFile() {
  throw new Error('ffmpeg fetchFile is disabled for test builds');
}

const placeholder = {
  createFFmpeg,
  fetchFile,
};

export default placeholder;
