import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

test("launcher accepts 24 hours and rejects larger or invalid budgets", () => {
  const launcher = readFileSync(new URL("../../../scripts/rom-audit/run-dual.sh", import.meta.url), "utf8");
  const expression = /budget_seconds=\$\(node -e '([^']+)'/.exec(launcher)?.[1];
  expect(expression).toBeDefined();
  const run = (hours: string) => spawnSync("node", ["-e", expression!, hours], { encoding: "utf8" });
  expect(run("24").stdout).toBe("86395");
  expect(run("12").stdout).toBe("43195");
  for (const invalid of ["24.001", "25", "0", "NaN", "Infinity"]) expect(run(invalid).status).not.toBe(0);
  const remaining = /remaining\(\)\{ node -e '([^']+)'/.exec(launcher)?.[1];
  expect(remaining).toBeDefined();
  const accepted = spawnSync("node", ["-e", remaining!, "24", String(Date.now()/1000)], {encoding:"utf8"});
  expect(accepted.status).toBe(0);
  expect(Number(accepted.stdout)).toBeGreaterThan(23.9);
  expect(spawnSync("node", ["-e", remaining!, "25", String(Date.now()/1000)]).status).not.toBe(0);
});
