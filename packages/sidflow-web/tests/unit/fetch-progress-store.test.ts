/**
 * Tests for fetch-progress-store.ts — the pure state-machine that tracks HVSC download/sync progress.
 */

import { describe, beforeEach, it, expect } from 'bun:test';
import {
  beginFetchTracking,
  completeFetchTracking,
  failFetchTracking,
  finalizeFetchOutput,
  getFetchProgressSnapshot,
  ingestFetchStderr,
  ingestFetchStdout,
  isFetchRunning,
  resetFetchTracking,
} from '@/lib/fetch-progress-store';

// Reset module-level state before every test
beforeEach(() => {
  resetFetchTracking();
});

// ─── isFetchRunning ───────────────────────────────────────────────────────────

describe('isFetchRunning', () => {
  it('returns false after reset', () => {
    expect(isFetchRunning()).toBe(false);
  });

  it('returns true after beginFetchTracking', () => {
    beginFetchTracking();
    expect(isFetchRunning()).toBe(true);
  });

  it('returns false after completeFetchTracking', () => {
    beginFetchTracking();
    completeFetchTracking();
    expect(isFetchRunning()).toBe(false);
  });

  it('returns false after failFetchTracking', () => {
    beginFetchTracking();
    failFetchTracking('something went wrong');
    expect(isFetchRunning()).toBe(false);
  });
});

// ─── beginFetchTracking ───────────────────────────────────────────────────────

describe('beginFetchTracking', () => {
  it('returns true on first call', () => {
    expect(beginFetchTracking()).toBe(true);
  });

  it('returns false if already running', () => {
    beginFetchTracking();
    expect(beginFetchTracking()).toBe(false);
  });

  it('sets isActive true', () => {
    beginFetchTracking();
    expect(getFetchProgressSnapshot().isActive).toBe(true);
  });

  it('sets phase to downloading', () => {
    beginFetchTracking();
    expect(getFetchProgressSnapshot().phase).toBe('downloading');
  });

  it('resets percent to 0', () => {
    beginFetchTracking();
    ingestFetchStdout('Downloading something: 50%\n');
    completeFetchTracking();
    resetFetchTracking();
    beginFetchTracking();
    expect(getFetchProgressSnapshot().percent).toBe(0);
  });
});

// ─── completeFetchTracking ────────────────────────────────────────────────────

describe('completeFetchTracking', () => {
  it('marks phase as completed and percent 100', () => {
    beginFetchTracking();
    completeFetchTracking();
    const snap = getFetchProgressSnapshot();
    expect(snap.phase).toBe('completed');
    expect(snap.percent).toBe(100);
    expect(snap.isActive).toBe(false);
  });

  it('flushes outstanding stdout buffer on completion', () => {
    beginFetchTracking();
    // push partial line without newline
    ingestFetchStdout('HVSC sync completed');
    completeFetchTracking();
    const snap = getFetchProgressSnapshot();
    // the flushed line should set phase to completed
    expect(snap.phase).toBe('completed');
  });
});

// ─── failFetchTracking ────────────────────────────────────────────────────────

describe('failFetchTracking', () => {
  it('marks phase as error', () => {
    beginFetchTracking();
    failFetchTracking('network error');
    const snap = getFetchProgressSnapshot();
    expect(snap.phase).toBe('error');
    expect(snap.error).toBe('network error');
    expect(snap.isActive).toBe(false);
  });

  it('preserves message in snapshot', () => {
    beginFetchTracking();
    failFetchTracking('timeout');
    expect(getFetchProgressSnapshot().message).toBe('timeout');
  });
});

// ─── resetFetchTracking ───────────────────────────────────────────────────────

describe('resetFetchTracking', () => {
  it('puts snapshot back to idle phase', () => {
    beginFetchTracking();
    ingestFetchStdout('Downloading HVSC: 55%\n');
    resetFetchTracking();
    const snap = getFetchProgressSnapshot();
    expect(snap.phase).toBe('idle');
    expect(snap.percent).toBe(0);
    expect(snap.isActive).toBe(false);
    expect(snap.logs).toHaveLength(0);
  });
});

// ─── getFetchProgressSnapshot (snapshot immutability) ────────────────────────

describe('getFetchProgressSnapshot', () => {
  it('returns a copy of the logs array so mutations do not bleed in', () => {
    beginFetchTracking();
    ingestFetchStdout('hello\n');
    const snap = getFetchProgressSnapshot();
    const originalLength = snap.logs.length;
    snap.logs.push('injected');
    expect(getFetchProgressSnapshot().logs).toHaveLength(originalLength);
  });
});

// ─── ingestFetchStdout — download percent regex ───────────────────────────────

