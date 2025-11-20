#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { cp, mkdir, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const webDir = path.join(repoRoot, 'packages', 'sidflow-web');
const timestamp = new Date().toISOString().replace(/[:]/g, '-').replace(/\..+/, '');
const outputDir = path.join(repoRoot, 'tmp', 'profiles', `e2e-profile-${timestamp}`);
const cpuDir = path.join(outputDir, 'cpuprofiles');
const pidstatLog = path.join(outputDir, 'pidstat.log');
const flamegraphPath = path.join(outputDir, 'flamegraph.html');
const cpuSummaryPath = path.join(outputDir, 'cpu-summary.txt');
const speedscopePackageDir = path.join(repoRoot, 'node_modules', 'speedscope');
const speedscopeReleaseDir = path.join(speedscopePackageDir, 'dist', 'release');

async function createFlamegraphArtifact(profilePath) {
  const targetDir = path.join(outputDir, 'speedscope');
  await rm(targetDir, { recursive: true, force: true });
  await cp(speedscopeReleaseDir, targetDir, { recursive: true });
  const profileData = await readFile(profilePath, 'base64');
  const profileScriptPath = path.join(targetDir, 'profile-data.js');
  const profileScript = `speedscope.loadFileFromBase64(${JSON.stringify(path.basename(profilePath))}, ${JSON.stringify(
    profileData
  )})`;
  await writeFile(profileScriptPath, profileScript, 'utf8');
  const redirectHtml = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>SIDFlow E2E Flamegraph</title>
    <meta http-equiv="refresh" content="0; url=./speedscope/index.html#localProfilePath=profile-data.js" />
  </head>
  <body>
    <p>Opening flamegraph... If it does not open automatically, copy this URL into your browser: <code>./speedscope/index.html#localProfilePath=profile-data.js</code></p>
  </body>
</html>`;
  await writeFile(flamegraphPath, redirectHtml, 'utf8');
}

function parseArgs() {
  const specs = [];
  const extraArgs = [];
  let grepPattern;
  let workers;

  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--spec' || arg === '--test') {
      const value = args[i + 1];
      if (!value) {
        throw new Error(`Missing value for ${arg}`);
      }
      specs.push(value);
      i += 1;
    } else if (arg === '--grep') {
      const value = args[i + 1];
      if (!value) {
        throw new Error('Missing value for --grep');
      }
      grepPattern = value;
      i += 1;
    } else if (arg === '--workers') {
      const value = args[i + 1];
      if (!value) {
        throw new Error('Missing value for --workers');
      }
      workers = value;
      i += 1;
    } else {
      extraArgs.push(arg);
    }
  }

  return { specs, grepPattern, workers, extraArgs };
}

function runCommand(cmd, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, options);
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (signal) {
        reject(new Error(`${cmd} terminated via ${signal}`));
      } else if (code !== 0) {
        reject(new Error(`${cmd} exited with code ${code}`));
      } else {
        resolve(undefined);
      }
    });
  });
}

async function generateCpuSummary(profilePath) {
  try {
    const raw = await readFile(profilePath, 'utf8');
    const profile = JSON.parse(raw);
    const idToName = new Map();
    for (const node of profile.nodes ?? []) {
      const frame = node.callFrame ?? {};
      const fn = frame.functionName && frame.functionName.length > 0 ? frame.functionName : '(anonymous)';
      const location = frame.url ? `${frame.url}:${frame.lineNumber ?? 0}` : 'unknown';
      idToName.set(node.id, `${fn} @ ${location}`);
    }
    const samples = profile.samples ?? [];
    const deltas = profile.timeDeltas ?? [];
    const totals = new Map();
    const sampleCount = samples.length;
    const defaultDelta = profile.timeDeltas && profile.timeDeltas.length > 0 ? 0 : 1000; // microseconds
    for (let i = 0; i < sampleCount; i += 1) {
      const nodeId = samples[i];
      const deltaUs = deltas[i] ?? defaultDelta;
      const deltaMs = deltaUs / 1000;
      totals.set(nodeId, (totals.get(nodeId) ?? 0) + deltaMs);
    }
    const sorted = Array.from(totals.entries())
      .map(([nodeId, ms]) => ({ name: idToName.get(nodeId) ?? `node ${nodeId}`, ms }))
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 25);
    const lines = [
      `CPU profile: ${profilePath}`,
      `Samples: ${sampleCount}`,
      `Duration (approx): ${sorted.reduce((sum, entry) => sum + entry.ms, 0).toFixed(2)} ms`,
      '',
      'Top 25 stacks:',
      ...sorted.map((entry) => `  ${entry.ms.toFixed(2)} ms — ${entry.name}`),
    ];
    await writeFile(cpuSummaryPath, lines.join('\n'), 'utf8');
  } catch (error) {
    await writeFile(cpuSummaryPath, `Failed to parse CPU profile: ${String(error)}`, 'utf8');
  }
}

async function main() {
  const { specs, grepPattern, workers, extraArgs } = parseArgs();
  await mkdir(cpuDir, { recursive: true });

  const playwrightArgs = [];
  if (workers) {
    playwrightArgs.push(`--workers=${workers}`);
  }
  if (grepPattern) {
    playwrightArgs.push('--grep', grepPattern);
  }
  if (specs.length > 0) {
    playwrightArgs.push(...specs);
  }
  if (extraArgs.length > 0) {
    playwrightArgs.push(...extraArgs);
  }
  const hasTimeoutOverride = playwrightArgs.some((arg, index, arr) => {
    if (arg.startsWith('--timeout')) {
      return true;
    }
    return index > 0 && arr[index - 1] === '--timeout';
  });
  if (!hasTimeoutOverride) {
    playwrightArgs.push('--timeout=60000');
  }

  const nodeOptions = `--cpu-prof --cpu-prof-dir=${cpuDir} --cpu-prof-name=sidflow-e2e`;
  const env = {
    ...process.env,
    SIDFLOW_WEB_SERVER_NODE_OPTIONS: nodeOptions,
  };

  console.log(`[profile:e2e] Output directory: ${outputDir}`);
  console.log(`[profile:e2e] CPU profiles: ${cpuDir}`);
  console.log(`[profile:e2e] pidstat log: ${pidstatLog}`);

  const pidstatStream = createWriteStream(pidstatLog);
  const pidstat = spawn('pidstat', ['-rud', '-p', 'ALL', '10'], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  pidstat.stdout.pipe(pidstatStream);

  let testError;
  try {
    await runCommand('npm', ['run', 'test:e2e', '--', ...playwrightArgs], {
      cwd: webDir,
      env,
      stdio: 'inherit',
    });
  } catch (error) {
    testError = error;
  } finally {
    pidstat.kill('SIGINT');
    await new Promise((resolve) => pidstat.once('close', resolve));
    pidstatStream.close();
  }

  const profileEntries = await readdir(cpuDir, { withFileTypes: true });
  const profileFiles = profileEntries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(cpuDir, entry.name));

  if (profileFiles.length > 0) {
    const flamegraphSource = profileFiles[0];
    await createFlamegraphArtifact(flamegraphSource);
    await generateCpuSummary(flamegraphSource);
  } else {
    await writeFile(cpuSummaryPath, 'No CPU profiles were generated.', 'utf8');
  }

  console.log('');
  console.log('Profiling artifacts:');
  console.log(`  pidstat log: ${pidstatLog}`);
  console.log(`  Flamegraph: ${flamegraphPath}`);
  console.log(`  CPU summary: ${cpuSummaryPath}`);
  console.log(`  Raw profiles: ${cpuDir}`);

  if (testError) {
    throw testError;
  }
}

main().catch((error) => {
  console.error('[profile:e2e] Failed:', error);
  process.exit(1);
});
