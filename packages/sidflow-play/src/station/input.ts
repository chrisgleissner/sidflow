import type { SeedAction, StationAction, InputController, StationRuntime } from "./types.js";

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function normalizePromptResponse(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "left") {
    return "left";
  }
  if (trimmed === "right") {
    return "right";
  }
  if (trimmed === "up") {
    return "up";
  }
  if (trimmed === "down") {
    return "down";
  }
  if (trimmed === "pgup" || trimmed === "pageup") {
    return "pgup";
  }
  if (trimmed === "pgdn" || trimmed === "pagedown") {
    return "pgdn";
  }
  if (trimmed === "enter") {
    return "";
  }
  if (trimmed === "space") {
    return " ";
  }
  return trimmed;
}

export function mapSeedToken(token: string): SeedAction | null {
  if (["q", "\u0003"].includes(token)) {
    return { type: "quit" };
  }
  if (["b", "left"].includes(token)) {
    return { type: "back" };
  }
  if (["r", "up"].includes(token)) {
    return { type: "replay" };
  }
  if (["l", "+"].includes(token)) {
    return { type: "rate", rating: 5 };
  }
  if (["d", "x"].includes(token)) {
    return { type: "rate", rating: 0 };
  }
  if (["s", "right", "down", ""].includes(token)) {
    return { type: "skip" };
  }
  const rating = Number.parseInt(token, 10);
  if (Number.isInteger(rating) && rating >= 0 && rating <= 5) {
    return { type: "rate", rating };
  }
  return null;
}

export function mapStationToken(token: string): StationAction | null {
  if (["q", "\u0003"].includes(token)) {
    return { type: "quit" };
  }
  if (["right", "n"].includes(token)) {
    return { type: "next" };
  }
  if (["left", "b"].includes(token)) {
    return { type: "back" };
  }
  if (["up", "k"].includes(token)) {
    return { type: "cursorUp" };
  }
  if (["down", "j"].includes(token)) {
    return { type: "cursorDown" };
  }
  if (["pgup"].includes(token)) {
    return { type: "pageUp" };
  }
  if (["pgdn"].includes(token)) {
    return { type: "pageDown" };
  }
  if (token === "") {
    return { type: "playSelected" };
  }
  if (token === " ") {
    return { type: "togglePause" };
  }
  if (["/", "f"].includes(token)) {
    return { type: "setFilter", value: "", editing: true };
  }
  if (["h"].includes(token)) {
    return { type: "shuffle" };
  }
  if (["r"].includes(token)) {
    return { type: "replay" };
  }
  if (["s"].includes(token)) {
    return { type: "rate", rating: 0 };
  }
  if (["u"].includes(token)) {
    return { type: "rebuild" };
  }
  if (["l", "+"].includes(token)) {
    return { type: "rate", rating: 5 };
  }
  if (["d", "x"].includes(token)) {
    return { type: "rate", rating: 0 };
  }
  const rating = Number.parseInt(token, 10);
  if (Number.isInteger(rating) && rating >= 0 && rating <= 5) {
    return { type: "rate", rating };
  }
  return null;
}

class PromptInputController implements InputController {
  constructor(private readonly ask: (message: string) => Promise<string>) {}

  close(): void {
    return;
  }

  async readSeedAction(): Promise<SeedAction> {
    while (true) {
      const answer = normalizePromptResponse(await this.ask("Rate 0-5, l=like, d=dislike, s=skip, b=back, r=replay, q=quit > "));
      const action = mapSeedToken(answer);
      if (action) {
        return action;
      }
    }
  }

  async readStationAction(_timeoutMs: number): Promise<StationAction> {
    while (true) {
      const answer = normalizePromptResponse(
        await this.ask("Command / filter, left/right/up/down/pgup/pgdn, enter=play, space=pause, h=shuffle, s=skip-dislike, l=like, d=dislike, r=replay, u=rebuild, 0-5=rate, q=quit > "),
      );
      if (["/", "f"].includes(answer)) {
        const filterValue = await this.ask("Filter title/artist (blank clears) > ");
        return { type: "setFilter", value: filterValue, editing: false };
      }
      const action = mapStationToken(answer);
      if (action) {
        return action;
      }
    }
  }
}