describe('ingestFetchStdout download percent', () => {
  beforeEach(() => {
    beginFetchTracking();
  });

  it('updates percent on "Downloading <name>: <n>%" line', () => {
    ingestFetchStdout('Downloading HVSC.tar.gz: 42%\n');
    const snap = getFetchProgressSnapshot();
    expect(snap.percent).toBe(42);
    expect(snap.phase).toBe('downloading');
    expect(snap.filename).toBe('HVSC.tar.gz');
  });

  it('handles multiple download-percent lines and advances monotonically', () => {
    ingestFetchStdout('Downloading file.tar.gz: 10%\n');
    ingestFetchStdout('Downloading file.tar.gz: 20%\n');
    ingestFetchStdout('Downloading file.tar.gz: 80%\n');
    expect(getFetchProgressSnapshot().percent).toBe(80);
  });

  it('percent is taken from the download line value directly', () => {
    ingestFetchStdout('Downloading file.tar.gz: 70%\n');
    ingestFetchStdout('Downloading file.tar.gz: 80%\n');
    // The latest explicit percent from the download-percent line takes effect
    expect(getFetchProgressSnapshot().percent).toBe(80);
  });
});

// ─── ingestFetchStdout — "Downloading <name>" without percent ──────────────────

describe('ingestFetchStdout downloading without percent', () => {
  beforeEach(() => {
    beginFetchTracking();
  });

  it('enters downloading phase on plain "Downloading <name>" line', () => {
    ingestFetchStdout('Downloading HVSC-base-archive.tar.gz\n');
    const snap = getFetchProgressSnapshot();
    expect(snap.phase).toBe('downloading');
    expect(snap.filename).toBe('HVSC-base-archive.tar.gz');
  });
});

// ─── ingestFetchStdout — download complete ────────────────────────────────────

describe('ingestFetchStdout download complete', () => {
  beforeEach(() => {
    beginFetchTracking();
  });

  it('transitions to extracting phase on "Download complete:" line', () => {
    ingestFetchStdout('Download complete: HVSC-base-archive.tar.gz\n');
    const snap = getFetchProgressSnapshot();
    expect(snap.phase).toBe('extracting');
    expect(snap.percent).toBeGreaterThanOrEqual(80);
    expect(snap.filename).toBe('HVSC-base-archive.tar.gz');
  });
});

// ─── ingestFetchStdout — extracting ──────────────────────────────────────────

describe('ingestFetchStdout extracting', () => {
  beforeEach(() => {
    beginFetchTracking();
  });

  it('sets extracting phase on "Extracting <name>" line', () => {
    ingestFetchStdout('Extracting HVSC-base-archive.tar.gz\n');
    const snap = getFetchProgressSnapshot();
    expect(snap.phase).toBe('extracting');
    expect(snap.percent).toBeGreaterThanOrEqual(80);
  });

  it('sets extracting phase on generic "Extracting" line', () => {
    ingestFetchStdout('Extracting\n');
    expect(getFetchProgressSnapshot().phase).toBe('extracting');
  });

  it('"Extraction complete" transitions back to downloading for further sync', () => {
    ingestFetchStdout('Extraction complete\n');
    expect(getFetchProgressSnapshot().phase).toBe('downloading');
  });
});

// ─── ingestFetchStdout — HVSC sync completed ─────────────────────────────────

describe('ingestFetchStdout HVSC sync completed', () => {
  beforeEach(() => {
    beginFetchTracking();
  });

  it('transitions to completed phase', () => {
    ingestFetchStdout('HVSC sync completed\n');
    const snap = getFetchProgressSnapshot();
    expect(snap.phase).toBe('completed');
    expect(snap.percent).toBe(100);
  });
});

// ─── ingestFetchStdout — structured state lines ───────────────────────────────

