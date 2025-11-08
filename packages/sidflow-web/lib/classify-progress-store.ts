import type { ClassifyPhase, ClassifyProgressSnapshot } from '@/lib/types/classify-progress';

interface ThreadStatusInternal {
  id: number;
  currentFile?: string;
  status: 'idle' | 'working';
  updatedAt: number;
}

interface ProgressState extends ClassifyProgressSnapshot {
  perThread: ThreadStatusInternal[];
  startedAt: number;
}

const STALE_THREAD_MS = 5000;

let snapshot: ProgressState = createInitialSnapshot();
let stdoutBuffer = '';

function createInitialSnapshot(): ProgressState {
  return {
    phase: 'idle',
    totalFiles: 0,
    processedFiles: 0,
    renderedFiles: 0,
    skippedFiles: 0,
    percentComplete: 0,
    threads: 1,
    perThread: [{ id: 1, status: 'idle', updatedAt: Date.now() }],
    isActive: false,
    updatedAt: Date.now(),
    startedAt: Date.now(),
    message: undefined,
    error: undefined,
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
    updatedAt: Date.now(),
  }));
}

function updateThreadStatus(threadIndex: number, currentFile?: string) {
  const now = Date.now();
  snapshot.perThread = snapshot.perThread.map((thread, index) => {
    if (index === threadIndex && currentFile) {
      return {
        ...thread,
        currentFile,
        status: 'working',
        updatedAt: now,
      };
    }
    if (now - thread.updatedAt > STALE_THREAD_MS) {
      return {
        ...thread,
        status: 'idle',
        currentFile: undefined,
        updatedAt: now,
      };
    }
    return thread;
  });
}

export function beginClassifyProgress(initialThreads = 1) {
  snapshot = createInitialSnapshot();
  snapshot.isActive = true;
  snapshot.startedAt = Date.now();
  ensureThreads(initialThreads);
}

export function completeClassifyProgress(message?: string) {
  setPhase('completed');
  snapshot.isActive = false;
  if (message) {
    snapshot.message = message;
  }
}

export function failClassifyProgress(message: string) {
  setPhase('error');
  snapshot.isActive = false;
  snapshot.error = message;
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

  const threadMatch = line.match(/threads:\s*(\d+)/i);
  if (threadMatch) {
    ensureThreads(Number(threadMatch[1]) || 1);
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
    snapshot.percentComplete = Number(convertingMatch[4]);
    const currentFile = convertingMatch[5];
    if (currentFile) {
      const threadIndex = snapshot.processedFiles % snapshot.threads;
      updateThreadStatus(threadIndex, currentFile);
    }
    snapshot.updatedAt = Date.now();
    return;
  }

  const tagMatch = line.match(
    /\[(Metadata|Tagging)\]\s+(\d+)\/(\d+)\s+files.*\(([\d.]+)%\)(?:\s+-\s+(.*))?/i
  );
  if (tagMatch) {
    const phase = tagMatch[1].toLowerCase() === 'metadata' ? 'metadata' : 'tagging';
    setPhase(phase as ClassifyPhase);
    snapshot.processedFiles = Number(tagMatch[2]);
    snapshot.totalFiles = Number(tagMatch[3]);
    snapshot.percentComplete = Number(tagMatch[4]);
    const currentFile = tagMatch[5];
    if (currentFile) {
      const threadIndex = snapshot.processedFiles % snapshot.threads;
      updateThreadStatus(threadIndex, currentFile);
    }
    snapshot.updatedAt = Date.now();
  }
}

export function getClassifyProgressSnapshot(): ClassifyProgressSnapshot {
  return {
    phase: snapshot.phase,
    totalFiles: snapshot.totalFiles,
    processedFiles: snapshot.processedFiles,
    renderedFiles: snapshot.renderedFiles,
    skippedFiles: snapshot.skippedFiles,
    percentComplete: snapshot.percentComplete,
    threads: snapshot.threads,
    perThread: snapshot.perThread.map((thread) => ({ ...thread })),
    message: snapshot.message,
    error: snapshot.error,
    isActive: snapshot.isActive,
    updatedAt: snapshot.updatedAt,
  };
}
