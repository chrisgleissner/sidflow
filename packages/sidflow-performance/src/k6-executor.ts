import path from "node:path";
import { defaultK6Mapping, stepToK6Request } from "./action-map.js";
import { DEFAULT_PACING_SECONDS } from "./constants.js";
import { type JourneySpec } from "./types.js";

export interface K6Options {
  baseUrl: string;
  users: number;
  pacingSeconds?: number;
  iterations?: number;
  strictThresholds?: boolean;
}

export function generateK6ScriptContent(spec: JourneySpec, options: K6Options): string {
  const pacingSeconds = spec.pacingSeconds ?? options.pacingSeconds ?? DEFAULT_PACING_SECONDS;
  const pacing = `${pacingSeconds}`;
  const iterations = options.iterations ?? spec.steps.length;
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
    `export const options = {`,
    `  vus: ${options.users},`,
    `  iterations: ${iterations},`,
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
    `  let streamUrl = baseUrl;`,
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
