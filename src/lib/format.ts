/**
 * Formatting a p-value for a reader.
 *
 * These live outside the results page because the same number has to be
 * written two different ways depending on where it lands, and getting that
 * wrong is the kind of thing that only shows up in a screenshot. They are
 * separated from the other formatters in the page for the same reason: this
 * pair has a rule between them worth pinning in a test.
 */

/**
 * Table-cell form, for a column already headed "p".
 *
 * The header carries the name, so the cell carries only the value and, below
 * the reporting threshold, the operator that qualifies it.
 */
export const pValueText = (p: number | null): string =>
  p === null ? '—' : p < 0.001 ? '< 0.001' : p.toFixed(3)

/**
 * Sentence form, for prose that has to read aloud.
 *
 * `pValueText` cannot be dropped after "at p = ": below the threshold it yields
 * "at p = < 0.001", which has two operators where it needs one. So in a
 * sentence the operator replaces the equals sign rather than following it, and
 * the clause carries its own "p".
 */
export const pValueClause = (p: number | null): string =>
  p === null
    ? 'a p-value that cannot be computed yet'
    : p < 0.001
      ? 'p < 0.001'
      : `p = ${p.toFixed(3)}`
