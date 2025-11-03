// Type definitions for essentia.js
// These are minimal type definitions for the features we use

declare module "essentia.js" {
  export class EssentiaWASM {
    constructor();
    initialize(): Promise<void>;
    arrayToVector(array: Float32Array | number[]): EssentiaVector;
    Spectrum(signal: EssentiaVector): EssentiaVector;
    Centroid(spectrum: EssentiaVector): number;
    RollOff(spectrum: EssentiaVector): number;
    Energy(signal: EssentiaVector): number;
    RMS(signal: EssentiaVector): number;
    ZeroCrossingRate(signal: EssentiaVector): number;
    RhythmExtractor2013(signal: EssentiaVector, sampleRate: number): RhythmResult;
  }

  export interface EssentiaVector {
    delete(): void;
  }

  export interface RhythmResult {
    bpm: number;
    confidence: number;
  }

  export class Essentia {
    constructor();
  }

  export class EssentiaModel {
    constructor();
  }

  export class EssentiaExtractor {
    constructor();
  }

  export class EssentiaPlot {
    constructor();
  }
}
