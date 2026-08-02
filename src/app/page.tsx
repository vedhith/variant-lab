import Link from 'next/link'
import { getDatabase } from '@/lib/db'
import { listExperiments } from '@/lib/experiments'
import { NewExperimentForm } from './new-experiment-form'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const experiments = listExperiments(getDatabase(), 20)

  return (
    <main>
      <h1>Variant Lab</h1>
      <p className="lede">
        Paste a page, split its variants across visitors, measure what converts.
      </p>

      <NewExperimentForm />

      <h2>Experiments</h2>
      {experiments.length === 0 ? (
        <p className="muted">Nothing yet — create one above.</p>
      ) : (
        <ul className="plain">
          {experiments.map((experiment) => (
            <li key={experiment.id} className="card">
              <div className="row">
                <Link href={`/experiments/${experiment.id}`}>{experiment.name}</Link>
                <span className="muted">{experiment.status}</span>
              </div>
              <div className="mono">{experiment.id}</div>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
