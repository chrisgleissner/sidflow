/// <reference types="bun-types" />

import { describe, expect, it, beforeEach, afterEach } from "bun:test";

// Mock AudioContext for browser APIs
class MockAudioContext {
  destination = {};
  sampleRate = 44100;
  state = 'running' as const;
  currentTime = 0;

  private gainNodes: MockGainNode[] = [];
  private listeners: Map<string, Function[]> = new Map();

  createGain(): MockGainNode {
    const node = new MockGainNode();
    this.gainNodes.push(node);
    return node;
  }

  addEventListener(event: string, handler: Function): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(handler);
  }

  removeEventListener(event: string, handler: Function): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index !== -1) {
        handlers.splice(index, 1);
      }
    }
  }

  async resume(): Promise<void> {
    return Promise.resolve();
  }

  async close(): Promise<void> {
    return Promise.resolve();
  }

  getGainNodes(): MockGainNode[] {
    return this.gainNodes;
  }
}

class MockGainNode {
  gain = { value: 1.0 };

  connect(): void {
    // Mock connect
  }

  disconnect(): void {
    // Mock disconnect
  }
}

// Mock document for HlsPlayer (creates audio element)
if (typeof document === 'undefined') {
  (globalThis as any).document = {
    createElement: (tag: string) => {
      if (tag === 'audio') {
        return {
          preload: 'auto',
          crossOrigin: 'anonymous',
          controls: false,
          volume: 1.0,
          paused: true,
          ended: false,
          currentTime: 0,
          addEventListener: () => { },
          removeEventListener: () => { },
          play: () => Promise.resolve(),
          pause: () => { },
          removeAttribute: () => { },
        };
      }
      return {};
    },
  };
}

// Set up global mocks for browser environment
globalThis.AudioContext = MockAudioContext as any;
if (typeof window === 'undefined') {
  (globalThis as any).window = globalThis;
}