describe('ingestFetchStdout structured state', () => {
  beforeEach(() => {
    beginFetchTracking();
  });

  it('handles "Syncing HVSC base archive v<n>"', () => {
    ingestFetchStdout('Syncing HVSC base archive v81\n');
    const snap = getFetchProgressSnapshot();
    expect(snap.phase).toBe('initializing');
    expect(snap.message).toContain('81');
  });

  it('handles "HVSC base archive already up to date"', () => {
    ingestFetchStdout('HVSC base archive already up to date\n');
    expect(getFetchProgressSnapshot().phase).toBe('initializing');
  });

  it('handles "Downloading base archive <name>"', () => {
    ingestFetchStdout('Downloading base archive HVSC-78.tar.gz\n');
    const snap = getFetchProgressSnapshot();
    expect(snap.phase).toBe('downloading');
    expect(snap.filename).toBe('HVSC-78.tar.gz');
  });

  it('handles "Downloading delta <name>"', () => {
    ingestFetchStdout('Downloading delta delta-81.tar.gz\n');
    const snap = getFetchProgressSnapshot();
    expect(snap.phase).toBe('downloading');
    expect(snap.filename).toBe('delta-81.tar.gz');
  });

  it('handles "Applying HVSC delta <name>"', () => {
    ingestFetchStdout('Applying HVSC delta delta-81.tar.gz\n');
    const snap = getFetchProgressSnapshot();
    expect(snap.phase).toBe('applying');
    expect(snap.percent).toBeGreaterThanOrEqual(60);
  });

  it('handles "Checking HVSC version" line', () => {
    ingestFetchStdout('Checking HVSC version\n');
    expect(getFetchProgressSnapshot().phase).toBe('initializing');
  });

  it('handles "HVSC metadata is missing" line', () => {
    ingestFetchStdout('HVSC metadata is missing\n');
    expect(getFetchProgressSnapshot().phase).toBe('initializing');
  });
});

// ─── ingestFetchStdout — multiple lines in one chunk ────────────────────────

describe('ingestFetchStdout multi-line chunk', () => {
  beforeEach(() => {
    beginFetchTracking();
  });

  it('processes all lines in a single chunk', () => {
    ingestFetchStdout(
      'Syncing HVSC base archive v80\nDownloading HVSC-80.tar.gz: 30%\nDownloading HVSC-80.tar.gz: 80%\n'
    );
    const snap = getFetchProgressSnapshot();
    expect(snap.percent).toBe(80);
    expect(snap.filename).toBe('HVSC-80.tar.gz');
  });

  it('accumulates partial lines and processes on next newline', () => {
    ingestFetchStdout('Downloading HVSC-80');
    expect(getFetchProgressSnapshot().percent).toBe(0); // not yet processed
    ingestFetchStdout('.tar.gz: 55%\n');
    expect(getFetchProgressSnapshot().percent).toBe(55);
  });
});

// ─── ingestFetchStdout — log lines capped at MAX_LOG_LINES ──────────────────

describe('ingestFetchStdout log limit', () => {
  beforeEach(() => {
    beginFetchTracking();
  });

  it('keeps at most 200 log lines', () => {
    for (let i = 0; i < 250; i++) {
      ingestFetchStdout(`arbitrary line ${i}\n`);
    }
    expect(getFetchProgressSnapshot().logs.length).toBeLessThanOrEqual(200);
  });

  it('ignores empty lines (no log entry added)', () => {
    ingestFetchStdout('\n\n\n');
    expect(getFetchProgressSnapshot().logs).toHaveLength(0);
  });
});

// ─── ingestFetchStdout — [prefix] stripping ──────────────────────────────────

describe('ingestFetchStdout prefix stripping', () => {
  beforeEach(() => {
    beginFetchTracking();
  });

  it('strips [timestamp] prefix before processing', () => {
    ingestFetchStdout('[2024-01-01T00:00:00Z] Downloading file.tar.gz: 33%\n');
    const snap = getFetchProgressSnapshot();
    expect(snap.percent).toBe(33);
    expect(snap.filename).toBe('file.tar.gz');
  });
});

// ─── ingestFetchStderr ────────────────────────────────────────────────────────

describe('ingestFetchStderr', () => {
  beforeEach(() => {
    beginFetchTracking();
  });

  it('adds stderr lines with "stderr:" prefix to logs', () => {
    ingestFetchStderr('some warning message\n');
    const logs = getFetchProgressSnapshot().logs;
    expect(logs.some((l) => l.includes('stderr:'))).toBe(true);
  });

  it('accumulates partial stderr before newline', () => {
    ingestFetchStderr('warn');
    expect(getFetchProgressSnapshot().logs).toHaveLength(0);
    ingestFetchStderr('ing here\n');
    expect(getFetchProgressSnapshot().logs.length).toBeGreaterThan(0);
  });
});

// ─── finalizeFetchOutput ─────────────────────────────────────────────────────

describe('finalizeFetchOutput', () => {
  beforeEach(() => {
    beginFetchTracking();
  });

  it('flushes buffered stdout without trailing newline', () => {
    ingestFetchStdout('HVSC sync completed'); // no newline
    finalizeFetchOutput();
    expect(getFetchProgressSnapshot().phase).toBe('completed');
  });

  it('flushes buffered stderr without trailing newline', () => {
    ingestFetchStderr('partial error'); // no newline
    finalizeFetchOutput();
    const logs = getFetchProgressSnapshot().logs;
    expect(logs.some((l) => l.includes('partial error'))).toBe(true);
  });
});
