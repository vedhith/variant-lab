# Screenshots

The images here are the real app, captured from the seeded demo — not mockups.
`npm run seed` hashes the split and the conversions rather than randomising
them, so the numbers in `results.png` are the numbers you get on your own
machine. That is what makes them safe to quote in the README.

| File | Page |
|---|---|
| `results.png` | `/experiments/exp_demo_pricing/results` |
| `experiment.png` | `/experiments/exp_demo_pricing` |
| `home.png` | `/` |

## Recapturing them

Playwright is deliberately not a dependency of this project — a browser
download is a lot to impose on everyone who clones it, and on CI, for three
static assets. Install it for the run only:

```bash
npm run build && npm run seed && npm start   # terminal 1
npm i --no-save playwright                   # terminal 2
node docs/capture.mjs
```

`--no-save` leaves `package.json` and the lockfile untouched, and
`node_modules` is gitignored, so nothing about this reaches the repo.
`docs/capture.mjs` needs no more than `playwright` being importable, so a
global or `npx`-provided install works too.

Captured at a 1280×900 viewport, `deviceScaleFactor: 2`, full page. The script
refuses any page that does not answer 200 — a screenshot of an error page looks
plausible as a thumbnail and would otherwise get committed unnoticed.

If you change the results table's columns or the seeded numbers, recapture. A
README screenshot that disagrees with the app is worse than no screenshot.
