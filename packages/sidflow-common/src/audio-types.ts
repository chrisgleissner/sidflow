export type AudioEncoderImplementation = "native" | "wasm" | "auto";

export interface FfmpegWasmOptions {
	readonly log?: boolean;
	readonly corePath?: string;
	readonly wasmPath?: string;
	readonly workerPath?: string;
}

export interface AudioEncoderConfig {
	readonly implementation?: AudioEncoderImplementation;
	readonly wasm?: FfmpegWasmOptions;
}
