export const C64U_LED_CATEGORY = "LED Strip Settings";

export const C64U_LED_ITEMS = {
  mode: "LedStrip Mode",
  autoSidMode: "LedStrip Auto SID Mode",
  pattern: "LedStrip Pattern",
  intensity: "Strip Intensity",
  fixedColor: "Fixed Color",
} as const;

export const C64U_LED_OPTIONS = {
  mode: ["Off", "Fixed Color", "SID Music", "Rainbow", "Rainbow Sparkle", "Sparkle", "Default"],
  autoSidMode: ["Disabled", "Enabled"],
  pattern: ["SingleColor", "Left to Right", "Right to Left", "Serpentine", "Outward"],
  fixedColor: [
    "Red",
    "Scarlet",
    "Orange",
    "Amber",
    "Yellow",
    "Lemon-Lime",
    "Chartreuse",
    "Lime",
    "Green",
    "Jade",
    "Spring Green",
    "Aquamarine",
    "Cyan",
    "Deep Sky Blue",
    "Azure",
    "Royal Blue",
    "Blue",
    "Indigo",
    "Violet",
    "Purple",
    "Magenta",
    "Fuchsia",
    "Rose",
    "Cerise",
    "White",
  ],
  intensity: {
    min: 0,
    max: 31,
  },
} as const;

export interface C64ULedSettings {
  mode: string;
  autoSidMode: string;
  pattern: string;
  intensity: number;
  fixedColor: string;
}

export interface C64ULedSnapshot {
  settings: C64ULedSettings;
  options: {
    mode: readonly string[];
    autoSidMode: readonly string[];
    pattern: readonly string[];
    fixedColor: readonly string[];
    intensity: {
      min: number;
      max: number;
    };
  };
}

type C64UConfigItemShape = {
  selected?: unknown;
  current?: unknown;
  options?: unknown;
  details?: {
    min?: unknown;
    max?: unknown;
    format?: unknown;
  };
};

function getConfigItem(payload: unknown, itemName: string): C64UConfigItemShape | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const items = (payload as { items?: unknown }).items;
  if (items && typeof items === "object" && !Array.isArray(items)) {
    const record = items as Record<string, C64UConfigItemShape>;
    return record[itemName] ?? null;
  }

  if (Array.isArray(items)) {
    for (const entry of items) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const namedEntry = entry as { name?: unknown } & C64UConfigItemShape;
      if (namedEntry.name === itemName) {
        return namedEntry;
      }
    }
  }

  return null;
}

function readStringValue(payload: unknown, itemName: string, fallback: string): string {
  const item = getConfigItem(payload, itemName);
  const value = item?.selected ?? item?.current;
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function readNumberValue(payload: unknown, itemName: string, fallback: number): number {
  const item = getConfigItem(payload, itemName);
  const value = item?.selected ?? item?.current;
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

export function buildC64ULedSnapshot(payload: unknown): C64ULedSnapshot {
  return {
    settings: {
      mode: readStringValue(payload, C64U_LED_ITEMS.mode, "Fixed Color"),
      autoSidMode: readStringValue(payload, C64U_LED_ITEMS.autoSidMode, "Enabled"),
      pattern: readStringValue(payload, C64U_LED_ITEMS.pattern, "SingleColor"),
      intensity: readNumberValue(payload, C64U_LED_ITEMS.intensity, 25),
      fixedColor: readStringValue(payload, C64U_LED_ITEMS.fixedColor, "Indigo"),
    },
    options: {
      mode: C64U_LED_OPTIONS.mode,
      autoSidMode: C64U_LED_OPTIONS.autoSidMode,
      pattern: C64U_LED_OPTIONS.pattern,
      fixedColor: C64U_LED_OPTIONS.fixedColor,
      intensity: C64U_LED_OPTIONS.intensity,
    },
  };
}

function includesString(values: readonly string[], candidate: string): boolean {
  return values.includes(candidate);
}

export function validateC64ULedPatch(patch: Partial<C64ULedSettings>): string[] {
  const errors: string[] = [];

  if (patch.mode !== undefined && !includesString(C64U_LED_OPTIONS.mode, patch.mode)) {
    errors.push(`mode must be one of: ${C64U_LED_OPTIONS.mode.join(", ")}`);
  }
  if (patch.autoSidMode !== undefined && !includesString(C64U_LED_OPTIONS.autoSidMode, patch.autoSidMode)) {
    errors.push(`autoSidMode must be one of: ${C64U_LED_OPTIONS.autoSidMode.join(", ")}`);
  }
  if (patch.pattern !== undefined && !includesString(C64U_LED_OPTIONS.pattern, patch.pattern)) {
    errors.push(`pattern must be one of: ${C64U_LED_OPTIONS.pattern.join(", ")}`);
  }
  if (patch.fixedColor !== undefined && !includesString(C64U_LED_OPTIONS.fixedColor, patch.fixedColor)) {
    errors.push(`fixedColor must be one of: ${C64U_LED_OPTIONS.fixedColor.join(", ")}`);
  }
  if (patch.intensity !== undefined) {
    const { min, max } = C64U_LED_OPTIONS.intensity;
    if (!Number.isInteger(patch.intensity) || patch.intensity < min || patch.intensity > max) {
      errors.push(`intensity must be an integer between ${min} and ${max}`);
    }
  }

  return errors;
}