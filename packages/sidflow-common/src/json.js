export function normalizeForDeterministicSerialization(value) {
    if (Array.isArray(value)) {
        return value.map(normalizeForDeterministicSerialization);
    }
    if (value && typeof value === "object") {
        const entries = Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b));
        const normalized = {};
        for (const [key, child] of entries) {
            normalized[key] = normalizeForDeterministicSerialization(child);
        }
        return normalized;
    }
    return value;
}
export function stringifyDeterministic(value, spacing = 2) {
    const normalized = normalizeForDeterministicSerialization(value);
    return JSON.stringify(normalized, null, spacing) + "\n";
}
//# sourceMappingURL=json.js.map