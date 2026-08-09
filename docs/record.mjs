/**
 * Record `docs/demo.gif` — the README's animated demo.
 *
 * The three stills in this directory show the *answer*: a finished results page
 * with a winner, a loser, and a variant nobody was shown. What they cannot show
 * is the loop that produces it — that you paste a page, the variants get
 * drafted for you, traffic splits itself, and a verdict comes back. That loop
 * is the pitch, so it gets a moving picture.
 *
 * This is one continuous take against a real server. Nothing is spliced: the
 * experiment in the recording is created through the form, the traffic is real
 * HTTP against `/api/assign` and `/api/events`, and the results page at the end
 * is that experiment's own. There is no fixture and no mock anywhere in it.
 *
 *   npm run build && npm run seed && npm start   # terminal 1
 *   npm i --no-save playwright                   # terminal 2
 *   pip install Pillow
 *   node docs/record.mjs
 *
 * `--no-save` leaves package.json and the lockfile untouched, and node_modules
 * is gitignored, so nothing about this reaches the repo. Playwright is not a
 * dependency of this project for the same reason it is not one in
 * `capture.mjs`: a browser download is a lot to impose on every clone and every
 * CI run for a handful of static assets.
 *
 * Frames come out of Playwright's bundled ffmpeg, which is compiled with
 * `--disable-everything` and can write PNGs but not GIFs, so Pillow does the
 * palette and the assembly.
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, readdirSync, existsSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'

const BASE = process.env.VARIANT_LAB_URL ?? 'http://localhost:3000'
const OUT = new URL('.', import.meta.url).pathname
const GIF = join(OUT, 'demo.gif')

/** Final GIF geometry. Wide enough to read the rationale, narrow enough to commit. */
const WIDTH = 1280
const HEIGHT = 800
const GIF_WIDTH = 800
const FPS = 10
const COLORS = 96

/**
 * The page under test. Deliberately short: the whole point of the recording is
 * that a reader can follow what changed between the baseline and each draft,
 * and they cannot do that if the textarea holds a real landing page.
 *
 * It is also chosen to give the offline `rules` generator something to find —
 * an intensifier in the headline and a vague call to action — so the recording
 * needs no API key and drafts the same two variants every time.
 */
const BASELINE = `<h1>The really simple way to track your team's expenses</h1>
<p>Receipts in, reports out. No spreadsheets.</p>
<a href="/signup">Learn more</a>`

/**
 * How often each arm converts, once a visitor has been assigned to it.
 *
 * These are *exact* shares of each arm, not probabilities — see `runTraffic`
 * for why. b beats the control by 8 points, which across this much traffic is
 * significant with room to spare; c is a point above it, which is not, and is
 * in the recording on purpose. A demo where every variant wins teaches the
 * reader nothing about what the page does when one does not.
 */
const RATES = { control: 0.08, b: 0.16, c: 0.09 }
const VISITORS = 900
const CONCURRENCY = 64

/** FNV-1a over the visitor id, scaled into [0, 1). */
function hashUnit(text) {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash / 0x100000000
}

async function post(path, body) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`POST ${path} → ${res.status} ${await res.text()}`)
  return res.json()
}

/**
 * Send real visitors through the real endpoints: `/api/assign` for every one of
 * them, then `/api/events` for the ones that convert. The server decides which
 * arm each visitor lands in — nothing here reaches past the HTTP API, and the
 * results page at the end is reading rows this traffic actually wrote.
 *
 * **Why the conversions are dealt rather than drawn.** The obvious version of
 * this rolls a die per visitor against their arm's rate. That was the first
 * version, and it produced a recording whose ending changed from take to take:
 * `createExperiment` mints a random experiment id, bucketing hashes that id, so
 * which visitors land in which arm is different every time — and with three
 * hundred per arm the sampling noise on the difference is wide enough to swing
 * a real effect in and out of significance. One take ended on "b is ahead by
 * +8.0 pp"; the next ended on "no variant has separated from the control yet".
 * Both were honest readings of their own traffic and useless as a demo, because
 * a recording nobody can reproduce cannot be re-recorded when the UI changes.
 *
 * So each arm converts an exact share of the visitors it was given, chosen by
 * hashing the visitor ids and taking the lowest — deterministic, spread across
 * the arm rather than clustered at the front, and independent of how the arms
 * happened to divide. What is being pinned is the *traffic*, which is demo data
 * either way; every number on the results page is still computed by the app
 * from rows it stored itself.
 */
async function runTraffic(experimentId) {
  const ids = Array.from({ length: VISITORS }, (_, i) => `rec-${i}`)
  const arms = new Map()

  await pooled(ids, async (visitorId) => {
    const { variant } = await post('/api/assign', { experimentId, visitorId })
    if (!arms.has(variant.key)) arms.set(variant.key, [])
    arms.get(variant.key).push(visitorId)
  })

  const converting = []
  for (const [key, visitors] of arms) {
    const wanted = Math.round((RATES[key] ?? 0) * visitors.length)
    const ordered = [...visitors].sort((a, b) => hashUnit(a) - hashUnit(b))
    converting.push(...ordered.slice(0, wanted))
  }

  await pooled(converting, (visitorId) =>
    post('/api/events', { experimentId, visitorId, type: 'conversion' }),
  )
}

