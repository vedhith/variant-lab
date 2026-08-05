/** Types and failures shared by the URL importer. */

/**
 * The fetch itself went wrong: the site was unreachable, answered with an
 * error, served something that is not a page, or sent more than we will read.
 * Not the caller's fault — the URL was well formed — so it surfaces as a 502,
 * the same way a failing model provider does.
 */
export class ImportError extends Error {}

/**
 * The page came back fine and had nothing in it worth testing. Retrying will
 * get the same answer, so it is a 422 rather than a 502, matching how the
 * generator reports "I ran and found nothing".
 */
export class EmptyPageError extends ImportError {}

export interface ImportedPage {
  /** The URL as the caller gave it, after normalisation. */
  requestedUrl: string
  /** Where the fetch actually ended up, after any redirects. */
  finalUrl: string
  /** The page's title, for naming the experiment. Null when it has none. */
  title: string | null
  /** Extracted, sanitized markup, ready to be used as a baseline. */
  html: string
  /** Size of `html` in bytes — the number the size limits are about. */
  bytes: number
  /** How many redirects were followed to get there. */
  redirects: number
}