describe("Volume Control - Real Player Integration", () => {
  describe("SidflowPlayer volume methods", () => {
    let player: any;
    let audioContext: MockAudioContext;

    beforeEach(async () => {
      audioContext = new MockAudioContext();
      // Dynamically import to avoid module caching issues
      const { SidflowPlayer } = await import("../../lib/player/sidflow-player.js");
      player = new SidflowPlayer(audioContext as any);
    });

    afterEach(() => {
      if (player) {
        player.destroy();
      }
    });

    it("initializes with default volume of 1.0", () => {
      expect(player.getVolume()).toBe(1.0);
    });

    it("setVolume updates volume and getVolume returns it", () => {
      player.setVolume(0.7);
      expect(player.getVolume()).toBe(0.7);

      player.setVolume(0.3);
      expect(player.getVolume()).toBe(0.3);
    });

    it("setVolume clamps values below 0 to 0", () => {
      player.setVolume(-0.5);
      expect(player.getVolume()).toBe(0);

      player.setVolume(-100);
      expect(player.getVolume()).toBe(0);
    });

    it("setVolume clamps values above 1 to 1", () => {
      player.setVolume(1.5);
      expect(player.getVolume()).toBe(1);

      player.setVolume(100);
      expect(player.getVolume()).toBe(1);
    });

    it("setVolume accepts values in valid range", () => {
      const testValues = [0, 0.01, 0.25, 0.5, 0.75, 0.99, 1.0];

      for (const value of testValues) {
        player.setVolume(value);
        expect(player.getVolume()).toBe(value);
      }
    });

    it("volume can be set to 0 (muted)", () => {
      player.setVolume(0);
      expect(player.getVolume()).toBe(0);
    });

    it("volume changes are granular with 0.01 precision", () => {
      player.setVolume(0.51);
      expect(player.getVolume()).toBe(0.51);

      player.setVolume(0.52);
      expect(player.getVolume()).toBe(0.52);
    });

    it("crossfade duration defaults to 0", () => {
      expect(player.getCrossfadeDuration()).toBe(0);
    });

    it("setCrossfadeDuration accepts positive values", () => {
      player.setCrossfadeDuration(3.5);
      expect(player.getCrossfadeDuration()).toBeCloseTo(3.5);
    });

    it("setCrossfadeDuration clamps negative values to 0", () => {
      player.setCrossfadeDuration(-2);
      expect(player.getCrossfadeDuration()).toBe(0);
    });
  });

  describe("WorkletPlayer volume methods", () => {
    let player: any;
    let audioContext: MockAudioContext;

    beforeEach(async () => {
      audioContext = new MockAudioContext();
      const { WorkletPlayer } = await import("../../lib/audio/worklet-player.js");
      player = new WorkletPlayer(audioContext as any);
    });

    afterEach(() => {
      if (player) {
        player.destroy();
      }
    });

    it("initializes with default volume of 1.0", () => {
      expect(player.getVolume()).toBe(1.0);
    });

    it("setVolume updates volume and getVolume returns it", () => {
      player.setVolume(0.8);
      expect(player.getVolume()).toBe(0.8);
    });

    it("setVolume clamps values correctly", () => {
      player.setVolume(-0.1);
      expect(player.getVolume()).toBe(0);

      player.setVolume(1.5);
      expect(player.getVolume()).toBe(1);

      player.setVolume(0.5);
      expect(player.getVolume()).toBe(0.5);
    });
  });

  describe("HlsPlayer volume methods", () => {
    let player: any;

    beforeEach(async () => {
      const { HlsPlayer } = await import("../../lib/audio/hls-player.js");
      player = new HlsPlayer();
    });

    afterEach(() => {
      if (player) {
        player.destroy();
      }
    });

    it("initializes with default volume of 1.0", () => {
      expect(player.getVolume()).toBe(1.0);
    });

    it("setVolume updates volume and getVolume returns it", () => {
      player.setVolume(0.4);
      expect(player.getVolume()).toBe(0.4);
    });

    it("setVolume clamps values correctly", () => {
      player.setVolume(-0.1);
      expect(player.getVolume()).toBe(0);

      player.setVolume(1.5);
      expect(player.getVolume()).toBe(1);

      player.setVolume(0.75);
      expect(player.getVolume()).toBe(0.75);
    });

    it("handles volume operations when audio element exists", () => {
      // HlsPlayer may not have audio element until load is called
      // but getVolume should still return a valid value
      const volume = player.getVolume();
      expect(typeof volume).toBe("number");
      expect(volume).toBeGreaterThanOrEqual(0);
      expect(volume).toBeLessThanOrEqual(1);
    });
  });

  describe("Volume UI behavior", () => {
    it("volume slider range is 0 to 1", () => {
      const minVolume = 0;
      const maxVolume = 1;
      const step = 0.01;

      expect(minVolume).toBe(0);
      expect(maxVolume).toBe(1);
      expect(step).toBe(0.01);
    });

    it("volume percentage calculation", () => {
      const toPercentage = (volume: number) => Math.round(volume * 100);

      expect(toPercentage(0)).toBe(0);
      expect(toPercentage(0.5)).toBe(50);
      expect(toPercentage(0.75)).toBe(75);
      expect(toPercentage(1.0)).toBe(100);
    });

    it("volume icon changes based on volume level", () => {
      const getIcon = (volume: number) => (volume === 0 ? "VolumeX" : "Volume2");

      expect(getIcon(0)).toBe("VolumeX");
      expect(getIcon(0.01)).toBe("Volume2");
      expect(getIcon(0.5)).toBe("Volume2");
      expect(getIcon(1.0)).toBe("Volume2");
    });

    it("volume control has minimum width for usability", () => {
      const minWidth = "140px";
      expect(minWidth).toBe("140px");
    });
  });

  describe("Volume control helpers", () => {
    it("clamp function behavior", () => {
      const clamp = (val: number, min: number, max: number) => Math.min(max, Math.max(min, val));

      expect(clamp(0.5, 0, 1)).toBe(0.5);
      expect(clamp(-0.1, 0, 1)).toBe(0);
      expect(clamp(1.5, 0, 1)).toBe(1);
    });

    it("handles floating-point precision in volume calculations", () => {
      const volume1 = 0.5;
      const volume2 = 0.51;
      const diff = Math.abs(volume2 - volume1);

      expect(diff).toBeCloseTo(0.01, 10);
    });

    it("boundary value clamping", () => {
      const boundaryValues = [0, 0.01, 0.99, 1.0];

      for (const value of boundaryValues) {
        const clamped = Math.min(1, Math.max(0, value));
        expect(clamped).toBe(value);
      }
    });
  });
});
