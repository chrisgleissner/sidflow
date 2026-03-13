import { type ApiRequestStep, type JourneyStep, type JourneySpec } from "./types.js";

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
        `const playRes = postJsonWithRetries(baseUrl + "${mapping.playEndpoint}", { sid_path: "${path}" }, params, 3);`,
        `const playJson = safeJson(playRes);`,
        `const session = playJson && playJson.data && playJson.data.session ? playJson.data.session : null;`,
        `const sidUrl = session && session.sidUrl ? (baseUrl + session.sidUrl) : null;`,
        `const wavUrl = session && session.streamUrls && session.streamUrls.wav && session.streamUrls.wav.url ? (baseUrl + session.streamUrls.wav.url) : null;`,
        `streamUrl = wavUrl || sidUrl || streamUrl;`
      ].join("\n  ");
    }
    case "startPlayback":
      return [
        `if (streamUrl) {`,
        `  logRequest("GET", streamUrl, http.get(streamUrl, { headers: { "Content-Type": "application/json", "Range": "bytes=0-1023" }, responseType: "none" })); // playback start (partial)`,
        `} else {`,
        `  logRequest("GET", baseUrl + "/api/health", http.get(baseUrl + "/api/health", params)); // fallback`,
        `}`
      ].join("\n  ");
    case "favoriteToggle":
      // TypeScript narrows step to FavoriteToggleStep within this case
      return `logRequest("${step.toggle === "remove" ? "DELETE" : "POST"}", baseUrl + "${mapping.favoritesEndpoint}", http.${step.toggle === "remove" ? "del" : "post"}(baseUrl + "${mapping.favoritesEndpoint}", JSON.stringify({ sid_path: "${spec.data?.trackRefs?.[step.trackRef]?.sidPath ?? step.trackRef}" }), params));`;
    case "apiRequest": {
      const requestStep = step as ApiRequestStep;
      const method = requestStep.method ?? "GET";
      const serializedHeaders = JSON.stringify(requestStep.headers ?? {});
      const serializedBody = typeof requestStep.body === "string"
        ? JSON.stringify(requestStep.body)
        : JSON.stringify(requestStep.body ?? null);
      const expectedStatuses = Array.isArray(requestStep.expectedStatus)
        ? requestStep.expectedStatus
        : typeof requestStep.expectedStatus === "number"
          ? [requestStep.expectedStatus]
          : [];
      return [
        `const apiHeaders = { ...params.headers, ...${serializedHeaders} };`,
        requestStep.auth === "admin-basic"
          ? `if (__ENV.SIDFLOW_PERF_ADMIN_BASIC_AUTH) { apiHeaders.Authorization = "Basic " + __ENV.SIDFLOW_PERF_ADMIN_BASIC_AUTH; }`
          : "",
        `const apiBody = ${serializedBody};`,
        `const apiParams = { headers: apiHeaders };`,
        `const apiRes = logRequest(${JSON.stringify(method)}, baseUrl + ${JSON.stringify(requestStep.target)}, http.request(${JSON.stringify(method)}, baseUrl + ${JSON.stringify(requestStep.target)}, apiBody, apiParams));`,
        expectedStatuses.length > 0
          ? `if (!${JSON.stringify(expectedStatuses)}.includes(apiRes.status)) { console.error("[k6 unexpected status] expected=${expectedStatuses.join(",")} actual=" + apiRes.status); }`
          : ""
      ].filter(Boolean).join("\n  ");
    }
    default:
      return "// Unsupported action";
  }
}
