/**
 * Turning a string somebody typed into a URL the server is allowed to fetch.
 *
 * Two checks, in this order and for different reasons. The shape check rejects
 * things that are not fetchable pages at all — a `file:` URL, a URL carrying
 * credentials. The address check resolves the hostname and refuses anything
 * that points back inside the network the server is sitting in.
 */

import { lookup as dnsLookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { ValidationError } from '../experiments'
import { isPublicAddress } from './address'

/** Resolve a hostname to its addresses. Injected so tests never touch DNS. */
export type Lookup = (hostname: string) => Promise<string[]>

export const defaultLookup: Lookup = async (hostname) => {
  const results = await dnsLookup(hostname, { all: true, verbatim: true })
  return results.map((r) => r.address)
}

/**
 * Hosts refused by name, before DNS is consulted.
 *
 * The address check below catches these anyway once they resolve — this is
 * about the error message. "localhost is not a public host" is a better answer
 * than a DNS failure, and `.local`/`.internal` names often do not resolve from
 * the server at all, which would otherwise read as "the site is down".
 */
const PRIVATE_SUFFIXES = ['.local', '.localhost', '.internal', '.home.arpa']
const PRIVATE_NAMES = ['localhost']

/**
 * Parse and shape-check a URL.
 *
 * Credentials are rejected rather than stripped: `http://user:pass@host/`
 * usually means someone pasted something they did not mean to hand to a server
 * that will store it in an experiment record.
 */
export function parseTargetUrl(raw: unknown): URL {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new ValidationError('url is required')
  }
  const text = raw.trim()

  let url: URL
  try {
    url = new URL(text)
  } catch {
    throw new ValidationError('url must be an absolute URL, including http:// or https://')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ValidationError('url must be http or https')
  }
  if (url.username || url.password) {
    throw new ValidationError('url must not contain credentials')
  }
  if (!url.hostname) {
    throw new ValidationError('url must have a hostname')
  }

  return url
}

/** True when the escape hatch for fetching private hosts is on. */
export function allowsPrivateHosts(env: Record<string, string | undefined> = process.env): boolean {
  const flag = env.VARIANT_LAB_ALLOW_PRIVATE_HOSTS?.trim().toLowerCase()
  return flag === '1' || flag === 'true'
}

/**
 * Refuse a URL that resolves anywhere but the public internet.
 *
 * Every address behind the hostname has to pass, not just the first: a name
 * that resolves to one public address and one loopback address is a way of
 * asking which one the fetch will happen to pick.
 *
 * **Known limit.** The name is resolved here and the connection is made a
 * moment later by `fetch`, which resolves it again. A DNS entry that changes
 * between those two moments — a rebinding attack — would defeat this. Closing
 * that hole means pinning the connection to the address checked, which needs a
 * custom agent per request; for a tool you run on your own machine against
 * pages you chose, the check is the honest 95% and this comment is the rest.
 */
export async function assertPublicTarget(
  url: URL,
  lookup: Lookup = defaultLookup,
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  if (allowsPrivateHosts(env)) return

  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()

  if (isIP(hostname)) {
    if (!isPublicAddress(hostname)) {
      throw new ValidationError(`${hostname} is not a public address`)
    }
    return
  }

  if (
    PRIVATE_NAMES.includes(hostname) ||
    PRIVATE_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  ) {
    throw new ValidationError(`${hostname} is not a public host`)
  }

  let addresses: string[]
  try {
    addresses = await lookup(hostname)
  } catch {
    throw new ValidationError(`could not resolve ${hostname}`)
  }

  if (addresses.length === 0) {
    throw new ValidationError(`could not resolve ${hostname}`)
  }

  const blocked = addresses.filter((address) => !isPublicAddress(address))
  if (blocked.length > 0) {
    throw new ValidationError(`${hostname} resolves to a private address (${blocked[0]})`)
  }
}
