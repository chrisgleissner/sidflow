import { describe, it, expect, beforeEach } from 'bun:test';
import {
  beginClassifyProgress,
  completeClassifyProgress,
  failClassifyProgress,
  pauseClassifyProgress,
  recordNoAudioEvent,
  checkGlobalStall,
  ingestClassifyStdout,
  getClassifyProgressSnapshot,
} from '../../lib/classify-progress-store';

describe('classify-progress-store', () => {
  beforeEach(() => {
    // Reset by starting a fresh session
    beginClassifyProgress(2, 'wasm');
  });

  describe('beginClassifyProgress', () => {
    it('initializes progress with correct thread count', () => {
      beginClassifyProgress(4, 'wasm → sidplayfp');
      const snapshot = getClassifyProgressSnapshot();
      expect(snapshot.threads).toBe(4);
      expect(snapshot.perThread.length).toBe(4);
      expect(snapshot.isActive).toBe(true);
      expect(snapshot.isPaused).toBe(false);
      expect(snapshot.phase).toBe('analyzing');
    });

    it('parses render engine preference correctly', () => {
      beginClassifyProgress(2, 'wasm → sidplayfp');
      const snapshot = getClassifyProgressSnapshot();
      expect(snapshot.renderEngine).toBe('wasm → sidplayfp');
      expect(snapshot.activeEngine).toBe('wasm');
    });

    it('initializes counters to zero', () => {
      const snapshot = getClassifyProgressSnapshot();
      expect(snapshot.counters).toBeDefined();
      expect(snapshot.counters!.analyzed).toBe(0);
      expect(snapshot.counters!.rendered).toBe(0);
      expect(snapshot.counters!.metadataExtracted).toBe(0);
      expect(snapshot.counters!.essentiaTagged).toBe(0);
      expect(snapshot.counters!.errors).toBe(0);
      expect(snapshot.counters!.retries).toBe(0);
    });
  });

  describe('completeClassifyProgress', () => {
    it('sets phase to completed and deactivates', () => {
      completeClassifyProgress('Done!');
      const snapshot = getClassifyProgressSnapshot();
      expect(snapshot.phase).toBe('completed');
      expect(snapshot.isActive).toBe(false);
      expect(snapshot.message).toBe('Done!');
    });
  });

  describe('failClassifyProgress', () => {
    it('sets phase to error and records message', () => {
      failClassifyProgress('Something went wrong');
      const snapshot = getClassifyProgressSnapshot();
      expect(snapshot.phase).toBe('error');
      expect(snapshot.isActive).toBe(false);
      expect(snapshot.error).toBe('Something went wrong');
    });
  });

  describe('pauseClassifyProgress', () => {
    it('sets phase to paused', () => {
      pauseClassifyProgress('User requested pause');
      const snapshot = getClassifyProgressSnapshot();
      expect(snapshot.phase).toBe('paused');
      expect(snapshot.isPaused).toBe(true);
      expect(snapshot.isActive).toBe(false);
      expect(snapshot.message).toBe('User requested pause');
    });
  });

  describe('recordNoAudioEvent', () => {
    it('increments noAudioStreak for the thread', () => {
      recordNoAudioEvent(1);
      recordNoAudioEvent(1);
      const snapshot = getClassifyProgressSnapshot();
      expect(snapshot.perThread[0].noAudioStreak).toBe(2);
    });

    it('ignores invalid thread IDs', () => {
      recordNoAudioEvent(0);
      recordNoAudioEvent(-1);
      recordNoAudioEvent(999);
      const snapshot = getClassifyProgressSnapshot();
      // No crash, threads should be unaffected
      expect(snapshot.perThread[0].noAudioStreak).toBe(0);
    });
  });

  describe('checkGlobalStall', () => {
    it('returns false when not active', () => {
      completeClassifyProgress();
      expect(checkGlobalStall()).toBe(false);
    });

    it('returns false when threads are not stale', () => {
      expect(checkGlobalStall()).toBe(false);
    });
  });

  describe('ingestClassifyStdout', () => {
    describe('thread count detection', () => {
      it('updates thread count from "threads: N" line', () => {
        ingestClassifyStdout('Starting with threads: 8\n');
        const snapshot = getClassifyProgressSnapshot();
        expect(snapshot.threads).toBe(8);
        expect(snapshot.perThread.length).toBe(8);
      });
    });

    describe('thread status updates', () => {
      it('parses old format [Thread X][PHASE][STATUS]', () => {
        ingestClassifyStdout('[Thread 1][BUILDING][WORKING] /path/to/file.sid\n');
        const snapshot = getClassifyProgressSnapshot();
        expect(snapshot.perThread[0].phase).toBe('building');
        expect(snapshot.perThread[0].status).toBe('working');
        expect(snapshot.perThread[0].currentFile).toBe('/path/to/file.sid');
      });

      it('parses new format [Thread X] Rendering: file', () => {
        ingestClassifyStdout('[Thread 1] Rendering: /path/to/file.sid\n');
        const snapshot = getClassifyProgressSnapshot();
        expect(snapshot.perThread[0].phase).toBe('building');
        expect(snapshot.perThread[0].status).toBe('working');
        expect(snapshot.perThread[0].currentFile).toBe('/path/to/file.sid');
      });

      it('parses analyzing action', () => {
        ingestClassifyStdout('[Thread 1] Analyzing: /path/to/file.sid\n');
        const snapshot = getClassifyProgressSnapshot();
        expect(snapshot.perThread[0].phase).toBe('analyzing');
      });

      it('parses reading metadata action', () => {
        ingestClassifyStdout('[Thread 1] Reading metadata: /path/to/file.sid\n');
        const snapshot = getClassifyProgressSnapshot();
        expect(snapshot.perThread[0].phase).toBe('metadata');
      });

      it('parses extracting features action', () => {
        ingestClassifyStdout('[Thread 1] Extracting features: /path/to/file.sid\n');
        const snapshot = getClassifyProgressSnapshot();
        expect(snapshot.perThread[0].phase).toBe('tagging');
      });

      it('handles IDLE status', () => {
        ingestClassifyStdout('[Thread 1][TAGGING][WORKING] /path/to/file.sid\n');
        ingestClassifyStdout('[Thread 1] IDLE\n');
        const snapshot = getClassifyProgressSnapshot();
        expect(snapshot.perThread[0].status).toBe('idle');
      });
    });

    describe('global progress updates', () => {
      it('parses analyzing progress line', () => {
        ingestClassifyStdout('[Analyzing] 50/100 files (50.0%)\n');
        const snapshot = getClassifyProgressSnapshot();
        expect(snapshot.phase).toBe('analyzing');
        expect(snapshot.processedFiles).toBe(50);
        expect(snapshot.totalFiles).toBe(100);
        expect(snapshot.percentComplete).toBe(50.0);
      });

      it('parses converting progress line', () => {
        ingestClassifyStdout('[Converting] 30 rendered / 20 cached / 50 remaining (30.0%)\n');
        const snapshot = getClassifyProgressSnapshot();
        expect(snapshot.phase).toBe('building');
        expect(snapshot.renderedFiles).toBe(30);
        expect(snapshot.skippedFiles).toBe(20);
      });

      it('parses metadata progress line', () => {
        ingestClassifyStdout('[Reading Metadata] 75/100 files (75.0%)\n');
        const snapshot = getClassifyProgressSnapshot();
        expect(snapshot.phase).toBe('metadata');
        expect(snapshot.processedFiles).toBe(75);
      });

      it('parses extracting features progress line', () => {
        ingestClassifyStdout('[Extracting Features] 80/100 files (80.0%)\n');
        const snapshot = getClassifyProgressSnapshot();
        expect(snapshot.phase).toBe('tagging');
        expect(snapshot.taggedFiles).toBe(80);
        expect(snapshot.counters!.essentiaTagged).toBe(80);
      });

      it('parses writing features progress line', () => {
        ingestClassifyStdout('[Writing Features] 90/100 files (90.0%)\n');
        const snapshot = getClassifyProgressSnapshot();
        expect(snapshot.phase).toBe('tagging');
      });
    });

    describe('structured log parsing', () => {
      it('parses Essentia extraction log line', () => {
        ingestClassifyStdout('[Thread 1] Extracted 12 features for test.sid in 150ms (Essentia: true)\n');
        const snapshot = getClassifyProgressSnapshot();
        expect(snapshot.counters!.essentiaTagged).toBe(1);
      });

      it('parses WAV render log line', () => {
        ingestClassifyStdout('[Thread 2] Rendered WAV for test.sid in 200ms\n');
        const snapshot = getClassifyProgressSnapshot();
        expect(snapshot.counters!.rendered).toBe(1);
      });

      it('accumulates multiple extractions', () => {
        ingestClassifyStdout('[Thread 1] Extracted 12 features for test1.sid in 150ms (Essentia: true)\n');
        ingestClassifyStdout('[Thread 2] Extracted 8 features for test2.sid in 100ms (Essentia: false)\n');
        const snapshot = getClassifyProgressSnapshot();
        expect(snapshot.counters!.essentiaTagged).toBe(2);
      });
    });

    describe('multiline handling', () => {
      it('handles multiple lines in a single chunk', () => {
        ingestClassifyStdout(
          '[Thread 1] Rendering: file1.sid\n' +
          '[Thread 2] Rendering: file2.sid\n'
        );
        const snapshot = getClassifyProgressSnapshot();
        expect(snapshot.perThread[0].currentFile).toBe('file1.sid');
        expect(snapshot.perThread[1].currentFile).toBe('file2.sid');
      });

      it('buffers incomplete lines across chunks', () => {
        ingestClassifyStdout('[Thread 1] Rendering: ');
        ingestClassifyStdout('longfile.sid\n');
        const snapshot = getClassifyProgressSnapshot();
        expect(snapshot.perThread[0].currentFile).toBe('longfile.sid');
      });
    });
  });

  describe('getClassifyProgressSnapshot', () => {
    it('returns a copy of the current state', () => {
      const snapshot1 = getClassifyProgressSnapshot();
      const snapshot2 = getClassifyProgressSnapshot();
      expect(snapshot1).not.toBe(snapshot2);
      expect(snapshot1.perThread).not.toBe(snapshot2.perThread);
      expect(snapshot1.counters).not.toBe(snapshot2.counters);
    });

    it('includes all required fields', () => {
      const snapshot = getClassifyProgressSnapshot();
      expect(snapshot).toHaveProperty('phase');
      expect(snapshot).toHaveProperty('totalFiles');
      expect(snapshot).toHaveProperty('processedFiles');
      expect(snapshot).toHaveProperty('renderedFiles');
      expect(snapshot).toHaveProperty('taggedFiles');
      expect(snapshot).toHaveProperty('skippedFiles');
      expect(snapshot).toHaveProperty('percentComplete');
      expect(snapshot).toHaveProperty('threads');
      expect(snapshot).toHaveProperty('perThread');
      expect(snapshot).toHaveProperty('isActive');
      expect(snapshot).toHaveProperty('isPaused');
      expect(snapshot).toHaveProperty('updatedAt');
      expect(snapshot).toHaveProperty('startedAt');
      expect(snapshot).toHaveProperty('counters');
    });
  });

  describe('edge cases', () => {
    it('handles carriage returns in stdout', () => {
      ingestClassifyStdout('[Thread 1] Rendering: file.sid\r\n');
      const snapshot = getClassifyProgressSnapshot();
      expect(snapshot.perThread[0].currentFile).toBe('file.sid');
    });

    it('ignores empty lines', () => {
      const before = getClassifyProgressSnapshot();
      ingestClassifyStdout('\n\n\n');
      const after = getClassifyProgressSnapshot();
      expect(after.updatedAt).toBe(before.updatedAt);
    });

    it('completeClassifyProgress sets taggedFiles to total when complete', () => {
      ingestClassifyStdout('[Analyzing] 100/100 files (100.0%)\n');
      completeClassifyProgress('All done');
      const snapshot = getClassifyProgressSnapshot();
      expect(snapshot.phase).toBe('completed');
      expect(snapshot.taggedFiles).toBe(100);
    });

    it('tracks phase transitions through thread updates', () => {
      // Start in analyzing
      ingestClassifyStdout('[Thread 1] Analyzing: file1.sid\n');
      let snapshot = getClassifyProgressSnapshot();
      expect(snapshot.perThread[0].phase).toBe('analyzing');
      
      // Transition to rendering
      ingestClassifyStdout('[Thread 1] Rendering: file1.sid\n');
      snapshot = getClassifyProgressSnapshot();
      expect(snapshot.perThread[0].phase).toBe('building');
      
      // Transition to extracting features
      ingestClassifyStdout('[Thread 1] Extracting features: file1.sid\n');
      snapshot = getClassifyProgressSnapshot();
      expect(snapshot.perThread[0].phase).toBe('tagging');
    });

    it('tracks rendered file count when transitioning from building to tagging', () => {
      beginClassifyProgress(1, 'wasm');
      ingestClassifyStdout('[Thread 1][BUILDING][WORKING] file1.sid\n');
      ingestClassifyStdout('[Thread 1][TAGGING][WORKING] file1.sid\n');
      const snapshot = getClassifyProgressSnapshot();
      // Transition from building to tagging should increment rendered count
      expect(snapshot.renderedFiles).toBeGreaterThanOrEqual(1);
    });
  });
});
