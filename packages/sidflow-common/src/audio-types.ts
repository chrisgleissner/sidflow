export type AudioEncoderImplementation = "native" | "wasm" | "auto";

export interface FfmpegWasmOptions {
	readonly log?: boolean;
	readonly corePath?: string;
	readonly wasmPath?: string;
	readonly workerPath?: string;
	readonly fetch?: typeof fetch;
}

export interface AudioEncoderConfig {
	readonly implementation?: AudioEncoderImplementation;
	readonly wasm?: FfmpegWasmOptions;
}
