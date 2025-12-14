import { type JourneyStep, type JourneySpec } from "./types.js";

export interface K6ActionMapping {
  searchEndpoint: string;
  playEndpoint: string;
  favoritesEndpoint: string;
}

export const defaultK6Mapping: K6ActionMapping = {
  searchEndpoint: "/api/search",
  playEndpoint: "/api/play",
  favoritesEndpoint: "/api/favorites"
};

export function stepToK6Request(
  step: JourneyStep,
  spec: JourneySpec,
  mapping: K6ActionMapping = defaultK6Mapping
): string {
  switch (step.action) {
    case "navigate":
      // TypeScript narrows step to NavigateStep within this case
      return `logRequest("GET", baseUrl + "${step.target}", http.get(baseUrl + "${step.target}", params));`;
    case "click":
    case "waitForText":
      return "// UI-only step; no protocol call";
    case "type":
      // TypeScript narrows step to TypeStep within this case
      return `logRequest("GET", baseUrl + "${mapping.searchEndpoint}?q=${encodeURIComponent(step.value)}", http.get(baseUrl + "${mapping.searchEndpoint}?q=${encodeURIComponent(step.value)}", params));`;
    case "selectTrack": {
      // TypeScript narrows step to SelectTrackStep within this case
      const selected = spec.data?.trackRefs?.[step.trackRef];
      const path = selected?.sidPath ?? step.trackRef;
      return [
        `const playRes = logRequest("POST", baseUrl + "${mapping.playEndpoint}", http.post(baseUrl + "${mapping.playEndpoint}", JSON.stringify({ sid_path: "${path}" }), params));`,
        `const playJson = playRes.json();`,
        `const session = playJson && playJson.data && playJson.data.session ? playJson.data.session : null;`,
        `const sidUrl = session && session.sidUrl ? (baseUrl + session.sidUrl) : null;`,
        `const wavUrl = session && session.streamUrls && session.streamUrls.wav && session.streamUrls.wav.url ? (baseUrl + session.streamUrls.wav.url) : null;`,
        `streamUrl = wavUrl || sidUrl || streamUrl;`
      ].join("\n  ");
    }
    case "startPlayback":
      return `logRequest("GET", streamUrl, http.get(streamUrl, { headers: { ...params.headers, Range: "bytes=0-1023" }, responseType: "none" })); // playback start (partial)`;
    case "favoriteToggle":
      // TypeScript narrows step to FavoriteToggleStep within this case
      return `logRequest("${step.toggle === "remove" ? "DELETE" : "POST"}", baseUrl + "${mapping.favoritesEndpoint}", http.${step.toggle === "remove" ? "del" : "post"}(baseUrl + "${mapping.favoritesEndpoint}", JSON.stringify({ sid_path: "${spec.data?.trackRefs?.[step.trackRef]?.sidPath ?? step.trackRef}" }), params));`;
    default:
      return "// Unsupported action";
  }
}
