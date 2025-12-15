import path from "node:path";
import { defaultK6Mapping, stepToK6Request } from "./action-map.js";
import { DEFAULT_PACING_SECONDS } from "./constants.js";
import { type JourneySpec } from "./types.js";

export interface K6Options {
  baseUrl: string;
  users: number;
  pacingSeconds?: number;
  /**
   * Number of full journey runs per VU.
   * This is intentionally "per-VU" so that scaling up VUs scales total work.
   */
  journeysPerVu?: number;
  strictThresholds?: boolean;
}

export function generateK6ScriptContent(spec: JourneySpec, options: K6Options): string {
  const pacingSeconds = spec.pacingSeconds ?? options.pacingSeconds ?? DEFAULT_PACING_SECONDS;
  const pacing = `${pacingSeconds}`;
  const journeysPerVu = options.journeysPerVu ?? 1;
  const thresholds = options.strictThresholds === false ? "{}" : '{ http_req_failed: ["rate<0.05"] }';

  const bodyLines = spec.steps
    .map((step) => stepToK6Request(step, spec, defaultK6Mapping))
    .map((line) => `  ${line}\n  sleep(${pacing});`)
    .join("\n");

  const trackSelection = Object.entries(spec.data?.trackRefs ?? {}).map(
    ([key, value]) => `  "${key}": ${JSON.stringify(value)}`
  );

  return [
    `import http from "k6/http";`,
    `import { sleep } from "k6";`,
    ``,
    `function logRequest(method, url, res) {`,
    `  const status = res.status;`,
    `  const ok = status >= 200 && status < 300;`,
    `  const level = ok ? "info" : "error";`,
    `  const bodyPreview = typeof res.body === "string" ? res.body.substring(0, 200) : JSON.stringify(res.body).substring(0, 200);`,
    `  console.log(\`[k6 \${level}] \${method} \${url} -> \${status} | body: \${bodyPreview}\`);`,
    `  if (!ok) {`,
    `    console.error(\`[k6 error details] Full response body: \${res.body}\`);`,
    `  }`,
    `  return res;`,
    `}`,
    ``,
    `function safeJson(res) {`,
    `  if (!res) return null;`,
    `  // k6 throws if the response body is null (common when status=0 due to network errors)`,
    `  // so be defensive and return null instead of aborting the whole VU iteration.`,
    `  try {`,
    `    return res.json();`,
    `  } catch (err) {`,
    `    return null;`,
    `  }`,
    `}`,
    ``,
    `function postJsonWithRetries(url, payload, params, attempts) {`,
    `  let lastRes = null;`,
    `  const maxAttempts = attempts && attempts > 0 ? attempts : 1;`,
    `  for (let i = 0; i < maxAttempts; i++) {`,
    `    const res = http.post(url, JSON.stringify(payload), params);`,
    `    lastRes = logRequest("POST", url, res);`,
    `    // Treat only 2xx + non-empty body as success for JSON parsing.`,
    `    if (res && res.status >= 200 && res.status < 300 && res.body) {`,
    `      return res;`,
    `    }`,
    `    // Backoff to avoid thundering herd on transient resets under load.`,
    `    sleep(0.2 * (i + 1));`,
    `  }`,
    `  return lastRes;`,
    `}`,
    ``,
    `export const options = {`,
    `  // Ensure exported summaries include p(99) for regression detection.`,
    `  summaryTrendStats: ["avg", "min", "med", "max", "p(90)", "p(95)", "p(99)"],`,
    `  scenarios: {`,
    `    default: {`,
    `      executor: "per-vu-iterations",`,
    `      vus: ${options.users},`,
    `      iterations: ${journeysPerVu},`,
    `      maxDuration: "${Math.max(1, journeysPerVu) * Math.max(1, spec.steps.length) * (pacingSeconds + 1)}s",`,
    `    },`,
    `  },`,
    `  thresholds: ${thresholds},`,
    `};`,
    ``,
    `const baseUrl = "${options.baseUrl}";`,
    `const pacingSeconds = ${pacing};`,
    `const trackRefs = {`,
    trackSelection.join(trackSelection.length ? ",\n" : ""),
    `};`,
    ``,
    `export default function () {`,
    `  const params = { headers: { "Content-Type": "application/json" } };`,
    `  let streamUrl = null;`,
    `  // Add a small jitter so all VUs don't POST /api/play at the exact same instant.`,
    `  sleep(Math.random() * 0.3);`,
    bodyLines || "  // No steps provided",
    `}`
  ].join("\n");
}

export function buildK6ScriptPath(
  tmpRoot: string,
  timestamp: string,
  journeyId: string,
  users: number
): string {
  return path.join(tmpRoot, timestamp, "k6", `${journeyId}-u${String(users).padStart(3, "0")}.js`);
}
