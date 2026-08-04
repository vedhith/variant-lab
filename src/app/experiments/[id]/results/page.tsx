import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getDatabase } from '@/lib/db'
import { NotFoundError } from '@/lib/experiments'
import { DEFAULT_EVENT_NAME, eventNames } from '@/lib/events'
import { experimentResults, type VariantResult } from '@/lib/results'
import type { Interval } from '@/lib/stats'

export const dynamic = 'force-dynamic'

/** A negative lift gets a real minus sign, to match the percentage-point column. */
const percent = (value: number): string =>
  `${value < 0 ? '−' : ''}${(Math.abs(value) * 100).toFixed(1)}%`

/** Percentage-point differences carry their sign — "+1.4 pp" reads faster than "0.014". */
const points = (value: number): string =>
  `${value >= 0 ? '+' : '−'}${Math.abs(value * 100).toFixed(1)} pp`

const intervalText = (interval: Interval | null, format: (n: number) => string): string =>
  interval === null ? '—' : `${format(interval.low)} to ${format(interval.high)}`

const pValueText = (p: number | null): string =>
  p === null ? '—' : p < 0.001 ? '< 0.001' : p.toFixed(3)

/** What this row means, in words, for someone who does not read p-values. */
function verdict(variant: VariantResult): string {
  if (variant.isControl) return 'baseline'
  const comparison = variant.comparison
  if (comparison === null || comparison.pValue === null) return 'not enough traffic'
  const difference = comparison.absoluteDifference ?? 0
  if (comparison.significant) {
    return difference > 0 ? 'beating control' : 'losing to control'
  }
  if (difference === 0) return 'tied with control'
  return 'too close to call'
}

/** The lift cell: percentage points, plus the relative figure when it means something. */
function liftText(variant: VariantResult): string {
  const comparison = variant.comparison
  if (comparison === null || comparison.absoluteDifference === null) return '—'
  const difference = points(comparison.absoluteDifference)
  return comparison.lift === null ? difference : `${difference} (${percent(comparison.lift)})`
}

export default async function ResultsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ event?: string }>
}) {
  const { id } = await params
  const { event } = await searchParams
  const db = getDatabase()

  let results
  try {
    results = experimentResults(db, id, event)
  } catch (err) {
    if (err instanceof NotFoundError) notFound()
    throw err
  }

  const names = eventNames(db, id)
  const otherNames = names.filter((n) => n.name !== results.eventName)

  return (
    <main>
      <p className="muted">
        <Link href={`/experiments/${id}`}>← {results.name}</Link>
      </p>

      <h1>Results</h1>
      <p className="lede">
        {results.totals.visitors} visitor{results.totals.visitors === 1 ? '' : 's'} ·{' '}
        {results.totals.conversions} conversion
        {results.totals.conversions === 1 ? '' : 's'} · {percent(results.totals.rate)} overall
        · counting <span className="mono">{results.eventName}</span>
      </p>

      {otherNames.length > 0 && (
        <p className="muted">
          Also recorded:{' '}
          {otherNames.map((n, index) => (
            <span key={n.name}>
              {index > 0 && ', '}
              <Link href={`/experiments/${id}/results?event=${encodeURIComponent(n.name)}`}>
                {n.name}
              </Link>{' '}
              ({n.count})
            </span>
          ))}
        </p>
      )}

      {results.totals.visitors === 0 ? (
        <div className="card">
          <p>
            No visitors yet. Assign one through <span className="mono">POST /api/assign</span>,
            then record a conversion for it — the numbers appear here as soon as they exist.
          </p>
        </div>
      ) : (
        <>
          <div className="card">
            {results.leader ? (
              <p>
                <strong>{results.leader.key}</strong> is ahead of the control by{' '}
                {points(results.leader.comparison?.absoluteDifference ?? 0)}
                {results.leader.comparison?.lift !== null &&
                results.leader.comparison !== null ? (
                  <> ({percent(results.leader.comparison.lift ?? 0)} relative)</>
                ) : null}
                , at p = {pValueText(results.leader.comparison?.pValue ?? null)}.
              </p>
            ) : (
              <p>
                No variant has separated from the control yet. Either difference is real and
                needs more traffic, or there is nothing to find.
              </p>
            )}
          </div>

          <h2>Per variant</h2>
          <div className="scroll-x">
            <table className="results">
              <thead>
                <tr>
                  <th>Variant</th>
                  <th>Visitors</th>
                  <th>Conversions</th>
                  <th>Rate</th>
                  <th>95% interval</th>
                  <th>Lift</th>
                  <th>Difference</th>
                  <th>p</th>
                  <th>Verdict</th>
                </tr>
              </thead>
              <tbody>
                {results.variants.map((variant) => (
                  <tr key={variant.variantId}>
                    <td>
                      <strong>{variant.key}</strong>
                      {variant.isControl ? <span className="muted"> control</span> : null}
                    </td>
                    <td>{variant.visitors}</td>
                    <td>{variant.conversions}</td>
                    <td>{percent(variant.rate)}</td>
                    <td className="muted">{intervalText(variant.interval, percent)}</td>
                    <td>{liftText(variant)}</td>
                    <td className="muted">
                      {intervalText(variant.comparison?.differenceInterval ?? null, points)}
                    </td>
                    <td>{pValueText(variant.comparison?.pValue ?? null)}</td>
                    <td className="muted">{verdict(variant)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="muted">
            Rates carry a 95% Wilson interval; a variant is compared to the control with a
            two-proportion test. A conversion counts a visitor once, however many times they
            fire the event.
          </p>
        </>
      )}

      <h2>Record a conversion</h2>
      <pre>{`curl -X POST http://localhost:3000/api/events \\
  -H 'content-type: application/json' \\
  -d '{"experimentId":"${results.experimentId}","visitorId":"visitor-1","name":"${DEFAULT_EVENT_NAME}"}'`}</pre>
    </main>
  )
}
