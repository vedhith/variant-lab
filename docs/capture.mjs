/**
 * Recapture the README screenshots from a running, seeded instance.
 *
 * Playwright is deliberately not a dependency of this project — it is a large
 * install to carry for three static assets — so install it for the run only:
 *
 *   npm run build && npm run seed && npm start   # terminal 1
 *   npm i --no-save playwright                   # terminal 2
 *   node docs/capture.mjs
 *
 * `--no-save` leaves package.json and the lockfile untouched, and node_modules
 * is gitignored, so nothing about this leaks into the repo.
 *
 * The seeded numbers are hashed rather than random, so the captured results are
 * identical on every machine — which is what lets the README quote them.
 */

import { chromium } from 'playwright'

const BASE = process.env.VARIANT_LAB_URL ?? 'http://localhost:3000'
const OUT = new URL('.', import.meta.url).pathname

const SHOTS = [
  { name: 'results.png', path: '/experiments/exp_demo_pricing/results' },
  { name: 'experiment.png', path: '/experiments/exp_demo_pricing' },
  { name: 'home.png', path: '/' },
]

const browser = await chromium.launch()
const page = await browser.newPage({
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 2,
})

try {
  for (const shot of SHOTS) {
    const response = await page.goto(BASE + shot.path, { waitUntil: 'networkidle' })
    const status = response?.status()

    // A 200 is the whole check: a screenshot of an error page looks plausible
    // in a thumbnail, and would be committed without anyone noticing.
    if (status !== 200) {
      throw new Error(`${shot.path} returned ${status ?? 'no response'} — is the seeded server running on ${BASE}?`)
    }

    await page.screenshot({ path: OUT + shot.name, fullPage: true })
    process.stdout.write(`${shot.name} <- ${shot.path}\n`)
  }
} finally {
  await browser.close()
}
