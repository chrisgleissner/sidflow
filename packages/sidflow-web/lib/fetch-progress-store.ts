import type { FetchProgressSnapshot, FetchPhase } from '@/lib/types/fetch-progress';

const MAX_LOG_LINES = 200;
const STAGE_DEFAULT_PERCENT: Partial<Record<FetchPhase, number>> = {
  initializing: 5,
  downloading: 25,
  applying: 60,
  extracting: 80,
  completed: 100,
};

let snapshot: FetchProgressSnapshot = createInitialSnapshot();
let stdoutBuffer = '';
let stderrBuffer = '';
let isRunning = false;
let activeFilename: string | undefined;

function createInitialSnapshot(): FetchProgressSnapshot {
  return {
    phase: 'idle',
    percent: 0,
    message: 'Idle',
    updatedAt: Date.now(),
    logs: [],
    isActive: false,
  };
}

function updateSnapshot(partial: Partial<FetchProgressSnapshot>): void {
  snapshot = {
    ...snapshot,
    ...partial,
    updatedAt: Date.now(),
  };
}

function addLogLine(line: string): void {
  if (!line.trim()) {
    return;
  }
  const nextLogs = [...snapshot.logs, line];
  while (nextLogs.length > MAX_LOG_LINES) {
    nextLogs.shift();
  }
  snapshot = {
    ...snapshot,
    logs: nextLogs,
    updatedAt: Date.now(),
  };
}

function sanitizeLine(line: string): string {
  return line.replace(/^\[[^\]]+\]\s*/, '').trim();
}

function isTerminalPhase(phase: FetchPhase): boolean {
  return phase === 'error' || phase === 'completed' || phase === 'idle';
}

function setPhase(phase: FetchPhase, message: string, percentOverride?: number): void {
  const defaultPercent = STAGE_DEFAULT_PERCENT[phase];
  const nextPercent = percentOverride ?? defaultPercent ?? snapshot.percent;
  const clampedPercent = Math.max(snapshot.percent, Math.min(100, nextPercent));
  updateSnapshot({
    phase,
    message,
    percent: clampedPercent,
    isActive: !isTerminalPhase(phase),
  });
}

function processLine(rawLine: string): void {
  const line = sanitizeLine(rawLine);
  if (!line) {
    return;
  }

  addLogLine(line);

  if (handleStructuredState(line)) {
    return;
  }

  const downloadPercentMatch = line.match(/Downloading\s+(.+?):\s+(\d+)%/i);
  if (downloadPercentMatch) {
    const [, filename, percentStr] = downloadPercentMatch;
    activeFilename = filename.trim();
    const percent = Number(percentStr);
    setPhase('downloading', `Downloading ${activeFilename}`, percent);
    updateSnapshot({
      filename: activeFilename,
      percent,
    });
    return;
  }

  if (/^Downloading\s+/.test(line)) {
    activeFilename = line.replace(/^Downloading\s+/, '').trim();
    setPhase('downloading', `Downloading ${activeFilename}`, snapshot.percent || 25);
    updateSnapshot({ filename: activeFilename });
    return;
  }

  const downloadCompleteMatch = line.match(/Download complete:\s*(.+)/i);
  if (downloadCompleteMatch) {
    const [, filename] = downloadCompleteMatch;
    activeFilename = filename.trim();
    setPhase('extracting', `Extracting ${activeFilename}`, Math.max(snapshot.percent, 80));
    updateSnapshot({ filename: activeFilename });
    return;
  }

  if (/^Extracting/i.test(line)) {
    const extractingMatch = line.match(/Extracting\s+(.+)/i);
    if (extractingMatch) {
      activeFilename = extractingMatch[1].trim();
    }
    setPhase('extracting', `Extracting ${activeFilename ?? 'archive'}`, Math.max(snapshot.percent, 80));
    return;
  }

  if (/^Extraction complete/i.test(line)) {
    setPhase('downloading', 'Checking for additional updates', snapshot.percent);
    return;
  }

  if (/HVSC sync completed/i.test(line)) {
    setPhase('completed', 'HVSC sync completed', 100);
    return;
  }
}

