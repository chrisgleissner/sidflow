import { POST } from "../packages/sidflow-web/app/api/rate/random/route";

async function main() {
  process.env.SIDFLOW_CONFIG = ".sidflow.test.json";
  const res = await POST();
  console.log("status", res.status);
  const body = await res.json();
  console.log("body", body);
}

main().catch((err) => {
  console.error("error", err);
  process.exit(1);
});
