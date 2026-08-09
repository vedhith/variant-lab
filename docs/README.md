# Screenshots and the demo recording

The images here are the real app, captured from the seeded demo — not mockups.
`npm run seed` hashes the split and the conversions rather than randomising
them, so the numbers in `results.png` are the numbers you get on your own
machine. That is what makes them safe to quote in the README.

| File | Page |
|---|---|
| `demo.gif` | the whole loop, recorded end to end — see below |
| `results.png` | `/experiments/exp_demo_pricing/results` |
| `experiment.png` | `/experiments/exp_demo_pricing` |
| `home.png` | `/` |

The stills and the recording show two different experiments, on purpose. The
stills are the seeded `exp_demo_pricing`, which is what the quickstart hands
you. `demo.gif` builds a *new* experiment from an empty form, because the thing
a still cannot show is the loop — that the variants get drafted for you, with a
reason for each, and that a verdict comes back at the end of it.

## Recapturing the stills

Playwright is deliberately not a dependency of this project — a browser
download is a lot to impose on everyone who clones it, and on CI, for a handful
of static assets. Install it for the run only:

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

## Re-recording `demo.gif`

Same idea, one more install — Playwright's bundled ffmpeg is built with
`--disable-everything` and can write PNG frames but not GIFs, so Pillow turns
the frames into a palette:

```bash
npm run build && npm run seed && npm start   # terminal 1
npm i --no-save playwright                   # terminal 2
pip install Pillow
node docs/record.mjs
```

`docs/record.mjs` drives the app and records the video; `docs/gif.py` assembles
the frames. Roughly a minute end to end, and it writes only `docs/demo.gif`.

Two environment variables, both optional:

| Variable | For |
|---|---|
| `CHROMIUM` | a browser Playwright did not download — the npm package pins an exact build and refuses any other, which otherwise turns a working Chromium into a 150 MB re-download |
| `FFMPEG` | a system ffmpeg, which is the better of the two if you have one |

**What is real in the recording, and what is pinned.** It is one continuous
take with nothing spliced: the experiment is created through the form, the 900
visitors are real requests to `/api/assign`, and the results page at the end is
that experiment's own, computed by the app from rows the run actually wrote.

The one thing held fixed is which visitors convert. Rolling a die per visitor
was the first version and it made the ending unreproducible — `createExperiment`
mints a random experiment id, bucketing hashes it, so the arms divide
differently on every take, and at three hundred per arm the noise on the
difference is enough to swing a real effect in and out of significance. One take
ended on "b is ahead by +8.0 pp"; the next ended on "no variant has separated
from the control yet". So each arm now converts an exact share of the visitors
it was given, and the verdict is the same on every take: **b beating the control
by +7.8 pp, c too close to call.** The p-value still moves a little with how the
arms happen to divide, which is honest and worth leaving alone.

Keeping `c` short of significance is deliberate. A demo where every variant wins
teaches a reader nothing about what the page does when one does not.

If you change the results page, the authoring form, or the numbers above,
re-record — and check the last frame, which is the one the README quotes.
