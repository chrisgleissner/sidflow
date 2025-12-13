import type { ClassifyPhase, ClassifyProgressSnapshot, ClassifyCounters } from '@/lib/types/classify-progress';

type ThreadPhase = 'analyzing' | 'building' | 'metadata' | 'tagging';

interface ThreadStatusInternal {
  id: number;
  currentFile?: string;
  status: 'idle' | 'working';
  phase?: ThreadPhase;
  updatedAt: number;
  stale: boolean;
  phaseStartedAt?: number;
  noAudioStreak?: number;
}

interface ProgressState extends Omit<ClassifyProgressSnapshot, 'perThread' | 'counters'> {
  perThread: ThreadStatusInternal[];
  counters: ClassifyCounters;
}

const STALE_THREAD_MS = 30000;  // 30 seconds - long enough for feature extraction (can take 10-30s)
const NO_AUDIO_STREAK_THRESHOLD = 3;
const GLOBAL_STALL_TIMEOUT_MS = 30000;

let snapshot: ProgressState = createInitialSnapshot();
let stdoutBuffer = '';

function createInitialCounters(): ClassifyCounters {
  return {
    analyzed: 0,
    rendered: 0,
    metadataExtracted: 0,
    essentiaTagged: 0,
    skipped: 0,
    errors: 0,
    retries: 0,
  };
}

function createInitialSnapshot(): ProgressState {
  return {
    phase: 'idle',
    totalFiles: 0,
    processedFiles: 0,
    renderedFiles: 0,
    taggedFiles: 0,
    cachedFiles: 0,
    skippedFiles: 0,
    extractedFiles: 0,
    percentComplete: 0,
    threads: 1,
    perThread: [{ id: 1, status: 'idle', phase: undefined, updatedAt: Date.now(), stale: false, phaseStartedAt: undefined, noAudioStreak: 0 }],
    isActive: false,
    isPaused: false,
    updatedAt: Date.now(),
    startedAt: Date.now(),
    message: undefined,
    error: undefined,
    counters: createInitialCounters(),
  };
}

function setPhase(phase: ClassifyPhase) {
  snapshot.phase = phase;
  snapshot.updatedAt = Date.now();
}

function ensureThreads(count: number) {
  if (count < 1) {
    count = 1;
  }
  if (snapshot.threads === count && snapshot.perThread.length === count) {
    return;
  }
  snapshot.threads = count;
  snapshot.perThread = Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    status: 'idle',
    phase: undefined,
    updatedAt: Date.now(),
    stale: false,
    phaseStartedAt: undefined,
    noAudioStreak: 0,
  }));
}

function applyThreadStatusUpdate(update: {
  threadId: number;
  phase?: ThreadPhase;
  status: 'idle' | 'working';
  file?: string;
}) {
  const index = update.threadId - 1;
  if (index < 0) {
    return;
  }
  ensureThreads(Math.max(update.threadId, snapshot.threads));
  const now = Date.now();
  const previousThread = snapshot.perThread[index];
  const transitionedFromRender =
    previousThread.phase === 'building' &&
    previousThread.status === 'working' &&
    previousThread.currentFile &&
    (update.phase === 'tagging' || update.status === 'idle');

  snapshot.perThread = snapshot.perThread.map((thread, idx) => {
    if (idx === index) {
      const isPhaseChange = update.phase && update.phase !== thread.phase;
      const isFileChange = update.file && update.file !== thread.currentFile;
      const isGoingIdle = update.status === 'idle';
      const shouldResetTimer = isPhaseChange || isFileChange || isGoingIdle;
      
      return {
        ...thread,
        status: update.status,
        phase: update.phase ?? thread.phase,
        currentFile: update.status === 'working' ? update.file ?? thread.currentFile : undefined,
        updatedAt: now,
        stale: false,
        phaseStartedAt: shouldResetTimer ? (update.status === 'working' ? now : undefined) : thread.phaseStartedAt,
      };
    }
    if (now - thread.updatedAt > STALE_THREAD_MS && thread.status === 'working' && !thread.stale) {
      return {
        ...thread,
        stale: true,
      };
    }
    return thread;
  });

  // Count inline renders when a thread moves from building -> tagging (or finishes)
  if (transitionedFromRender) {
    snapshot.renderedFiles += 1;
    snapshot.processedFiles = Math.max(snapshot.processedFiles, snapshot.renderedFiles);
    snapshot.updatedAt = now;
  }
}