/** Run `task` over `items` with a fixed number of workers in flight. */
async function pooled(items, task) {
  let cursor = 0
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (cursor < items.length) await task(items[cursor++])
    }),
  )
}

/**
 * Find an ffmpeg. Playwright ships one next to the browsers it downloads, which
 * is the one to prefer — it is guaranteed present wherever Playwright is, and
 * it is the build that wrote the video. A system ffmpeg is the fallback, and is
 * the better of the two if you have it, since Playwright's is compiled with
 * `--disable-everything` and only just manages PNG output.
 */
function ffmpegPath() {
  if (process.env.FFMPEG) return process.env.FFMPEG

  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    join(homedir(), '.cache/ms-playwright'),
    join(homedir(), 'Library/Caches/ms-playwright'),
  ].filter(Boolean)

  for (const root of roots) {
    let entries = []
    try {
      entries = readdirSync(root)
    } catch {
      continue
    }
    for (const entry of entries.filter((name) => name.startsWith('ffmpeg')).sort().reverse()) {
      for (const binary of ['ffmpeg-linux', 'ffmpeg-mac', 'ffmpeg-win64.exe', 'ffmpeg']) {
        const path = join(root, entry, binary)
        if (existsSync(path)) return path
      }
    }
  }

  throw new Error(
    'no ffmpeg found — install playwright (`npm i --no-save playwright`), or set FFMPEG to a system build',
  )
}

async function main() {
  const work = mkdtempSync(join(tmpdir(), 'variant-lab-record-'))
  const frames = join(work, 'frames')

  // `CHROMIUM` is for machines that already have a browser Playwright did not
  // download — the npm package pins an exact build and refuses anything else,
  // which turns a working Chromium into a 150 MB re-download for one recording.
  const browser = await chromium.launch(
    process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {},
  )
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    recordVideo: { dir: work, size: { width: WIDTH, height: HEIGHT } },
  })
  const page = await context.newPage()

  try {
    // --- beat 1: an ordinary instance, with the authoring form on it ----------
    const home = await page.goto(BASE, { waitUntil: 'networkidle' })
    if (home?.status() !== 200) {
      throw new Error(`${BASE} returned ${home?.status() ?? 'nothing'} — is the server running?`)
    }
    await page.waitForTimeout(1200)

    // --- beat 2: describe the test -------------------------------------------
    await page.fill('#name', '')
    await page.type('#name', 'Expenses page — headline and CTA', { delay: 28 })
    await page.waitForTimeout(250)

    // Pasted rather than typed: nobody types HTML, and watching them do it is
    // eleven seconds of GIF that says nothing.
    await page.fill('#baseline', BASELINE)
    await page.waitForTimeout(500)
    await page.type('#goal', 'start a free trial', { delay: 28 })
    await page.waitForTimeout(600)

    // --- beat 3: the variants get drafted ------------------------------------
    await page.getByRole('button', { name: 'Generate variants' }).click()
    await page.waitForSelector('.draft .muted.small', { timeout: 15_000 })
    await page.waitForTimeout(400)
    // Bring the drafts and their rationale into frame — this is the beat the
    // whole recording exists for.
    await page.getByLabel('Variant b').scrollIntoViewIfNeeded()
    await page.waitForTimeout(3200)

    // --- beat 4: run it ------------------------------------------------------
    const create = page.getByRole('button', { name: 'Create experiment' })
    await create.scrollIntoViewIfNeeded()
    await page.waitForTimeout(500)
    await create.click()
    await page.waitForURL(/\/experiments\/exp_/, { timeout: 15_000 })
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1400)

    const experimentId = new URL(page.url()).pathname.split('/').pop()

    // --- beat 5: real visitors arrive ----------------------------------------
    await runTraffic(experimentId)
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForTimeout(1800)

    // --- beat 6: the verdict -------------------------------------------------
    await page.getByRole('link', { name: 'see results' }).click()
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(600)
    await page.getByRole('table').scrollIntoViewIfNeeded().catch(() => {})
    await page.waitForTimeout(3600)
  } finally {
    await context.close() // flushes the video
    await browser.close()
  }

  const webm = readdirSync(work).find((name) => name.endsWith('.webm'))
  if (!webm) throw new Error('playwright wrote no video')

  const ffmpeg = ffmpegPath()
  execFileSync('mkdir', ['-p', frames])
  // `-r` rather than the `fps` filter on purpose: Playwright's ffmpeg enables
  // three filters and `fps` is not one of them, so the filter form fails with a
  // bare exit code and no message. Output frame rate needs no filter at all.
  execFileSync(ffmpeg, [
    '-i', join(work, webm),
    '-vf', `scale=${GIF_WIDTH}:-1`,
    '-r', String(FPS),
    '-y', join(frames, 'f%05d.png'),
  ], { stdio: 'inherit' })

  const count = readdirSync(frames).length
  if (count === 0) throw new Error('ffmpeg extracted no frames')

  execFileSync('python3', [join(OUT, 'gif.py'), frames, GIF, String(FPS), String(COLORS)], {
    stdio: 'inherit',
  })

  rmSync(work, { recursive: true, force: true })
  process.stdout.write(`demo.gif <- ${count} frames at ${FPS} fps\n`)
}

await main()
