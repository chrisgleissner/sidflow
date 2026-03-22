import type { SidClock } from "@sidflow/common";
import type { SidWriteTrace } from "@sidflow/libsidplayfp-wasm";

export const PAL_CYCLES_PER_SECOND = 985_248;
export const NTSC_CYCLES_PER_SECOND = 1_022_727;
export const PAL_FRAME_RATE = 50;
export const NTSC_FRAME_RATE = 60;

const SID_REGISTER_COUNT = 0x19;
const VOICE_COUNT = 3;
const VOICE_REGISTER_BLOCK_SIZE = 7;
const GLOBAL_REGISTER_START = 0x15;
const GLOBAL_REGISTER_END = 0x18;

const VOICE_REGISTER_NAMES = [
	"FREQ_LO",
	"FREQ_HI",
	"PW_LO",
	"PW_HI",
	"CONTROL",
	"ATTACK_DECAY",
	"SUSTAIN_RELEASE",
] as const;

const GLOBAL_REGISTER_NAMES = ["FILTER_CUTOFF_LO", "FILTER_CUTOFF_HI", "FILTER_RESONANCE", "MODE_VOLUME"] as const;

export type SidTraceVideoStandard = "PAL" | "NTSC";

export interface SidTraceFrameWindow {
	clock: SidTraceVideoStandard;
	frameRate: number;
	cyclesPerSecond: number;
	cyclesPerFrame: number;
	skipFrames: number;
	analysisFrames: number;
	totalFrames: number;
}

export interface SidDerivedSignal {
	scope: "voice" | "global";
	voice?: 1 | 2 | 3;
	registerIndex: number;
	frequencyWord?: number;
	pulseWidth?: number;
	gate?: boolean;
	sync?: boolean;
	ringMod?: boolean;
	test?: boolean;
	waveform?: "noise" | "pulse" | "saw" | "triangle" | "mixed" | "none";
	attack?: number;
	decay?: number;
	sustain?: number;
	release?: number;
	filterCutoff?: number;
	filterResonance?: number;
	filterRouteVoice1?: boolean;
	filterRouteVoice2?: boolean;
	filterRouteVoice3?: boolean;
	filterRouteExternal?: boolean;
	lowPass?: boolean;
	bandPass?: boolean;
	highPass?: boolean;
	volume?: number;
	voice3Disconnect?: boolean;
}

export interface CanonicalSidRegisterEvent {
	frame: number;
	sidNumber: number;
	voice: 1 | 2 | 3;
	register: string;
	address: number;
	value: number;
	cyclePhi1: number;
	derivedSignal: SidDerivedSignal;
}

export interface CompactSidWriteTraceOptions {
	clock: SidClock | SidTraceVideoStandard | undefined;
	skipSeconds?: number;
	analysisSeconds?: number;
}

interface SidRegisterState {
	values: Uint8Array;
	cycles: Float64Array;
}

export function normalizeSidTraceClock(clock: SidClock | SidTraceVideoStandard | undefined): SidTraceVideoStandard {
	if (clock === "NTSC") {
		return "NTSC";
	}

	return "PAL";
}

export function resolveSidTraceFrameWindow(options: CompactSidWriteTraceOptions): SidTraceFrameWindow {
	const clock = normalizeSidTraceClock(options.clock);
	const frameRate = clock === "NTSC" ? NTSC_FRAME_RATE : PAL_FRAME_RATE;
	const cyclesPerSecond = clock === "NTSC" ? NTSC_CYCLES_PER_SECOND : PAL_CYCLES_PER_SECOND;
	const skipFrames = Math.max(0, Math.ceil((options.skipSeconds ?? 15) * frameRate));
	const analysisFrames = Math.max(1, Math.ceil((options.analysisSeconds ?? 15) * frameRate));

	return {
		clock,
		frameRate,
		cyclesPerSecond,
		cyclesPerFrame: cyclesPerSecond / frameRate,
		skipFrames,
		analysisFrames,
		totalFrames: skipFrames + analysisFrames,
	};
}

export function compactSidWriteTraceToFrames(
	traces: readonly SidWriteTrace[],
	options: CompactSidWriteTraceOptions,
): CanonicalSidRegisterEvent[] {
	const frameWindow = resolveSidTraceFrameWindow(options);
	const sortedTraces = [...traces].sort((left, right) => left.cyclePhi1 - right.cyclePhi1);
	const maxCycle = frameWindow.totalFrames * frameWindow.cyclesPerFrame;
	const states = new Map<number, SidRegisterState>();
	const events: CanonicalSidRegisterEvent[] = [];
	let traceIndex = 0;

	for (let absoluteFrame = 0; absoluteFrame < frameWindow.totalFrames; absoluteFrame += 1) {
		const frameEndCycle = (absoluteFrame + 1) * frameWindow.cyclesPerFrame;

		while (traceIndex < sortedTraces.length) {
			const trace = sortedTraces[traceIndex];
			if (trace.cyclePhi1 >= frameEndCycle || trace.cyclePhi1 >= maxCycle) {
				break;
			}

			if (trace.address >= 0 && trace.address < SID_REGISTER_COUNT) {
				const state = getSidRegisterState(states, trace.sidNumber);
				state.values[trace.address] = trace.value & 0xff;
				state.cycles[trace.address] = trace.cyclePhi1;
			}

			traceIndex += 1;
		}

		if (absoluteFrame < frameWindow.skipFrames) {
			continue;
		}

		const analysisFrame = absoluteFrame - frameWindow.skipFrames;
		for (const [sidNumber, state] of states.entries()) {
			events.push(...buildFrameEvents(analysisFrame, sidNumber, state));
		}
	}

	return events;
}

