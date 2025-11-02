export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export function normalizeForDeterministicSerialization(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(normalizeForDeterministicSerialization) as JsonValue;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, JsonValue>)
      .sort(([a], [b]) => a.localeCompare(b));

    const normalized: Record<string, JsonValue> = {};
    for (const [key, child] of entries) {
      normalized[key] = normalizeForDeterministicSerialization(child) as JsonValue;
    }
    return normalized;
  }

  return value;
}

export function stringifyDeterministic(value: JsonValue, spacing = 2): string {
  const normalized = normalizeForDeterministicSerialization(value);
  return JSON.stringify(normalized, null, spacing) + "\n";
}
