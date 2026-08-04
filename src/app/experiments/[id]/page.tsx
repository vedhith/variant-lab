import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getDatabase } from '@/lib/db'
import { assignmentCounts, findExperiment } from '@/lib/experiments'
import { expectedShares } from '@/lib/bucketing'

export const dynamic = 'force-dynamic'

export default async function ExperimentPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const db = getDatabase()
  const experiment = findExperiment(db, id)
  if (!experiment) notFound()

  const counts = assignmentCounts(db, id)
  const shares = expectedShares(experiment.variants)
  const totalAssigned = [...counts.values()].reduce((a, b) => a + b, 0)

  return (
    <main>
      <p className="muted">
        <Link href="/">← All experiments</Link>
      </p>

      <h1>{experiment.name}</h1>
      <p className="lede">
        {experiment.status} · {totalAssigned} visitor
        {totalAssigned === 1 ? '' : 's'} assigned ·{' '}
        <Link href={`/experiments/${experiment.id}/results`}>see results</Link>
      </p>
      <div className="mono">{experiment.id}</div>

      <h2>Variants</h2>
      {experiment.variants.map((variant) => {
        const assigned = counts.get(variant.id) ?? 0
        const expected = shares.get(variant.id) ?? 0
        const actual = totalAssigned === 0 ? 0 : assigned / totalAssigned

        return (
          <div key={variant.id} className="card">
            <div className="row">
              <strong>
                {variant.key}
                {variant.isControl ? ' (control)' : ''}
              </strong>
              <span className="muted">
                {variant.weight === 0 ? (
                  <>paused — weight 0, so it receives no traffic</>
                ) : (
                  <>
                    {assigned} assigned · {(actual * 100).toFixed(1)}% actual vs{' '}
                    {(expected * 100).toFixed(1)}% target
                  </>
                )}
              </span>
            </div>
            <pre>{variant.html}</pre>
          </div>
        )
      })}

      <h2>Assign a visitor</h2>
      <p className="muted">
        A page joins this experiment by POSTing its visitor id. The same id always
        comes back with the same variant.
      </p>
      <pre>{`curl -X POST http://localhost:3000/api/assign \\
  -H 'content-type: application/json' \\
  -d '{"experimentId":"${experiment.id}","visitorId":"visitor-1"}'`}</pre>
    </main>
  )
}
