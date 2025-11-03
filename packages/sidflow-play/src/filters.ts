/**
 * Filter syntax parsing for playlist generation.
 */

/**
 * Parsed filter expression.
 */
export interface ParsedFilters {
  /** BPM range [min, max] */
  bpmRange?: [number, number];
  /** Energy range [min, max] */
  energyRange?: [number, number];
  /** Mood range [min, max] */
  moodRange?: [number, number];
  /** Complexity range [min, max] */
  complexityRange?: [number, number];
  /** Preference range [min, max] */
  preferenceRange?: [number, number];
}

/**
 * Parse filter expression string into structured filters.
 * 
 * Supports expressions like:
 * - "e>=4,m>=3,c<=2" - Range expressions
 * - "bpm=120-140" - BPM range
 * - "e=5" - Exact value
 * 
 * @param expr Filter expression string
 * @returns Parsed filters object
 */
export function parseFilters(expr: string): ParsedFilters {
  const filters: ParsedFilters = {};
  
  if (!expr || expr.trim() === "") {
    return filters;
  }

  // Split by comma
  const parts = expr.split(",").map(p => p.trim());

  for (const part of parts) {
    // Match dimension and operator (allow whitespace around operators)
    const match = part.match(/^([emcp]|bpm)\s*(>=?|<=?|=)\s*(\d+(?:-\d+)?)$/i);
    
    if (!match) {
      throw new Error(`Invalid filter expression: ${part}`);
    }

    const [, dimension, operator, value] = match;
    const dim = dimension.toLowerCase();

    // Parse value (could be single number or range)
    if (value.includes("-")) {
      // Range like "120-140"
      const [min, max] = value.split("-").map(Number);
      
      switch (dim) {
        case "bpm":
          filters.bpmRange = [min, max];
          break;
        case "e":
          filters.energyRange = [min, max];
          break;
        case "m":
          filters.moodRange = [min, max];
          break;
        case "c":
          filters.complexityRange = [min, max];
          break;
        case "p":
          filters.preferenceRange = [min, max];
          break;
      }
    } else {
      // Single value with operator
      const num = Number(value);
      
      let range: [number, number];
      switch (operator) {
        case ">=":
          range = [num, 999];
          break;
        case ">":
          range = [num + 1, 999];
          break;
        case "<=":
          range = [0, num];
          break;
        case "<":
          range = [0, num - 1];
          break;
        case "=":
          range = [num, num];
          break;
        default:
          throw new Error(`Unknown operator: ${operator}`);
      }

      switch (dim) {
        case "bpm":
          filters.bpmRange = range;
          break;
        case "e":
          filters.energyRange = range;
          break;
        case "m":
          filters.moodRange = range;
          break;
        case "c":
          filters.complexityRange = range;
          break;
        case "p":
          filters.preferenceRange = range;
          break;
      }
    }
  }

  return filters;
}

/**
 * Format filters back to expression string.
 */
export function formatFilters(filters: ParsedFilters): string {
  const parts: string[] = [];

  if (filters.energyRange) {
    const [min, max] = filters.energyRange;
    if (min === max) {
      parts.push(`e=${min}`);
    } else if (max >= 999) {
      parts.push(`e>=${min}`);
    } else if (min === 0) {
      parts.push(`e<=${max}`);
    } else {
      parts.push(`e=${min}-${max}`);
    }
  }

  if (filters.moodRange) {
    const [min, max] = filters.moodRange;
    if (min === max) {
      parts.push(`m=${min}`);
    } else if (max >= 999) {
      parts.push(`m>=${min}`);
    } else if (min === 0) {
      parts.push(`m<=${max}`);
    } else {
      parts.push(`m=${min}-${max}`);
    }
  }

  if (filters.complexityRange) {
    const [min, max] = filters.complexityRange;
    if (min === max) {
      parts.push(`c=${min}`);
    } else if (max >= 999) {
      parts.push(`c>=${min}`);
    } else if (min === 0) {
      parts.push(`c<=${max}`);
    } else {
      parts.push(`c=${min}-${max}`);
    }
  }

  if (filters.preferenceRange) {
    const [min, max] = filters.preferenceRange;
    if (min === max) {
      parts.push(`p=${min}`);
    } else if (max >= 999) {
      parts.push(`p>=${min}`);
    } else if (min === 0) {
      parts.push(`p<=${max}`);
    } else {
      parts.push(`p=${min}-${max}`);
    }
  }

  if (filters.bpmRange) {
    const [min, max] = filters.bpmRange;
    if (min === max) {
      parts.push(`bpm=${min}`);
    } else if (max >= 999) {
      parts.push(`bpm>=${min}`);
    } else if (min === 0) {
      parts.push(`bpm<=${max}`);
    } else {
      parts.push(`bpm=${min}-${max}`);
    }
  }

  return parts.join(",");
}
