import { describe, expect, it } from 'vitest'
import { isPublicAddress, toV6Bytes } from '@/lib/importing/address'

describe('isPublicAddress — IPv4', () => {
  it('allows ordinary public addresses', () => {
    for (const address of ['1.1.1.1', '8.8.8.8', '93.184.216.34', '223.255.255.255']) {
      expect(isPublicAddress(address), address).toBe(true)
    }
  })

  it('refuses every reserved range', () => {
    const reserved = [
      '0.0.0.0',
      '10.0.0.1',
      '10.255.255.255',
      '100.64.0.1',
      '127.0.0.1',
      '127.1.2.3',
      '169.254.169.254', // cloud instance metadata — the one that matters most
      '172.16.0.1',
      '172.31.255.255',
      '192.0.0.1',
      '192.0.2.5',
      '192.88.99.1',
      '192.168.1.1',
      '198.18.0.1',
      '198.51.100.7',
      '203.0.113.9',
      '224.0.0.1',
      '240.0.0.1',
      '255.255.255.255',
    ]
    for (const address of reserved) {
      expect(isPublicAddress(address), address).toBe(false)
    }
  })

  it('allows the addresses just outside each private block', () => {
    // 172.16.0.0/12 ends at 172.31.255.255, so 172.32.0.0 is public. Getting
    // that boundary wrong is the classic off-by-one in this kind of check.
    for (const address of ['9.255.255.255', '11.0.0.0', '172.15.255.255', '172.32.0.0']) {
      expect(isPublicAddress(address), address).toBe(true)
    }
  })
})

describe('toV6Bytes', () => {
  it('expands a compressed address', () => {
    expect(Array.from(toV6Bytes('::1')!)).toEqual([...new Array(15).fill(0), 1])
  })

  it('expands a full address', () => {
    const bytes = toV6Bytes('2001:0db8:0000:0000:0000:0000:0000:0001')!
    expect(bytes[0]).toBe(0x20)
    expect(bytes[1]).toBe(0x01)
    expect(bytes[15]).toBe(1)
  })

  it('reads the IPv4 tail of a mapped address', () => {
    const bytes = toV6Bytes('::ffff:192.168.1.1')!
    expect(Array.from(bytes.slice(0, 10))).toEqual(new Array(10).fill(0))
    expect(Array.from(bytes.slice(10))).toEqual([0xff, 0xff, 192, 168, 1, 1])
  })

  it('reads the IPv4 tail of a compatible address, where `::` runs right up to it', () => {
    const bytes = toV6Bytes('::192.168.1.1')!
    expect(Array.from(bytes.slice(0, 12))).toEqual(new Array(12).fill(0))
    expect(Array.from(bytes.slice(12))).toEqual([192, 168, 1, 1])
  })

  it('reads an IPv4 tail written out in full', () => {
    const bytes = toV6Bytes('0:0:0:0:0:ffff:8.8.8.8')!
    expect(Array.from(bytes.slice(10))).toEqual([0xff, 0xff, 8, 8, 8, 8])
  })

  it('returns null for something that is not an IPv6 address', () => {
    expect(toV6Bytes('1.2.3.4')).toBeNull()
    expect(toV6Bytes('nonsense')).toBeNull()
  })
})

describe('isPublicAddress — IPv6', () => {
  it('allows global unicast', () => {
    for (const address of ['2001:4860:4860::8888', '2606:4700:4700::1111']) {
      expect(isPublicAddress(address), address).toBe(true)
    }
  })

  it('refuses loopback, link-local, unique-local and multicast', () => {
    for (const address of ['::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1']) {
      expect(isPublicAddress(address), address).toBe(false)
    }
  })

  it('sees through an IPv4-mapped private address', () => {
    // The whole point of the mapped-address case: this is 127.0.0.1 wearing a
    // different hat, and an allowlist on 2000::/3 alone would not catch it.
    expect(isPublicAddress('::ffff:127.0.0.1')).toBe(false)
    expect(isPublicAddress('::ffff:169.254.169.254')).toBe(false)
    expect(isPublicAddress('::ffff:8.8.8.8')).toBe(true)
    expect(isPublicAddress('::192.168.1.1')).toBe(false)
  })

  it('sees through 6to4 and NAT64 wrappers', () => {
    expect(isPublicAddress('2002:c0a8:0101::1')).toBe(false) // 192.168.1.1
    expect(isPublicAddress('2002:0808:0808::1')).toBe(true) // 8.8.8.8
    expect(isPublicAddress('64:ff9b::7f00:1')).toBe(false) // 127.0.0.1
  })

  it('refuses anything it cannot read', () => {
    expect(isPublicAddress('')).toBe(false)
    expect(isPublicAddress('example.com')).toBe(false)
    expect(isPublicAddress('2001::db8::1')).toBe(false)
  })
})