export function beginClassifyProgress(threads: number, renderEngine?: string): void {
  snapshot = createInitialSnapshot();
  snapshot.phase = 'analyzing';
  snapshot.isActive = true;
  snapshot.isPaused = false;
  snapshot.startedAt = Date.now();
  snapshot.renderEngine = renderEngine;
  // Set active engine to the first preference (what's actually being used)
  snapshot.activeEngine = renderEngine?.split(' → ')[0];
  ensureThreads(threads);
}

export function completeClassifyProgress(message?: string) {
  setPhase('completed');
  snapshot.isActive = false;
  snapshot.isPaused = false;
  if (snapshot.totalFiles > 0) {
    snapshot.taggedFiles = Math.max(snapshot.taggedFiles, snapshot.totalFiles - snapshot.skippedFiles);
  }
  if (message) {
    snapshot.message = message;
  }
}

export function failClassifyProgress(message: string) {
  setPhase('error');
  snapshot.isActive = false;
  snapshot.isPaused = false;
  snapshot.error = message;
}

export function pauseClassifyProgress(message?: string) {
  setPhase('paused');
  snapshot.isActive = false;
  snapshot.isPaused = true;
  if (message) {
    snapshot.message = message;
  }
}

export function recordNoAudioEvent(threadId: number) {
  const index = threadId - 1;
  if (index < 0 || index >= snapshot.perThread.length) {
    return;
  }
  const thread = snapshot.perThread[index];
  const newStreak = (thread.noAudioStreak ?? 0) + 1;
  snapshot.perThread[index] = { ...thread, noAudioStreak: newStreak };
  
  console.log(`[engine-stall] Thread ${threadId}: no audio (streak: ${newStreak})`);
  
  if (newStreak >= NO_AUDIO_STREAK_THRESHOLD) {
    console.error(`[engine-escalate] Thread ${threadId}: ${newStreak} consecutive no-audio failures, consider switching engines`);
  }
}

export function checkGlobalStall(): boolean {
  if (!snapshot.isActive) {
    return false;
  }
  
  const now = Date.now();
  const allThreadsStale = snapshot.perThread.length > 0 && 
    snapshot.perThread.every(thread => now - thread.updatedAt > STALE_THREAD_MS);
  
  const noProgressSinceStart = now - snapshot.startedAt > GLOBAL_STALL_TIMEOUT_MS && 
    snapshot.processedFiles === 0;
  
  if (allThreadsStale || noProgressSinceStart) {
    console.error('[engine-stall] Global stall detected: all threads inactive or no progress');
    return true;
  }
  
  return false;
}

export function ingestClassifyStdout(chunk: string) {
  stdoutBuffer += chunk.replace(/\r/g, '\n');
  let newlineIndex = stdoutBuffer.indexOf('\n');
  while (newlineIndex !== -1) {
    const line = stdoutBuffer.slice(0, newlineIndex).trim();
    if (line) {
      processLine(line);
    }
    stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
    newlineIndex = stdoutBuffer.indexOf('\n');
  }
}