export function decodeTerminalInput(chunk: string): string[] {
  const tokens: string[] = [];
  let index = 0;
  while (index < chunk.length) {
    const remainder = chunk.slice(index);
    if (remainder.startsWith("\u001b[5~")) {
      tokens.push("pgup");
      index += 4;
      continue;
    }
    if (remainder.startsWith("\u001b[6~")) {
      tokens.push("pgdn");
      index += 4;
      continue;
    }
    if (remainder.startsWith("\u001b[C")) {
      tokens.push("right");
      index += 3;
      continue;
    }
    if (remainder.startsWith("\u001b[D")) {
      tokens.push("left");
      index += 3;
      continue;
    }
    if (remainder.startsWith("\u001b[A")) {
      tokens.push("up");
      index += 3;
      continue;
    }
    if (remainder.startsWith("\u001b[B")) {
      tokens.push("down");
      index += 3;
      continue;
    }
    if (remainder.startsWith("\u001b")) {
      tokens.push("escape");
      index += 1;
      continue;
    }
    const char = chunk[index];
    if (char === " ") {
      tokens.push(" ");
      index += 1;
      continue;
    }
    if (char === "\u007f" || char === "\b") {
      tokens.push("backspace");
      index += 1;
      continue;
    }
    if (char === "\r" || char === "\n") {
      tokens.push("");
    } else {
      tokens.push(char.toLowerCase());
    }
    index += 1;
  }
  return tokens;
}

class RawInputController implements InputController {
  private readonly stdin: NodeJS.ReadStream;
  private readonly queue: string[] = [];
  private readonly handleData: (chunk: string) => void;
  private closed = false;
  private filterEditing = false;
  private filterBuffer = "";

  constructor(runtime: StationRuntime) {
    this.stdin = runtime.stdin as NodeJS.ReadStream;
    this.handleData = (chunk: string) => {
      this.queue.push(...decodeTerminalInput(chunk));
    };

    this.stdin.setEncoding("utf8");
    this.stdin.setRawMode?.(true);
    this.stdin.resume();
    this.stdin.on("data", this.handleData);
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.stdin.off("data", this.handleData);
    this.stdin.setRawMode?.(false);
    this.stdin.pause();
  }

  private async nextMappedAction<T>(timeoutMs: number | null, mapper: (token: string) => T | null, onTick?: () => void): Promise<T | null> {
    const deadline = timeoutMs === null ? null : Date.now() + timeoutMs;
    while (true) {
      while (this.queue.length > 0) {
        const action = mapper(this.queue.shift()!);
        if (action) {
          return action;
        }
      }

      if (deadline !== null && Date.now() >= deadline) {
        return null;
      }

      onTick?.();
      const remaining = deadline === null ? 120 : Math.max(20, Math.min(120, deadline - Date.now()));
      await sleep(remaining);
    }
  }

  async readSeedAction(): Promise<SeedAction> {
    const action = await this.nextMappedAction<SeedAction>(null, mapSeedToken);
    return action ?? { type: "quit" };
  }

  async readStationAction(timeoutMs: number, onTick?: () => void): Promise<StationAction> {
    const action = await this.nextMappedAction<StationAction>(
      timeoutMs,
      (token) => {
        if (this.filterEditing) {
          if (token === "\u0003") {
            return { type: "quit" };
          }
          if (token === "escape") {
            this.filterEditing = false;
            this.filterBuffer = "";
            return { type: "setFilter", value: "", editing: false };
          }
          if (token === "") {
            this.filterEditing = false;
            return { type: "setFilter", value: this.filterBuffer, editing: false };
          }
          if (token === "backspace") {
            this.filterBuffer = this.filterBuffer.slice(0, -1);
            return { type: "setFilter", value: this.filterBuffer, editing: true };
          }
          if (token.length === 1 && token >= " ") {
            this.filterBuffer += token;
            return { type: "setFilter", value: this.filterBuffer, editing: true };
          }
          return null;
        }

        if (["/", "f"].includes(token)) {
          this.filterEditing = true;
          return { type: "setFilter", value: this.filterBuffer, editing: true };
        }

        return mapStationToken(token);
      },
      onTick,
    );
    return action ?? { type: "timeout" };
  }
}

export function createInputController(runtime: StationRuntime): InputController {
  if (runtime.prompt) {
    return new PromptInputController(runtime.prompt);
  }

  const stdout = runtime.stdout as NodeJS.WriteStream;
  const stdin = runtime.stdin as NodeJS.ReadStream;
  if (!stdout.isTTY || !stdin.isTTY) {
    throw new Error("Interactive SID CLI Station requires a TTY unless a prompt override is provided");
  }

  return new RawInputController(runtime);
}
