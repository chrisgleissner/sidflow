declare module "7zip-min" {
    export function pack(source: string, destination: string, callback: (error?: Error | null) => void): void;
    export function unpack(source: string, destination: string, callback: (error?: Error | null) => void): void;
}