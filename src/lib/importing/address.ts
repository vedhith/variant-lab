/**
 * Is an IP address one we are willing to fetch from?
 *
 * The import endpoint takes a URL from whoever is using the app and asks the
 * server to fetch it. That is a request forgery primitive unless it is fenced
 * in: on a hosted box, `http://169.254.169.254/` is the cloud metadata service
 * and `http://127.0.0.1:5432` is the database. So the decision is made on the
 * *address*, after DNS, not on the hostname — `metadata.example.com` can
 * resolve to a link-local address, and a hostname denylist would never know.
 *
 * The two families get opposite treatments, because that is where each one is
 * tractable. IPv4 has a short, stable list of reserved ranges, so it is a
 * denylist. IPv6 has an enormous address space in which exactly one block is
 * ordinary public unicast, so it is an allowlist of `2000::/3` — anything
 * unrecognised is refused rather than assumed routable.
 */

import { isIP } from 'node:net'

/** An IPv4 range expressed as a dotted prefix and its length in bits. */
type Cidr4 = readonly [prefix: string, bits: number]

/**
 * IPv4 ranges that are never a legitimate fetch target (RFC 6890 and friends).
 * Each is here because reaching it from a server means reaching something the
 * person who typed the URL is not supposed to see.
 */
const RESERVED_V4: readonly Cidr4[] = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback — the server's own services
  ['169.254.0.0', 16], // link-local — cloud instance metadata lives here
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // TEST-NET-1
  ['192.88.99.0', 24], // 6to4 relay anycast
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24], // TEST-NET-3
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, and 255.255.255.255 with it
]

/** Dotted quad to a 32-bit unsigned integer. Returns null if it is not one. */
function toV4Int(address: string): number | null {
  if (isIP(address) !== 4) return null
  const octets = address.split('.').map(Number)
  return ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0
}

function inRange4(value: number, prefix: string, bits: number): boolean {
  const base = toV4Int(prefix)
  if (base === null) return false
  // A /0 would shift by 32, which JavaScript wraps to a shift by 0.
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
  return (value & mask) === (base & mask)
}

/**
 * Expand any IPv6 literal into its 16 bytes.
 *
 * Handles `::` compression and a trailing dotted-quad (`::ffff:10.0.0.1`),
 * which is exactly the form used to smuggle a private IPv4 address past a
 * check that only looks at IPv4.
 */
export function toV6Bytes(address: string): Uint8Array | null {
  if (isIP(address) !== 6) return null

  let text = address
  const tail: number[] = []

  // A trailing IPv4 part occupies the last four bytes. Cut it off entirely
  // rather than substituting zero groups for it: those four bytes are already
  // accounted for by `tail`, and writing them twice would shift every group
  // ahead of them — which is how `::ffff:1.2.3.4` stops looking mapped.
  const lastColon = text.lastIndexOf(':')
  const trailing = text.slice(lastColon + 1)
  if (trailing.includes('.')) {
    const embedded = toV4Int(trailing)
    if (embedded === null) return null
    tail.push((embedded >>> 24) & 0xff, (embedded >>> 16) & 0xff, (embedded >>> 8) & 0xff, embedded & 0xff)
    // Keep the second colon of a `::` run, or `::1.2.3.4` loses its compression.
    text = text.slice(0, text[lastColon - 1] === ':' ? lastColon + 1 : lastColon)
  }

  const halves = text.split('::')
  if (halves.length > 2) return null

  const parseGroups = (part: string): number[] | null => {
    if (!part) return []
    const groups: number[] = []
    for (const piece of part.split(':')) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(piece)) return null
      groups.push(parseInt(piece, 16))
    }
    return groups
  }

  const head = parseGroups(halves[0])
  const rest = parseGroups(halves.length === 2 ? halves[1] : '')
  if (!head || !rest) return null

  const groupCount = 8 - tail.length / 2
  const gap = groupCount - head.length - rest.length
  if (halves.length === 2 ? gap < 0 : gap !== 0) return null

  const groups = [...head, ...new Array<number>(halves.length === 2 ? gap : 0).fill(0), ...rest]
  const bytes = new Uint8Array(16)
  groups.forEach((group, i) => {
    bytes[i * 2] = (group >>> 8) & 0xff
    bytes[i * 2 + 1] = group & 0xff
  })
  tail.forEach((byte, i) => {
    bytes[12 + i] = byte
  })
  return bytes
}

function v4FromBytes(bytes: Uint8Array, offset: number): string {
  return `${bytes[offset]}.${bytes[offset + 1]}.${bytes[offset + 2]}.${bytes[offset + 3]}`
}

/**
 * True when this address is on the public internet and safe to fetch.
 *
 * Anything unparseable is refused: a check that cannot read an address has not
 * cleared it.
 */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) {
    const value = toV4Int(address)
    if (value === null) return false
    return !RESERVED_V4.some(([prefix, bits]) => inRange4(value, prefix, bits))
  }
  if (family !== 6) return false

  const bytes = toV6Bytes(address)
  if (!bytes) return false

  // Forms that carry an IPv4 address inside them are judged as that address,
  // or a private v4 target would sail through the v6 allowlist below.
  const isV4Mapped =
    bytes.slice(0, 10).every((b) => b === 0) && bytes[10] === 0xff && bytes[11] === 0xff
  if (isV4Mapped) return isPublicAddress(v4FromBytes(bytes, 12))

  // 64:ff9b::/96 — NAT64.
  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b) {
    return isPublicAddress(v4FromBytes(bytes, 12))
  }

  // 2002::/16 — 6to4, which embeds its IPv4 address in the next four bytes.
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return isPublicAddress(v4FromBytes(bytes, 2))

  // Everything else must be inside 2000::/3, global unicast. Loopback (::1),
  // unique-local (fc00::/7), link-local (fe80::/10) and multicast (ff00::/8)
  // all fall outside it, as does anything IANA has not handed out yet.
  return (bytes[0] & 0xe0) === 0x20
}
