import { type JourneyStep, type JourneySpec } from "./types.js";

export interface K6ActionMapping {
  searchEndpoint: string;
  playEndpoint: string;
  healthEndpoint: string;
  favoritesEndpoint: string;
}

export const defaultK6Mapping: K6ActionMapping = {
  searchEndpoint: "/api/search",
  playEndpoint: "/api/play",
  healthEndpoint: "/api/health",
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
      return `http.get(baseUrl + "${mapping.healthEndpoint}", params); // mirror page load for ${step.target}`;
    case "click":
    case "waitForText":
      return "// UI-only step; no protocol call";
    case "type":
      // TypeScript narrows step to TypeStep within this case
      return `http.get(baseUrl + "${mapping.searchEndpoint}?q=${encodeURIComponent(step.value)}", params);`;
    case "selectTrack": {
      // TypeScript narrows step to SelectTrackStep within this case
      const selected = spec.data?.trackRefs?.[step.trackRef];
      const path = selected?.sidPath ?? step.trackRef;
      return [
        `const playRes = http.post(baseUrl + "${mapping.playEndpoint}", JSON.stringify({ sid_path: "${path}" }), params);`,
        `const playJson = playRes.json();`,
        `streamUrl = playJson && playJson.streamUrl ? playJson.streamUrl : streamUrl;`
      ].join("\n  ");
    }
    case "startPlayback":
      return `http.get(streamUrl || baseUrl + "${mapping.healthEndpoint}", params); // playback start`;
    case "favoriteToggle":
      // TypeScript narrows step to FavoriteToggleStep within this case
      return `http.${step.toggle === "remove" ? "del" : "post"}(baseUrl + "${mapping.favoritesEndpoint}", JSON.stringify({ sid_path: "${step.trackRef}" }), params);`;
    default:
      return "// Unsupported action";
  }
}
