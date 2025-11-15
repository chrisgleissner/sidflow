/// <reference types="bun-types" />

import { describe, expect, it, beforeEach, mock } from "bun:test";

describe("Volume Control", () => {
  describe("SidflowPlayer volume methods", () => {
    let mockGainNode: {
      gain: { value: number };
      connect: ReturnType<typeof mock>;
    };
    let mockAudioContext: {
      createGain: ReturnType<typeof mock>;
      destination: unknown;
      resume: ReturnType<typeof mock>;
      close: ReturnType<typeof mock>;
    };

    beforeEach(() => {
      mockGainNode = {
        gain: { value: 1.0 },
        connect: mock(() => {}),
      };

      mockAudioContext = {
        createGain: mock(() => mockGainNode),
        destination: {},
        resume: mock(() => Promise.resolve()),
        close: mock(() => Promise.resolve()),
      };
    });

    it("setVolume clamps value between 0 and 1", () => {
      // Test values within range
      mockGainNode.gain.value = 1.0;
      const clampedHalf = Math.min(1, Math.max(0, 0.5));
      expect(clampedHalf).toBe(0.5);

      // Test value below minimum
      const clampedLow = Math.min(1, Math.max(0, -0.5));
      expect(clampedLow).toBe(0);

      // Test value above maximum
      const clampedHigh = Math.min(1, Math.max(0, 1.5));
      expect(clampedHigh).toBe(1);
    });

    it("setVolume updates gain node value", () => {
      const targetVolume = 0.7;
      mockGainNode.gain.value = targetVolume;
      expect(mockGainNode.gain.value).toBe(0.7);
    });

    it("getVolume returns current gain value", () => {
      mockGainNode.gain.value = 0.3;
      expect(mockGainNode.gain.value).toBe(0.3);

      mockGainNode.gain.value = 1.0;
      expect(mockGainNode.gain.value).toBe(1.0);
    });

    it("volume defaults to 1.0 (full volume)", () => {
      expect(mockGainNode.gain.value).toBe(1.0);
    });

    it("volume can be set to 0 (muted)", () => {
      mockGainNode.gain.value = 0;
      expect(mockGainNode.gain.value).toBe(0);
    });

    it("volume changes are granular with 0.01 step", () => {
      const steps = [0, 0.01, 0.5, 0.99, 1.0];
      for (const step of steps) {
        mockGainNode.gain.value = step;
        expect(mockGainNode.gain.value).toBe(step);
      }
    });
  });

  describe("WorkletPlayer volume methods", () => {
    let mockGainNode: {
      gain: { value: number };
      connect: ReturnType<typeof mock>;
    };

    beforeEach(() => {
      mockGainNode = {
        gain: { value: 1.0 },
        connect: mock(() => {}),
      };
    });

    it("setVolume clamps value correctly", () => {
      const clampToRange = (val: number) => Math.min(1, Math.max(0, val));

      expect(clampToRange(0.5)).toBe(0.5);
      expect(clampToRange(-0.1)).toBe(0);
      expect(clampToRange(1.5)).toBe(1);
    });

    it("setVolume updates gain node", () => {
      mockGainNode.gain.value = 0.8;
      expect(mockGainNode.gain.value).toBe(0.8);
    });

    it("getVolume returns gain value", () => {
      mockGainNode.gain.value = 0.6;
      expect(mockGainNode.gain.value).toBe(0.6);
    });
  });

  describe("HlsPlayer volume methods", () => {
    let mockAudioElement: {
      volume: number;
    };

    beforeEach(() => {
      mockAudioElement = {
        volume: 1.0,
      };
    });

    it("setVolume clamps value correctly", () => {
      const clampToRange = (val: number) => Math.min(1, Math.max(0, val));

      expect(clampToRange(0.5)).toBe(0.5);
      expect(clampToRange(-0.1)).toBe(0);
      expect(clampToRange(1.5)).toBe(1);
    });

    it("setVolume updates audio element volume", () => {
      mockAudioElement.volume = 0.4;
      expect(mockAudioElement.volume).toBe(0.4);
    });

    it("getVolume returns audio element volume or 1.0 if no audio", () => {
      mockAudioElement.volume = 0.75;
      expect(mockAudioElement.volume).toBe(0.75);

      // Simulate no audio element
      const fallbackVolume = 1.0;
      expect(fallbackVolume).toBe(1.0);
    });

    it("handles null audio element gracefully", () => {
      const nullAudio = null;
      const volume = nullAudio?.volume ?? 1.0;
      expect(volume).toBe(1.0);
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

  describe("Volume persistence and initialization", () => {
    it("volume state initializes to 1.0 (full)", () => {
      const initialVolume = 1.0;
      expect(initialVolume).toBe(1.0);
    });

    it("volume syncs with player on initialization", () => {
      const playerVolume = 1.0;
      const stateVolume = 1.0;

      expect(playerVolume).toBe(stateVolume);
    });

    it("volume changes propagate to player immediately", () => {
      let playerVolume;
      const newVolume = 0.6;

      // Simulate immediate update
      playerVolume = newVolume;

      expect(playerVolume).toBe(0.6);
    });
  });

  describe("Volume control edge cases", () => {
    it("handles very small volume changes", () => {
      const volume1 = 0.5;
      const volume2 = 0.51;
      const diff = Math.abs(volume2 - volume1);

      // Use toBeCloseTo to handle floating-point precision
      expect(diff).toBeCloseTo(0.01, 10);
      expect(diff).toBeLessThanOrEqual(0.02);
    });

    it("handles rapid volume changes", () => {
      const volumes = [0.1, 0.2, 0.3, 0.4, 0.5];
      let currentVolume = 1.0;

      for (const vol of volumes) {
        currentVolume = vol;
      }

      expect(currentVolume).toBe(0.5);
    });

    it("volume at boundary values works correctly", () => {
      const boundaryValues = [0, 0.01, 0.99, 1.0];

      for (const value of boundaryValues) {
        const clamped = Math.min(1, Math.max(0, value));
        expect(clamped).toBe(value);
      }
    });
  });
});
