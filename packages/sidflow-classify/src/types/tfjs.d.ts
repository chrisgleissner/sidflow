declare module "@tensorflow/tfjs" {
  export * from "@tensorflow/tfjs-core";
  export * from "@tensorflow/tfjs-data";
  export * from "@tensorflow/tfjs-layers";
  export * from "@tensorflow/tfjs-converter";

  export type { LayersModel } from "@tensorflow/tfjs-layers";
  export type { Tensor } from "@tensorflow/tfjs-core";

  export const sequential: typeof import("@tensorflow/tfjs-layers").sequential;
  export const layers: typeof import("@tensorflow/tfjs-layers").layers;
  export const loadLayersModel: typeof import("@tensorflow/tfjs-layers").loadLayersModel;
  export const tensor2d: typeof import("@tensorflow/tfjs-core").tensor2d;
  export const train: typeof import("@tensorflow/tfjs-core").train;
}
