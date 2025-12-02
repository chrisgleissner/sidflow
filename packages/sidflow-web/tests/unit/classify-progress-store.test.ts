import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  beginClassifyProgress,
  completeClassifyProgress,
  failClassifyProgress,
  getClassifyProgressSnapshot,
  ingestClassifyStdout,
  pauseClassifyProgress,
} from '../../lib/classify-progress-store';

describe('classify-progress-store', () => {
  beforeEach(() => {
    // Reset to a clean state
    beginClassifyProgress(4, 'wasm');
    completeClassifyProgress();
  });

  afterEach(() => {
    // Clean up
    completeClassifyProgress();
  });

  describe('beginClassifyProgress', () => {
    it('initializes with correct thread count and engine', () => {
      beginClassifyProgress(8, 'sidplayfp-cli → wasm');
      const snapshot = getClassifyProgressSnapshot();
      
      expect(snapshot.isActive).toBe(true);
      expect(snapshot.threads).toBe(8);
      expect(snapshot.perThread.length).toBe(8);
      expect(snapshot.renderEngine).toBe('sidplayfp-cli → wasm');
      expect(snapshot.activeEngine).toBe('sidplayfp-cli');
      expect(snapshot.phase).toBe('analyzing');
    });
  });

  describe('ingestClassifyStdout - thread status parsing', () => {
    beforeEach(() => {
      beginClassifyProgress(4, 'wasm');
    });

    it('parses thread rendering status', () => {
      ingestClassifyStdout('[Thread 1] Rendering: MUSICIANS/Hubbard_Rob/Delta.sid [1]\n');
      const snapshot = getClassifyProgressSnapshot();
      
      const thread = snapshot.perThread.find(t => t.id === 1);
      expect(thread?.status).toBe('working');
      expect(thread?.phase).toBe('building');
      expect(thread?.currentFile).toBe('MUSICIANS/Hubbard_Rob/Delta.sid [1]');
    });

    it('parses thread extracting features status', () => {
      ingestClassifyStdout('[Thread 2] Extracting features: MUSICIANS/Galway_Martin/Game_Over.sid [1]\n');
      const snapshot = getClassifyProgressSnapshot();
      
      const thread = snapshot.perThread.find(t => t.id === 2);
      expect(thread?.status).toBe('working');
      expect(thread?.phase).toBe('tagging');
      expect(thread?.currentFile).toBe('MUSICIANS/Galway_Martin/Game_Over.sid [1]');
    });

    it('parses thread analyzing status', () => {
      ingestClassifyStdout('[Thread 3] Analyzing: MUSICIANS/Daglish_Ben/Trap.sid\n');
      const snapshot = getClassifyProgressSnapshot();
      
      const thread = snapshot.perThread.find(t => t.id === 3);
      expect(thread?.status).toBe('working');
      expect(thread?.phase).toBe('analyzing');
      expect(thread?.currentFile).toBe('MUSICIANS/Daglish_Ben/Trap.sid');
    });

    it('parses thread reading metadata status', () => {
      ingestClassifyStdout('[Thread 4] Reading metadata: MUSICIANS/Tel_Jeroen/Cybernoid.sid\n');
      const snapshot = getClassifyProgressSnapshot();
      
      const thread = snapshot.perThread.find(t => t.id === 4);
      expect(thread?.status).toBe('working');
      expect(thread?.phase).toBe('metadata');
      expect(thread?.currentFile).toBe('MUSICIANS/Tel_Jeroen/Cybernoid.sid');
    });

    it('parses thread IDLE status', () => {
      // First set to working
      ingestClassifyStdout('[Thread 1] Rendering: test.sid\n');
      // Then set to idle
      ingestClassifyStdout('[Thread 1] IDLE\n');
      const snapshot = getClassifyProgressSnapshot();
      
      const thread = snapshot.perThread.find(t => t.id === 1);
      expect(thread?.status).toBe('idle');
      expect(thread?.currentFile).toBeUndefined();
    });

    it('tracks multiple threads independently', () => {
      ingestClassifyStdout('[Thread 1] Rendering: file1.sid\n');
      ingestClassifyStdout('[Thread 2] Extracting features: file2.sid\n');
      ingestClassifyStdout('[Thread 3] Analyzing: file3.sid\n');
      
      const snapshot = getClassifyProgressSnapshot();
      
      expect(snapshot.perThread.find(t => t.id === 1)?.phase).toBe('building');
      expect(snapshot.perThread.find(t => t.id === 2)?.phase).toBe('tagging');
      expect(snapshot.perThread.find(t => t.id === 3)?.phase).toBe('analyzing');
    });
  });

  describe('ingestClassifyStdout - progress counter parsing', () => {
    beforeEach(() => {
      beginClassifyProgress(4, 'wasm');
    });

    it('parses extracting features progress with detailed counters', () => {
      ingestClassifyStdout('[Extracting Features] 100/500 files, 400 remaining (20.0%) [rendered=50 cached=30 extracted=100] - test.sid - 1m 30s\n');
      const snapshot = getClassifyProgressSnapshot();
      
      expect(snapshot.phase).toBe('tagging');
      expect(snapshot.processedFiles).toBe(100);
      expect(snapshot.totalFiles).toBe(500);
      expect(snapshot.percentComplete).toBe(20.0);
      expect(snapshot.renderedFiles).toBe(50);
      expect(snapshot.cachedFiles).toBe(30);
      expect(snapshot.extractedFiles).toBe(100);
    });

    it('parses reading metadata progress', () => {
      ingestClassifyStdout('[Reading Metadata] 50/1000 files, 950 remaining (5.0%) [rendered=0 cached=0 extracted=0] - metadata.sid - 30s\n');
      const snapshot = getClassifyProgressSnapshot();
      
      expect(snapshot.phase).toBe('metadata');
      expect(snapshot.processedFiles).toBe(50);
      expect(snapshot.totalFiles).toBe(1000);
      expect(snapshot.percentComplete).toBe(5.0);
    });

    it('parses writing features progress', () => {
      ingestClassifyStdout('[Writing Features] 200/200 files, 0 remaining (100.0%) [rendered=100 cached=100 extracted=200] - final.sid - 5m 0s\n');
      const snapshot = getClassifyProgressSnapshot();
      
      expect(snapshot.phase).toBe('tagging');
      expect(snapshot.processedFiles).toBe(200);
      expect(snapshot.totalFiles).toBe(200);
      expect(snapshot.percentComplete).toBe(100.0);
      expect(snapshot.renderedFiles).toBe(100);
      expect(snapshot.cachedFiles).toBe(100);
      expect(snapshot.extractedFiles).toBe(200);
    });

    it('parses analyzing progress', () => {
      ingestClassifyStdout('[Analyzing] 25/100 files (25.0%)\n');
      const snapshot = getClassifyProgressSnapshot();
      
      expect(snapshot.phase).toBe('analyzing');
      expect(snapshot.processedFiles).toBe(25);
      expect(snapshot.totalFiles).toBe(100);
      expect(snapshot.percentComplete).toBe(25.0);
    });

    it('parses converting progress with rendered and cached counts', () => {
      ingestClassifyStdout('[Converting] 30 rendered, 70 cached, 100 remaining (50.0%)\n');
      const snapshot = getClassifyProgressSnapshot();
      
      expect(snapshot.phase).toBe('building');
      expect(snapshot.renderedFiles).toBe(30);
      expect(snapshot.skippedFiles).toBe(70);
      expect(snapshot.processedFiles).toBe(100);
    });
  });

  describe('thread status transitions', () => {
    beforeEach(() => {
      beginClassifyProgress(2, 'wasm');
    });

    it('shows thread transitioning from rendering to extracting features', () => {
      // Thread starts rendering
      ingestClassifyStdout('[Thread 1] Rendering: song.sid\n');
      let snapshot = getClassifyProgressSnapshot();
      expect(snapshot.perThread.find(t => t.id === 1)?.phase).toBe('building');
      
      // Thread finishes rendering and starts extracting
      ingestClassifyStdout('[Thread 1] Extracting features: song.sid\n');
      snapshot = getClassifyProgressSnapshot();
      expect(snapshot.perThread.find(t => t.id === 1)?.phase).toBe('tagging');
      
      // Thread goes idle before picking up next file
      ingestClassifyStdout('[Thread 1] IDLE\n');
      snapshot = getClassifyProgressSnapshot();
      expect(snapshot.perThread.find(t => t.id === 1)?.status).toBe('idle');
      
      // Thread starts rendering next file
      ingestClassifyStdout('[Thread 1] Rendering: song2.sid\n');
      snapshot = getClassifyProgressSnapshot();
      expect(snapshot.perThread.find(t => t.id === 1)?.phase).toBe('building');
      expect(snapshot.perThread.find(t => t.id === 1)?.currentFile).toBe('song2.sid');
    });

    it('shows multiple threads in different phases simultaneously', () => {
      ingestClassifyStdout('[Thread 1] Rendering: file1.sid\n');
      ingestClassifyStdout('[Thread 2] Extracting features: file2.sid\n');
      
      const snapshot = getClassifyProgressSnapshot();
      
      const thread1 = snapshot.perThread.find(t => t.id === 1);
      const thread2 = snapshot.perThread.find(t => t.id === 2);
      
      expect(thread1?.phase).toBe('building');
      expect(thread1?.currentFile).toBe('file1.sid');
      expect(thread2?.phase).toBe('tagging');
      expect(thread2?.currentFile).toBe('file2.sid');
    });
  });

  describe('lifecycle methods', () => {
    it('completeClassifyProgress marks as inactive', () => {
      beginClassifyProgress(4, 'wasm');
      completeClassifyProgress('Done');
      
      const snapshot = getClassifyProgressSnapshot();
      expect(snapshot.isActive).toBe(false);
      expect(snapshot.phase).toBe('completed');
      expect(snapshot.message).toBe('Done');
    });

    it('failClassifyProgress marks as error', () => {
      beginClassifyProgress(4, 'wasm');
      failClassifyProgress('Something went wrong');
      
      const snapshot = getClassifyProgressSnapshot();
      expect(snapshot.isActive).toBe(false);
      expect(snapshot.phase).toBe('error');
      expect(snapshot.error).toBe('Something went wrong');
    });

    it('pauseClassifyProgress marks as paused', () => {
      beginClassifyProgress(4, 'wasm');
      pauseClassifyProgress('User paused');
      
      const snapshot = getClassifyProgressSnapshot();
      expect(snapshot.isActive).toBe(false);
      expect(snapshot.isPaused).toBe(true);
      expect(snapshot.phase).toBe('paused');
      expect(snapshot.message).toBe('User paused');
    });
  });
});
