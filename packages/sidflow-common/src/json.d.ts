type JsonValue = string | number | boolean | null | JsonValue[] | {
    [key: string]: JsonValue;
};
export declare function normalizeForDeterministicSerialization(value: JsonValue): JsonValue;
export declare function stringifyDeterministic(value: JsonValue, spacing?: number): string;
export {};
//# sourceMappingURL=json.d.ts.map