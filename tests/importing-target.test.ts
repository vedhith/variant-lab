import { describe, expect, it } from 'vitest'
import { ValidationError } from '@/lib/experiments'
import { allowsPrivateHosts, assertPublicTarget, parseTargetUrl } from '@/lib/importing/target'

/** A DNS stand-in. Tests say what a name resolves to; nothing touches a resolver. */
function lookupOf(map: Record<string, string[]>) {
  return async (hostname: string) => {
    const addresses = map[hostname]
    if (!addresses) throw new Error('ENOTFOUND')
    return addresses
  }
}

const PUBLIC = lookupOf({ 'example.com': ['93.184.216.34'] })

describe('parseTargetUrl', () => {
  it('accepts http and https', () => {
    expect(parseTargetUrl('https://example.com/pricing').host).toBe('example.com')
    expect(parseTargetUrl('  http://example.com  ').protocol).toBe('http:')
  })

  it('requires a URL at all', () => {
    for (const input of ['', '   ', null, undefined, 42, {}]) {
      expect(() => parseTargetUrl(input)).toThrow(ValidationError)
    }
  })

  it('rejects a bare hostname, which is almost always a typo for https://', () => {
    expect(() => parseTargetUrl('example.com/pricing')).toThrow(/absolute URL/)
  })

  it('rejects protocols that are not the web', () => {
    for (const input of ['file:///etc/passwd', 'ftp://example.com', 'gopher://example.com']) {
      expect(() => parseTargetUrl(input)).toThrow(/http or https/)
    }
  })

  it('rejects embedded credentials rather than quietly storing them', () => {
    expect(() => parseTargetUrl('https://user:secret@example.com/')).toThrow(/credentials/)
    expect(() => parseTargetUrl('https://user@example.com/')).toThrow(/credentials/)
  })
})

describe('assertPublicTarget', () => {
  it('allows a name that resolves to a public address', async () => {
    await expect(
      assertPublicTarget(parseTargetUrl('https://example.com/'), PUBLIC, {}),
    ).resolves.toBeUndefined()
  })

  it('refuses a literal private address without asking DNS', async () => {
    const never = async () => {
      throw new Error('DNS should not have been consulted')
    }
    await expect(
      assertPublicTarget(parseTargetUrl('http://169.254.169.254/latest/meta-data/'), never, {}),
    ).rejects.toThrow(/not a public address/)
    await expect(
      assertPublicTarget(parseTargetUrl('http://127.0.0.1:5432/'), never, {}),
    ).rejects.toThrow(/not a public address/)
  })

  it('refuses a bracketed IPv6 loopback', async () => {
    await expect(assertPublicTarget(parseTargetUrl('http://[::1]:8080/'), PUBLIC, {})).rejects.toThrow(
      /not a public address/,
    )
  })

  it('refuses local hostnames by name, for a readable error', async () => {
    for (const url of [
      'http://localhost:3000/',
      'http://printer.local/',
      'http://db.internal/',
      'http://thing.home.arpa/',
    ]) {
      await expect(assertPublicTarget(parseTargetUrl(url), PUBLIC, {})).rejects.toThrow(
        /not a public host/,
      )
    }
  })

  it('refuses a public name that resolves somewhere private', async () => {
    // The case a hostname denylist cannot see: the name looks ordinary and the
    // answer is the loopback interface.
    const rebinding = lookupOf({ 'evil.example': ['127.0.0.1'] })
    await expect(
      assertPublicTarget(parseTargetUrl('https://evil.example/'), rebinding, {}),
    ).rejects.toThrow(/private address \(127\.0\.0\.1\)/)
  })

  it('refuses when any one of several addresses is private', async () => {
    // Otherwise this is just a way of asking which address the fetch picks.
    const mixed = lookupOf({ 'split.example': ['93.184.216.34', '10.0.0.5'] })
    await expect(
      assertPublicTarget(parseTargetUrl('https://split.example/'), mixed, {}),
    ).rejects.toThrow(/10\.0\.0\.5/)
  })

  it('treats a name that does not resolve as bad input, not a crash', async () => {
    await expect(
      assertPublicTarget(parseTargetUrl('https://nope.example/'), PUBLIC, {}),
    ).rejects.toThrow(/could not resolve/)
  })

  it('treats an empty answer as unresolved', async () => {
    await expect(
      assertPublicTarget(parseTargetUrl('https://empty.example/'), lookupOf({ 'empty.example': [] }), {}),
    ).rejects.toThrow(/could not resolve/)
  })

  it('lets the escape hatch through, for developing against a local page', async () => {
    await expect(
      assertPublicTarget(parseTargetUrl('http://localhost:3000/'), PUBLIC, {
        VARIANT_LAB_ALLOW_PRIVATE_HOSTS: '1',
      }),
    ).resolves.toBeUndefined()
  })

  it('keeps the escape hatch off unless it is asked for', () => {
    expect(allowsPrivateHosts({})).toBe(false)
    expect(allowsPrivateHosts({ VARIANT_LAB_ALLOW_PRIVATE_HOSTS: '0' })).toBe(false)
    expect(allowsPrivateHosts({ VARIANT_LAB_ALLOW_PRIVATE_HOSTS: 'no' })).toBe(false)
    expect(allowsPrivateHosts({ VARIANT_LAB_ALLOW_PRIVATE_HOSTS: '1' })).toBe(true)
    expect(allowsPrivateHosts({ VARIANT_LAB_ALLOW_PRIVATE_HOSTS: 'true' })).toBe(true)
  })
})
