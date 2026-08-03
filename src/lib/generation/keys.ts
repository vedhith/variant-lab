/**
 * Variant keys.
 *
 * The control is always "control"; generated variants are "b", "c", … so the
 * results table reads the way people talk about a test ("b is winning"). Past
 * "z" it falls back to a numbered key rather than inventing a second letter,
 * because a 26-variant experiment is a mistake worth making obvious.
 */
export function variantKey(index: number): string {
  if (index < 0) throw new RangeError('variant index must be non-negative')
  if (index < 25) return String.fromCharCode('b'.charCodeAt(0) + index)
  return `v${index + 2}`
}
