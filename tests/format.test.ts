import { describe, expect, it } from 'vitest'
import { pValueClause, pValueText } from '@/lib/format'

describe('pValueText — the table-cell form', () => {
  it('rounds to three decimals under a column already headed "p"', () => {
    expect(pValueText(0.10842)).toBe('0.108')
    expect(pValueText(0.0456)).toBe('0.046')
  })

  it('reports below the threshold rather than printing a rounded zero', () => {
    // 0.000 in a cell reads as "no chance at all", which is a stronger claim
    // than the test can make.
    expect(pValueText(0.0009)).toBe('< 0.001')
    expect(pValueText(1e-12)).toBe('< 0.001')
  })

  it('has nothing to say when there is no comparison', () => {
    expect(pValueText(null)).toBe('—')
  })

  it('does not treat the threshold itself as below it', () => {
    expect(pValueText(0.001)).toBe('0.001')
  })
})

describe('pValueClause — the sentence form', () => {
  it('carries its own equals sign, so the sentence needs none', () => {
    expect(pValueClause(0.10842)).toBe('p = 0.108')
  })

  it('replaces the equals sign below the threshold instead of following it', () => {
    // The bug this exists to prevent: "at p = " + "< 0.001" reads
    // "at p = < 0.001". The operator moves, it does not stack.
    const clause = pValueClause(0.0009)
    expect(clause).toBe('p < 0.001')
    expect(`at ${clause}.`).toBe('at p < 0.001.')
    expect(clause).not.toContain('=')
  })

  it('never produces two operators in a row for any input', () => {
    for (const p of [0, 1e-9, 0.0009, 0.001, 0.049, 0.5, 1]) {
      expect(`at ${pValueClause(p)}.`).not.toMatch(/=\s*[<>]/)
    }
  })

  it('says so in words when there is no p-value to quote', () => {
    // A dash mid-sentence would read as a missing word rather than a missing
    // measurement.
    expect(pValueClause(null)).toBe('a p-value that cannot be computed yet')
    expect(pValueClause(null)).not.toContain('—')
  })

  it('agrees with the cell form on the number itself', () => {
    for (const p of [0.002, 0.049, 0.5, 0.999]) {
      expect(pValueClause(p)).toBe(`p = ${pValueText(p)}`)
    }
  })
})
