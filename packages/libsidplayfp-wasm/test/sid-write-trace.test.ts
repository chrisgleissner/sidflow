import { beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SidAudioEngine, type SidWriteTrace } from '../src/player.js';

const testSidPath = resolve(__dirname, '../test-tone-c4.sid');
let testSidData: Uint8Array;

beforeAll(() => {
  testSidData = new Uint8Array(readFileSync(testSidPath));
});

describe('SidAudioEngine SID write tracing', () => {
  test('applies trace enablement to newly created contexts and returns collected traces', async () => {
    const enableCalls: boolean[] = [];
    const traceBatch: SidWriteTrace[] = [
      { sidNumber: 0, address: 0x04, value: 0x21, cyclePhi1: 128 },
      { sidNumber: 0, address: 0x18, value: 0x0f, cyclePhi1: 192 },
    ];

    class FakeContext {
      configure(): boolean {
        return true;
      }

      loadSidBuffer(): boolean {
        return true;
      }

      reset(): boolean {
        return true;
      }

      getChannels(): number {
        return 2;
      }

      getSampleRate(): number {
        return 44100;
      }

      getTuneInfo(): Record<string, unknown> | null {
        return null;
      }

      getLastError(): string {
        return '';
      }

      render(): Int16Array {
        return new Int16Array([1, 2, 3, 4]);
      }

      setSidWriteTraceEnabled(enabled: boolean): void {
        enableCalls.push(enabled);
      }

      getAndClearSidWriteTraces(): SidWriteTrace[] {
        return traceBatch;
      }
    }

    const module = Promise.resolve({
      SidPlayerContext: class extends FakeContext {},
    } as any);

    const engine = new SidAudioEngine({ module });
    engine.setSidWriteTraceEnabled(true);

    await engine.loadSidBuffer(testSidData);

    expect(enableCalls).toEqual([true]);
    expect(engine.getAndClearSidWriteTraces()).toEqual(traceBatch);
  });
});