function processLine(line: string) {
  if (!line) {
    return;
  }

  // Log engine-related messages with structured tags
  if (line.match(/\b(Rendering|Extracting features|Writing Features|Writing Results|engine)\b/i)) {
    console.log(`[classify-engine] ${line}`);
  }

  // Detect no-audio events (worker exit code 0 with no audio output)
  const noAudioMatch = line.match(/\[Thread\s+(\d+)\].*no audio|exit code 0.*no output/i);
  if (noAudioMatch) {
    const threadId = Number(noAudioMatch[1]);
    if (!isNaN(threadId)) {
      recordNoAudioEvent(threadId);
    }
  }

  const threadMatch = line.match(/threads:\s*(\d+)/i);
  if (threadMatch) {
    ensureThreads(Number(threadMatch[1]) || 1);
    return;
  }

  // Match both old format [Thread X][PHASE][WORKING] and new format [Thread X] ACTION: file
  const threadStatusMatch = line.match(
    /\[Thread\s+(\d+)\]\[([A-Za-z]+)\]\[(WORKING|IDLE)\](?:\s+(.*))?/i
  );
  if (threadStatusMatch) {
    const threadId = Number(threadStatusMatch[1]);
    const phase = threadStatusMatch[2].toLowerCase() as ThreadPhase;
    const status = threadStatusMatch[3].toLowerCase() === 'working' ? 'working' : 'idle';
    const file = threadStatusMatch[4]?.trim();
    applyThreadStatusUpdate({
      threadId,
      phase,
      status,
      file: status === 'working' ? file : undefined,
    });
    return;
  }

  // Match new format: [Thread X] ACTION: file or [Thread X] IDLE
  const newThreadMatch = line.match(
    /\[Thread\s+(\d+)\]\s+(Analyzing|Rendering|Reading metadata|Extracting features|IDLE)(?::\s+(.*))?/i
  );
  if (newThreadMatch) {
    const threadId = Number(newThreadMatch[1]);
    const action = newThreadMatch[2].toLowerCase();
    const file = newThreadMatch[3]?.trim();
    
    let phase: ThreadPhase;
    let status: 'working' | 'idle';
    
    if (action === 'idle') {
      phase = 'tagging'; // Keep last known phase
      status = 'idle';
    } else {
      status = 'working';
      if (action === 'analyzing') {
        phase = 'analyzing';
      } else if (action === 'rendering') {
        phase = 'building';
      } else if (action === 'reading metadata') {
        phase = 'metadata';
      } else {
        phase = 'tagging'; // extracting features
      }
    }
    
    applyThreadStatusUpdate({
      threadId,
      phase,
      status,
      file: status === 'working' ? file : undefined,
    });
    return;
  }

  const analyzingMatch = line.match(/\[Analyzing\]\s+(\d+)\/(\d+)\s+files.*\(([\d.]+)%\)/i);
  if (analyzingMatch) {
    setPhase('analyzing');
    snapshot.processedFiles = Number(analyzingMatch[1]);
    snapshot.totalFiles = Number(analyzingMatch[2]);
    snapshot.percentComplete = Number(analyzingMatch[3]);
    snapshot.updatedAt = Date.now();
    return;
  }

  const convertingMatch = line.match(
    /\[Converting\].*?(\d+)\s+rendered.*?(\d+)\s+cached.*?(\d+)\s+remaining.*\(([\d.]+)%\)(?:\s+-\s+(.*))?/i
  );
  if (convertingMatch) {
    setPhase('building');
    const rendered = Number(convertingMatch[1]);
    const skipped = Number(convertingMatch[2]);
    const remaining = Number(convertingMatch[3]);
    const total = rendered + skipped + remaining || snapshot.totalFiles;
    snapshot.totalFiles = total;
    snapshot.renderedFiles = rendered;
    snapshot.skippedFiles = skipped;
    snapshot.processedFiles = rendered + skipped;
    snapshot.taggedFiles = Math.min(snapshot.taggedFiles, snapshot.processedFiles);
    snapshot.percentComplete = Number(convertingMatch[4]);
    snapshot.updatedAt = Date.now();
    return;
  }

  // Match new user-friendly progress labels with detailed counters
  // Format: [Phase] X/Y files, Z remaining (P%) [rendered=R cached=C extracted=E] - file - elapsed
  const tagMatch = line.match(
    /\[(Reading Metadata|Extracting Features|Writing Features|Metadata|Tagging)\]\s+(\d+)\/(\d+)\s+files.*\(([\d.]+)%\)(?:\s+\[rendered=(\d+)\s+cached=(\d+)\s+extracted=(\d+)\])?(?:\s+-\s+(.*))?/i
  );
  if (tagMatch) {
    const label = tagMatch[1].toLowerCase();
    let phase: ClassifyPhase;
    if (label === 'reading metadata' || label === 'metadata') {
      phase = 'metadata';
    } else if (label === 'extracting features' || label === 'tagging') {
      phase = 'tagging';
    } else {
      // 'writing features' - also map to tagging phase
      phase = 'tagging';
    }
    setPhase(phase);
    snapshot.processedFiles = Number(tagMatch[2]);
    snapshot.totalFiles = Number(tagMatch[3]);
    if (phase === 'tagging') {
      snapshot.taggedFiles = snapshot.processedFiles;
      snapshot.counters.essentiaTagged = snapshot.processedFiles;
    }
    snapshot.percentComplete = Number(tagMatch[4]);
    
    // Parse detailed counters if present
    if (tagMatch[5] !== undefined) {
      snapshot.renderedFiles = Number(tagMatch[5]);
    }
    if (tagMatch[6] !== undefined) {
      snapshot.cachedFiles = Number(tagMatch[6]);
    }
    if (tagMatch[7] !== undefined) {
      snapshot.extractedFiles = Number(tagMatch[7]);
    }
    
    snapshot.updatedAt = Date.now();
    return;
  }

  // Match Essentia feature extraction log format:
  // [Thread X] Extracted N features for file.sid in Xms (Essentia: true/false)
  const essentiaMatch = line.match(
    /\[Thread\s+(\d+)\]\s+Extracted\s+(\d+)\s+features\s+for\s+(.+?)\s+in\s+(\d+)ms\s+\(Essentia:\s*(true|false)\)/i
  );
  if (essentiaMatch) {
    const threadId = Number(essentiaMatch[1]);
    const featureCount = Number(essentiaMatch[2]);
    const file = essentiaMatch[3].trim();
    const durationMs = Number(essentiaMatch[4]);
    const usedEssentia = essentiaMatch[5].toLowerCase() === 'true';
    
    // Update counters
    snapshot.counters.essentiaTagged += 1;
    snapshot.updatedAt = Date.now();
    
    // Log for visibility
    console.log(`[classify-essentia] Thread ${threadId}: ${featureCount} features from ${file} in ${durationMs}ms (Essentia: ${usedEssentia})`);
    return;
  }

  // Match WAV render completion log:
  // [Thread X] Rendered WAV for file.sid in Xms
  const renderMatch = line.match(
    /\[Thread\s+(\d+)\]\s+Rendered\s+WAV\s+for\s+(.+?)\s+in\s+(\d+)ms/i
  );
  if (renderMatch) {
    const threadId = Number(renderMatch[1]);
    const file = renderMatch[2].trim();
    const durationMs = Number(renderMatch[3]);
    
    // Update counters
    snapshot.counters.rendered += 1;
    snapshot.updatedAt = Date.now();
    
    console.log(`[classify-render] Thread ${threadId}: rendered ${file} in ${durationMs}ms`);
    return;
  }
}

