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
    case "navigate": {
      // Type guard: step is now narrowed to NavigateStep
      const navStep = step;
      return `http.get(baseUrl + "${mapping.healthEndpoint}", params); // mirror page load for ${navStep.target}`;
    }
    case "click":
    case "waitForText":
      return "// UI-only step; no protocol call";
    case "type": {
      // Type guard: step is now narrowed to TypeStep
      const typeStep = step;
      return `http.get(baseUrl + "${mapping.searchEndpoint}?q=${encodeURIComponent(typeStep.value)}", params);`;
    }
    case "selectTrack": {
      // Type guard: step is now narrowed to SelectTrackStep
      const selectStep = step;
      const selected = spec.data?.trackRefs?.[selectStep.trackRef];
      const path = selected?.sidPath ?? selectStep.trackRef;
      return [
        `const playRes = http.post(baseUrl + "${mapping.playEndpoint}", JSON.stringify({ sid_path: "${path}" }), params);`,
        `const playJson = playRes.json();`,
        `streamUrl = playJson && playJson.streamUrl ? playJson.streamUrl : streamUrl;`
      ].join("\n  ");
    }
    case "startPlayback":
      return `http.get(streamUrl || baseUrl + "${mapping.healthEndpoint}", params); // playback start`;
    case "favoriteToggle": {
      // Type guard: step is now narrowed to FavoriteToggleStep
      const favStep = step;
      return `http.${favStep.toggle === "remove" ? "del" : "post"}(baseUrl + "${mapping.favoritesEndpoint}", JSON.stringify({ sid_path: "${favStep.trackRef}" }), params);`;
    }
    default:
      return "// Unsupported action";
  }
}