function handleStructuredState(line: string): boolean {
  const baseSyncMatch = line.match(/Syncing HVSC base archive v(\d+)/i);
  if (baseSyncMatch) {
    setPhase('initializing', `Syncing HVSC base archive v${baseSyncMatch[1]}`, 5);
    return true;
  }

  if (/HVSC base archive already up to date/i.test(line)) {
    setPhase('initializing', 'Base archive already up to date', Math.max(snapshot.percent, 10));
    return true;
  }

  const downloadStartMatch = line.match(/Downloading (?:base archive|delta)\s+(.+)/i);
  if (downloadStartMatch) {
    activeFilename = downloadStartMatch[1].trim();
    const phase = downloadStartMatch[0].toLowerCase().includes('delta') ? 'downloading' : 'downloading';
    setPhase(phase, `Downloading ${activeFilename}`, Math.max(snapshot.percent, 25));
    updateSnapshot({ filename: activeFilename });
    return true;
  }

  const applyingDeltaMatch = line.match(/Applying HVSC delta\s+(.+)/i);
  if (applyingDeltaMatch) {
    const filename = applyingDeltaMatch[1].trim();
    setPhase('applying', `Applying delta ${filename}`, Math.max(snapshot.percent, 60));
    return true;
  }

  if (/Checking HVSC version/i.test(line)) {
    setPhase('initializing', 'Checking HVSC version', Math.max(snapshot.percent, 5));
    return true;
  }

  if (/HVSC metadata is missing/i.test(line)) {
    setPhase('initializing', line, Math.max(snapshot.percent, 5));
    return true;
  }

  return false;
}

export function beginFetchTracking(): boolean {
  if (isRunning) {
    return false;
  }
  isRunning = true;
  activeFilename = undefined;
  stdoutBuffer = '';
  stderrBuffer = '';
  snapshot = {
    phase: 'downloading',
    percent: 0,
    message: 'Preparing download...',
    filename: undefined,
    updatedAt: Date.now(),
    logs: [],
    isActive: true,
  };
  return true;
}

export function ingestFetchStdout(chunk: string): void {
  stdoutBuffer += chunk;
  let newlineIndex = stdoutBuffer.indexOf('\n');
  while (newlineIndex !== -1) {
    const line = stdoutBuffer.slice(0, newlineIndex).trimEnd();
    processLine(line);
    stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
    newlineIndex = stdoutBuffer.indexOf('\n');
  }
}

export function ingestFetchStderr(chunk: string): void {
  stderrBuffer += chunk;
  let newlineIndex = stderrBuffer.indexOf('\n');
  while (newlineIndex !== -1) {
    const line = stderrBuffer.slice(0, newlineIndex).trimEnd();
    addLogLine(`stderr: ${sanitizeLine(line) || line}`);
    stderrBuffer = stderrBuffer.slice(newlineIndex + 1);
    newlineIndex = stderrBuffer.indexOf('\n');
  }
}

export function finalizeFetchOutput(): void {
  if (stdoutBuffer.trim()) {
    processLine(stdoutBuffer.trim());
  }
  stdoutBuffer = '';

  if (stderrBuffer.trim()) {
    addLogLine(`stderr: ${stderrBuffer.trim()}`);
  }
  stderrBuffer = '';
}

export function completeFetchTracking(): void {
  finalizeFetchOutput();
  snapshot = {
    ...snapshot,
    phase: 'completed',
    message: 'HVSC sync completed successfully',
    percent: 100,
    isActive: false,
  };
  isRunning = false;
  activeFilename = undefined;
}

export function failFetchTracking(errorMessage: string): void {
  finalizeFetchOutput();
  snapshot = {
    ...snapshot,
    phase: 'error',
    message: errorMessage,
    error: errorMessage,
    isActive: false,
  };
  isRunning = false;
  activeFilename = undefined;
}

export function resetFetchTracking(): void {
  isRunning = false;
  activeFilename = undefined;
  stdoutBuffer = '';
  stderrBuffer = '';
  snapshot = createInitialSnapshot();
}

export function getFetchProgressSnapshot(): FetchProgressSnapshot {
  return {
    ...snapshot,
    logs: [...snapshot.logs],
  };
}

export function isFetchRunning(): boolean {
  return isRunning;
}
