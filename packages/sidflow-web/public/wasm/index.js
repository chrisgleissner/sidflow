import createLibsidplayfp from "./libsidplayfp.js";
const artifactBaseUrl = new URL("./", import.meta.url);
export async function loadLibsidplayfp(options = {}) {
    const locate = options.locateFile ?? ((asset) => new URL(asset, artifactBaseUrl).href);
    return await createLibsidplayfp({
        ...options,
        locateFile: locate
    });
}
export { SidAudioEngine } from "./player.js";
export default loadLibsidplayfp;
//# sourceMappingURL=index.js.map