export const DEFAULT_PACING_SECONDS = 3;
export const DEFAULT_JOURNEY_DIR = "performance/journeys";
export const DEFAULT_RESULTS_ROOT = "performance/results";
export const DEFAULT_TMP_ROOT = "performance/tmp";

// Default user variants by executor are selected via RunnerEnvironment.profile.
// These "standard" variants are for local/staging usage; CI uses reduced variants.
export const PLAYWRIGHT_USER_VARIANTS = [1, 10];
export const K6_USER_VARIANTS = [1, 10, 100];

// CI defaults (public GitHub runners): keep load intentionally small for stability.
export const PLAYWRIGHT_USER_VARIANTS_REDUCED = [1];
export const K6_USER_VARIANTS_REDUCED = [1, 10];
