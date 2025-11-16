export type SidChipModel = "6581" | "8580";

/**
 * Normalize arbitrary chip labels (e.g., "MOS 8580R5") to canonical SID chip IDs.
 */
export function normalizeSidChip(value: unknown): SidChipModel | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) {
    return null;
  }

  if (normalized.includes("6581")) {
    return "6581";
  }

  if (normalized.includes("8580")) {
    return "8580";
  }

  return null;
}
