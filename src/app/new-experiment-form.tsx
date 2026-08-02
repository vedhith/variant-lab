'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

/**
 * Week-1 authoring surface: a baseline plus two hand-written variants.
 * LLM generation replaces the two textareas in the next slice; the shape of
 * what gets POSTed does not change when it does.
 */
export function NewExperimentForm() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [baselineHtml, setBaselineHtml] = useState('')
  const [variantHtml, setVariantHtml] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)

    try {
      const res = await fetch('/api/experiments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          baselineHtml,
          status: 'running',
          variants: [
            { key: 'control', html: baselineHtml, isControl: true },
            { key: 'b', html: variantHtml },
          ],
        }),
      })

      const body = await res.json()
      if (!res.ok) {
        setError(body.error ?? `request failed with ${res.status}`)
        return
      }

      router.push(`/experiments/${body.experiment.id}`)
    } catch {
      setError('could not reach the server')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <label htmlFor="name">Experiment name</label>
      <input
        id="name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Pricing page headline"
        required
      />

      <label htmlFor="baseline">Baseline HTML (control)</label>
      <textarea
        id="baseline"
        value={baselineHtml}
        onChange={(e) => setBaselineHtml(e.target.value)}
        placeholder="<h1>Ship faster</h1>"
        required
      />

      <label htmlFor="variant">Variant B HTML</label>
      <textarea
        id="variant"
        value={variantHtml}
        onChange={(e) => setVariantHtml(e.target.value)}
        placeholder="<h1>Ship on Friday without fear</h1>"
        required
      />

      <button type="submit" disabled={submitting}>
        {submitting ? 'Creating…' : 'Create experiment'}
      </button>

      {error && <div className="error">{error}</div>}
    </form>
  )
}
