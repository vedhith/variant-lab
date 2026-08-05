'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

interface Draft {
  /** Stable across re-keying so React does not remount a textarea mid-edit. */
  id: number
  key: string
  html: string
  rationale: string | null
}

interface ProviderInfo {
  provider: string
  needsApiKey: boolean
}

let nextDraftId = 1

/** "b", "c", "d" — matching the keys the server assigns to generated variants. */
function keyForIndex(index: number): string {
  return String.fromCharCode('b'.charCodeAt(0) + index)
}

function emptyDraft(index: number): Draft {
  return { id: nextDraftId++, key: keyForIndex(index), html: '', rationale: null }
}

/**
 * Authoring surface: paste a page, generate variants, edit them, run the test.
 *
 * Generated drafts land in editable textareas rather than going straight into
 * the experiment. Everything a model writes gets read by a person before a
 * visitor sees it — and a draft that is 90% right is worth fixing rather than
 * regenerating.
 */
export function NewExperimentForm() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [goal, setGoal] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [baselineHtml, setBaselineHtml] = useState('')
  const [count, setCount] = useState(2)
  const [drafts, setDrafts] = useState<Draft[]>([emptyDraft(0)])
  const [provider, setProvider] = useState<ProviderInfo | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  /**
   * Where the baseline in the textarea actually came from — the URL after
   * redirects, not the one that was typed. Cleared as soon as the HTML is
   * edited by hand, because at that point the experiment is no longer a
   * recording of that page and saying it was would be a small lie in the
   * record.
   */
  const [importedFrom, setImportedFrom] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/generate')
      .then((res) => (res.ok ? res.json() : null))
      .then((info: ProviderInfo | null) => {
        if (!cancelled && info) setProvider(info)
      })
      .catch(() => {
        // The form still works by hand if this never answers.
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function onImport() {
    setError(null)
    setNotice(null)
    setImporting(true)

    try {
      const res = await fetch('/api/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: sourceUrl }),
      })
      const body = await res.json()

      if (!res.ok) {
        setError(body.error ?? `import failed with ${res.status}`)
        return
      }

      setBaselineHtml(body.html)
      setImportedFrom(body.finalUrl)
      // Only fill a name that is still empty — an import should not overwrite
      // what someone has already decided to call the experiment.
      if (!name.trim() && body.title) setName(body.title)

      const size = `${Math.max(1, Math.round(body.bytes / 1024))} KB`
      setNotice(
        body.finalUrl === body.requestedUrl
          ? `Imported ${size} from ${body.finalUrl}. Read it before you generate from it.`
          : `Imported ${size} from ${body.finalUrl} (redirected there). Read it before you generate from it.`,
      )
    } catch {
      setError('could not reach the server')
    } finally {
      setImporting(false)
    }
  }

  function onBaselineChange(html: string) {
    setBaselineHtml(html)
    if (importedFrom) setImportedFrom(null)
  }

  async function onGenerate() {
    setError(null)
    setNotice(null)
    setGenerating(true)

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ baselineHtml, goal: goal || null, count }),
      })
      const body = await res.json()

      if (!res.ok) {
        setError(body.error ?? `generation failed with ${res.status}`)
        return
      }

      setDrafts(
        body.variants.map((variant: { key: string; html: string; rationale: string }) => ({
          id: nextDraftId++,
          key: variant.key,
          html: variant.html,
          rationale: variant.rationale,
        })),
      )
      setNotice(
        body.short
          ? `${body.provider} had ${body.variants.length} idea${
              body.variants.length === 1 ? '' : 's'
            } for this page — fewer than the ${count} asked for.`
          : `${body.variants.length} drafts from ${body.provider}. Edit anything before you run it.`,
      )
    } catch {
      setError('could not reach the server')
    } finally {
      setGenerating(false)
    }
  }

  function updateDraft(id: number, html: string) {
    setDrafts((current) => current.map((d) => (d.id === id ? { ...d, html } : d)))
  }

  function removeDraft(id: number) {
    setDrafts((current) =>
      current
        .filter((d) => d.id !== id)
        .map((d, index) => ({ ...d, key: keyForIndex(index) })),
    )
  }

  function addDraft() {
    setDrafts((current) => [...current, emptyDraft(current.length)])
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setNotice(null)

    const filled = drafts.filter((d) => d.html.trim())
    if (filled.length === 0) {
      setError('add at least one variant — generate some, or write one by hand')
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/experiments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          baselineHtml,
          sourceUrl: importedFrom,
          status: 'running',
          variants: [
            { key: 'control', html: baselineHtml, isControl: true },
            ...filled.map((draft, index) => ({ key: keyForIndex(index), html: draft.html })),
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

      <label htmlFor="source-url">Import a page (optional)</label>
      <div className="row generate-row">
        <input
          id="source-url"
          type="url"
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          placeholder="https://example.com/pricing"
        />
        <button type="button" onClick={onImport} disabled={importing || !sourceUrl.trim()}>
          {importing ? 'Fetching…' : 'Fetch page'}
        </button>
      </div>
      <p className="muted small">
        Fetches the page and fills the baseline below with its content. Public URLs only, and
        everything is editable afterwards — or skip this and paste your own HTML.
      </p>

      <label htmlFor="baseline">Baseline HTML (control)</label>
      <textarea
        id="baseline"
        value={baselineHtml}
        onChange={(e) => onBaselineChange(e.target.value)}
        placeholder="<h1>Ship faster</h1>"
        required
      />
      {importedFrom && (
        <p className="muted small">
          Imported from <span className="mono">{importedFrom}</span> — saved with the experiment.
        </p>
      )}

      <label htmlFor="goal">Conversion goal (optional)</label>
      <input
        id="goal"
        value={goal}
        onChange={(e) => setGoal(e.target.value)}
        placeholder="start a free trial"
      />

      <div className="row generate-row">
        <button type="button" onClick={onGenerate} disabled={generating || !baselineHtml.trim()}>
          {generating ? 'Generating…' : 'Generate variants'}
        </button>
        <label htmlFor="count" className="inline">
          how many
        </label>
        <select
          id="count"
          value={count}
          onChange={(e) => setCount(Number(e.target.value))}
          className="narrow"
        >
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>

      {provider && (
        <p className="muted small">
          Generating with <span className="mono">{provider.provider}</span>
          {provider.needsApiKey
            ? ' — your API key, your model.'
            : ' — deterministic copy rules, no API key needed. Set ANTHROPIC_API_KEY for model-written variants.'}
        </p>
      )}

      {drafts.map((draft, index) => (
        <div key={draft.id} className="draft">
          <div className="row">
            <label htmlFor={`variant-${draft.id}`} className="inline">
              Variant {draft.key}
            </label>
            {drafts.length > 1 && (
              <button type="button" className="link" onClick={() => removeDraft(draft.id)}>
                remove
              </button>
            )}
          </div>
          {draft.rationale && <p className="muted small">{draft.rationale}</p>}
          <textarea
            id={`variant-${draft.id}`}
            value={draft.html}
            onChange={(e) => updateDraft(draft.id, e.target.value)}
            placeholder={index === 0 ? '<h1>Ship on Friday without fear</h1>' : ''}
          />
        </div>
      ))}

      <div className="row generate-row">
        <button type="button" className="link" onClick={addDraft}>
          + add a variant by hand
        </button>
      </div>

      <button type="submit" disabled={submitting}>
        {submitting ? 'Creating…' : 'Create experiment'}
      </button>

      {notice && <div className="notice">{notice}</div>}
      {error && <div className="error">{error}</div>}
    </form>
  )
}
