import Link from 'next/link'
import { getDatabase } from '@/lib/db'
import { listExperiments } from '@/lib/experiments'
import { isPublicDemo } from '@/lib/hosting'
import { NewExperimentForm } from './new-experiment-form'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const experiments = listExperiments(getDatabase(), 20)
  // Read on the server so the form knows without a round trip, and so a
  // visitor is told what is off before they try it rather than after.
  const demo = isPublicDemo()

  return (
    <main>
      <h1>Variant Lab</h1>
      <p className="lede">
        Paste a page, split its variants across visitors, measure what converts.
      </p>

      {demo && (
        <div className="notice">
          <strong>This is the shared demo.</strong> Everything works except importing a
          live URL, which is off because it would point this server at whatever address a
          stranger names. The seeded experiments below are the part worth opening —{' '}
          <span className="mono">Pricing page — headline and CTA</span> has a winner, a
          loser, and a variant nobody has been shown.{' '}
          <a href="https://github.com/vedhith/variant-lab">Clone the repo</a> for the
          version with nothing switched off.
        </div>
      )}

      <NewExperimentForm importDisabled={demo} />

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
