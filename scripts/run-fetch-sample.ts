import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import type { SidflowConfig } from "../packages/sidflow-common/src/config.js";

const TEMP_PREFIX = path.join(os.tmpdir(), "sidflow-fetch-sample-");

interface ArchiveFixture {
  baseDir: string;
  archivePath: string;
}

async function createHvscFixture(name: string, payload: Record<string, string>): Promise<ArchiveFixture> {
  const baseDir = await mkdtemp(`${TEMP_PREFIX}${name}-source-`);
  await Promise.all(
    Object.entries(payload).map(async ([relativePath, contents]) => {
      const absolutePath = path.join(baseDir, relativePath);
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, contents, "utf8");
    })
  );

  const archivePath = path.join(baseDir, `${name}.7z`);
  const command = Bun.spawnSync(["7z", "a", archivePath, "."], { cwd: baseDir, stdout: "pipe", stderr: "pipe" });
  if (command.exitCode !== 0) {
    throw new Error(`Failed to build ${name} archive: ${command.stderr.toString()}`);
  }

  return { baseDir, archivePath };
}

async function main(): Promise<void> {
  const working = await mkdtemp(`${TEMP_PREFIX}run-`);
  const hvscDir = path.join(working, "hvsc");
  const wavCache = path.join(working, "wav");
  const tagsPath = path.join(working, "tags");
  const versionPath = path.join(working, "hvsc-version.json");
  await Promise.all([mkdir(hvscDir, { recursive: true }), mkdir(wavCache, { recursive: true }), mkdir(tagsPath, { recursive: true })]);

  const baseArchive = await createHvscFixture("HVSC_01-all-of-them", {
    "C64Music/MUSICIANS/A/Alpha/first.sid": "dummy-sid-1"
  });

  const deltaArchive = await createHvscFixture("HVSC_Update_01", {
    "C64Music/MUSICIANS/A/Alpha/second.sid": "dummy-sid-2"
  });

  const manifestHtml = `
<html>
  <body>
    <a href="${path.basename(baseArchive.archivePath)}">${path.basename(baseArchive.archivePath)}</a>
    <a href="${path.basename(deltaArchive.archivePath)}">${path.basename(deltaArchive.archivePath)}</a>
  </body>
</html>
`;

  const server = createServer((request, response) => {
    if (!request.url) {
      response.statusCode = 404;
      response.end();
      return;
    }

    const normalized = request.url.replace(/^\/+/, "");
    if (normalized === "") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(manifestHtml);
      return;
    }

    if (normalized === path.basename(baseArchive.archivePath)) {
      response.writeHead(200, { "content-type": "application/octet-stream" });
      createReadStream(baseArchive.archivePath).pipe(response);
      return;
    }

    if (normalized === path.basename(deltaArchive.archivePath)) {
      response.writeHead(200, { "content-type": "application/octet-stream" });
      createReadStream(deltaArchive.archivePath).pipe(response);
      return;
    }

    response.statusCode = 404;
    response.end();
  });

  try {
    await new Promise<void>((resolve) => {
      server.listen(0, resolve);
    });

    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Failed to determine server address");
    }

    const baseUrl = `http://127.0.0.1:${address.port}/`;

    const configPath = path.join(working, "sample.sidflow.json");
    const config: SidflowConfig = {
      hvscPath: hvscDir,
      wavCachePath: wavCache,
      tagsPath,
      sidplayPath: "sidplayfp",
      threads: 0,
      classificationDepth: 1
    };
    await writeFile(configPath, JSON.stringify(config), "utf8");

    const cli = Bun.spawn([
      path.join(".", "scripts", "sidflow-fetch"),
      "--config",
      configPath,
      "--remote",
      baseUrl,
      "--version-file",
      versionPath
    ], { stdout: "pipe", stderr: "pipe" });

    const exitCode = await cli.exited;
    const stdout = await new Response(cli.stdout).text();
    const stderr = await new Response(cli.stderr).text();

    if (exitCode !== 0) {
      throw new Error(`sample fetch failed\nstdout:\n${stdout}\nstderr:\n${stderr}`);
    }

    const version = JSON.parse(await readFile(versionPath, "utf8")) as {
      baseVersion: number;
      deltas: Array<{ version: number }>;
    };

    console.log("Sample fetch completed:");
    console.log(stdout.trim());
    console.log(`Recorded base version: ${version.baseVersion}`);
    console.log(`Applied deltas: ${version.deltas.map((delta) => delta.version).join(", ")}`);
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    await rm(working, { recursive: true, force: true });
    await rm(baseArchive.baseDir, { recursive: true, force: true });
    await rm(deltaArchive.baseDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