function getSidRegisterState(states: Map<number, SidRegisterState>, sidNumber: number): SidRegisterState {
	const existing = states.get(sidNumber);
	if (existing) {
		return existing;
	}

	const created = {
		values: new Uint8Array(SID_REGISTER_COUNT),
		cycles: new Float64Array(SID_REGISTER_COUNT),
	};
	states.set(sidNumber, created);
	return created;
}

function buildFrameEvents(frame: number, sidNumber: number, state: SidRegisterState): CanonicalSidRegisterEvent[] {
	const events: CanonicalSidRegisterEvent[] = [];

	for (let voiceIndex = 0; voiceIndex < VOICE_COUNT; voiceIndex += 1) {
		const voice = (voiceIndex + 1) as 1 | 2 | 3;
		const voiceBaseAddress = voiceIndex * VOICE_REGISTER_BLOCK_SIZE;

		for (let offset = 0; offset < VOICE_REGISTER_BLOCK_SIZE; offset += 1) {
			const address = voiceBaseAddress + offset;
			const register = `VOICE${voice}_${VOICE_REGISTER_NAMES[offset]}`;
			events.push({
				frame,
				sidNumber,
				voice,
				register,
				address,
				value: state.values[address],
				cyclePhi1: state.cycles[address],
				derivedSignal: buildVoiceDerivedSignal(voice, offset, state.values),
			});
		}
	}

	for (let address = GLOBAL_REGISTER_START; address <= GLOBAL_REGISTER_END; address += 1) {
		const register = GLOBAL_REGISTER_NAMES[address - GLOBAL_REGISTER_START];
		for (let voice = 1 as 1 | 2 | 3; voice <= VOICE_COUNT; voice += 1) {
			events.push({
				frame,
				sidNumber,
				voice,
				register,
				address,
				value: state.values[address],
				cyclePhi1: state.cycles[address],
				derivedSignal: buildGlobalDerivedSignal(voice, address, state.values),
			});
		}
	}

	return events;
}

function buildVoiceDerivedSignal(voice: 1 | 2 | 3, registerIndex: number, values: Uint8Array): SidDerivedSignal {
	const baseAddress = (voice - 1) * VOICE_REGISTER_BLOCK_SIZE;
	const control = values[baseAddress + 4];

	switch (registerIndex) {
		case 0:
		case 1:
			return {
				scope: "voice",
				voice,
				registerIndex,
				frequencyWord: values[baseAddress] | (values[baseAddress + 1] << 8),
			};
		case 2:
		case 3:
			return {
				scope: "voice",
				voice,
				registerIndex,
				pulseWidth: values[baseAddress + 2] | ((values[baseAddress + 3] & 0x0f) << 8),
			};
		case 4:
			return {
				scope: "voice",
				voice,
				registerIndex,
				gate: Boolean(control & 0x01),
				sync: Boolean(control & 0x02),
				ringMod: Boolean(control & 0x04),
				test: Boolean(control & 0x08),
				waveform: decodeWaveform(control),
			};
		case 5:
			return {
				scope: "voice",
				voice,
				registerIndex,
				attack: (values[baseAddress + 5] >> 4) & 0x0f,
				decay: values[baseAddress + 5] & 0x0f,
			};
		case 6:
			return {
				scope: "voice",
				voice,
				registerIndex,
				sustain: (values[baseAddress + 6] >> 4) & 0x0f,
				release: values[baseAddress + 6] & 0x0f,
			};
		default:
			return {
				scope: "voice",
				voice,
				registerIndex,
			};
	}
}

function buildGlobalDerivedSignal(voice: 1 | 2 | 3, address: number, values: Uint8Array): SidDerivedSignal {
	switch (address) {
		case 0x15:
		case 0x16:
			return {
				scope: "global",
				voice,
				registerIndex: address,
				filterCutoff: values[0x15] | ((values[0x16] & 0x07) << 8),
			};
		case 0x17:
			return {
				scope: "global",
				voice,
				registerIndex: address,
				filterResonance: (values[0x17] >> 4) & 0x0f,
				filterRouteVoice1: Boolean(values[0x17] & 0x01),
				filterRouteVoice2: Boolean(values[0x17] & 0x02),
				filterRouteVoice3: Boolean(values[0x17] & 0x04),
				filterRouteExternal: Boolean(values[0x17] & 0x08),
			};
		case 0x18:
			return {
				scope: "global",
				voice,
				registerIndex: address,
				lowPass: Boolean(values[0x18] & 0x10),
				bandPass: Boolean(values[0x18] & 0x20),
				highPass: Boolean(values[0x18] & 0x40),
				voice3Disconnect: Boolean(values[0x18] & 0x80),
				volume: values[0x18] & 0x0f,
			};
		default:
			return {
				scope: "global",
				voice,
				registerIndex: address,
			};
	}
}

function decodeWaveform(control: number): SidDerivedSignal["waveform"] {
	const activeWaveforms = [
		Boolean(control & 0x80),
		Boolean(control & 0x40),
		Boolean(control & 0x20),
		Boolean(control & 0x10),
	];
	const count = activeWaveforms.filter(Boolean).length;

	if (count > 1) {
		return "mixed";
	}

	if (control & 0x80) {
		return "noise";
	}

	if (control & 0x40) {
		return "pulse";
	}

	if (control & 0x20) {
		return "saw";
	}

	if (control & 0x10) {
		return "triangle";
	}

	return "none";
}
