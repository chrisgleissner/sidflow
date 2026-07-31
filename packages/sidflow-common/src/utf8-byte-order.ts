/**
 * Compare strings by their UTF-8 bytes, not the process locale.
 *
 * The portable export formats specify this order. `doc/similarity-export-lite.md`
 * requires file dictionary entries and base ordering to be "bytewise UTF-8", and
 * `doc/similarity-export-tiny.md` section 4.2 requires the same for track ordinals.
 * Locale collation would make the same source corpus produce a different artifact on
 * different build hosts, because `String.prototype.localeCompare` resolves against
 * whichever ICU locale the process happens to have.
 *
 * Implemented without allocating the UTF-8 encoding of either string. UTF-8 byte order
 * is identical to Unicode code point order, so comparing code points is sufficient.
 * JavaScript strings are UTF-16, and comparing their code units directly is wrong for
 * exactly one case: a surrogate code unit (U+D800 to U+DFFF) encodes a supplementary
 * character (U+10000 and above) that must sort after every BMP character, but its code
 * unit value sorts before U+E000 to U+FFFF. Biasing surrogate code units above the BMP
 * range restores code point order.
 *
 * The allocation matters because this comparator runs on an interactive path: the lite
 * dataset re-sorts every scored row on each recommendation. Sorting 61,000 HVSC-shaped
 * paths was measured at 0.55 s with a per-comparison `Buffer.from`, and 0.05 s without.
 */

/** Bias a UTF-16 code unit into code point order. */
function toCodePointOrder(codeUnit: number): number {
  return codeUnit >= 0xd800 && codeUnit <= 0xdfff ? codeUnit + 0x10000 : codeUnit;
}

export function compareUtf8Bytewise(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  const sharedLength = Math.min(left.length, right.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const leftUnit = left.charCodeAt(index);
    const rightUnit = right.charCodeAt(index);
    if (leftUnit === rightUnit) {
      continue;
    }
    return toCodePointOrder(leftUnit) - toCodePointOrder(rightUnit);
  }
  return left.length - right.length;
}
