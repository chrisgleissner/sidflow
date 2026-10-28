/** Experimental scheduling only: always retain real engine readback.
 * A reference lane's successful clocking mode is a cost hint, never evidence
 * about another lane. Every variant still executes its complete horizon.
 */
import type { DigitalScreen } from "./digital-screen.js";
export type ScreenMode = "bus" | "warmup" | "detailed";
export interface ScreenAttempt { mask: number; mode: ScreenMode; result: DigitalScreen }
export const STATEFUL_READ = "stateful SID read requires detailed screen";
export async function adaptiveScreens(
  run: (mask: number, mode: ScreenMode) => Promise<DigitalScreen>,
  adaptive: boolean,
): Promise<ScreenAttempt[]> {
  const attempts: ScreenAttempt[] = [];
  async function lane(mask: number, initial: ScreenMode): Promise<ScreenMode> {
    const modes: ScreenMode[] = ["bus", "warmup", "detailed"];
    for (const mode of modes.slice(modes.indexOf(initial))) {
      const result = await run(mask, mode);
      attempts.push({mask, mode, result});
      if (result.error !== STATEFUL_READ || mode === "detailed") return mode;
    }
    throw new Error("No screen mode executed");
  }
  const mode = await lane(7, "bus");
  const reference = attempts.at(-1)!.result;
  if (reference.error || !reference.traceComplete) return attempts;
  await lane(0, adaptive ? mode : "bus");
  if (reference.chargenReads !== 0) await lane(3, adaptive ? mode : "bus");
  return attempts;
}