export function getClassifyProgressSnapshot(): ClassifyProgressSnapshot {
  return {
    phase: snapshot.phase,
    totalFiles: snapshot.totalFiles,
    processedFiles: snapshot.processedFiles,
    renderedFiles: snapshot.renderedFiles,
    taggedFiles: snapshot.taggedFiles,
    cachedFiles: snapshot.cachedFiles,
    skippedFiles: snapshot.skippedFiles,
    extractedFiles: snapshot.extractedFiles,
    percentComplete: snapshot.percentComplete,
    threads: snapshot.threads,
    perThread: snapshot.perThread.map((thread) => ({ ...thread })),
    renderEngine: snapshot.renderEngine,
    activeEngine: snapshot.activeEngine,
    message: snapshot.message,
    error: snapshot.error,
    isActive: snapshot.isActive,
    isPaused: snapshot.isPaused,
    updatedAt: snapshot.updatedAt,
    startedAt: snapshot.startedAt,
    counters: { ...snapshot.counters },
  };
}

/**
 * Self-heal progress state if the underlying runner is no longer active.
 *
 * In Playwright E2E runs we occasionally see the API request handler get interrupted
 * (e.g. worker retries) while the in-memory progress snapshot still reports `isActive=true`.
 * If the classify runner is no longer present, treat the run as idle to keep the UI/tests from
 * hanging on "wait for idle" polling.
 */
export function reconcileClassifyProgressWithRunner(runnerPid: number | null): void {
  if (snapshot.isActive && !snapshot.isPaused && runnerPid == null) {
    snapshot.isActive = false;
    snapshot.isPaused = false;
    snapshot.phase = 'idle';
    snapshot.updatedAt = Date.now();
    snapshot.message ??= 'Recovered stale classify progress state (runner not active)';
  }
}
