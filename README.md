# Variant Lab

**A/B test a landing page in an afternoon, without a tag manager, a data
warehouse, or an analytics vendor.** Point it at a URL, let it draft the
alternative versions, and get back a results page that says which one won — or
says nothing separated yet, which is the honest answer most of the time.

For anyone who has wanted to test a headline and found that step one was a
six-week analytics migration. One SQLite file, one HTTP endpoint, no accounts.

![A recording of the whole loop: pasting a page into the form, generating two
variants with the reason for each, creating the experiment, 900 visitors being
split across the three versions, and the results page reporting variant b ahead
of the control by +7.8 pp at p = 0.004 while variant c is "too close to
call".](docs/demo.gif)

That is one continuous recording against a real server — the experiment is
created through the form, the traffic is real requests to `/api/assign` and
`/api/events`, and the verdict at the end is that experiment's own. Twenty-five
seconds, start to answer.

The still below is the *other* demo — the four experiments `npm run seed` lays
down, which is what you get from the quickstart:

![The results page for the seeded demo experiment: variant b beating the control
by +4.2 pp at p = 0.006, variant c losing, and a paused variant reported as "not
enough traffic" rather than as a
loss.](docs/results.png)

`npm run seed` produces it on your machine with the same numbers, because the
split and the conversions are hashed rather than random. Note the last row: a
variant nobody has seen is reported as "not enough traffic", not as a 100% loss.

## Quickstart

Node 22 or newer, and no API key.

```bash
git clone https://github.com/vedhith/variant-lab && cd variant-lab
npm install
npm run seed
npm run dev
```

Open <http://localhost:3000/experiments/exp_demo_pricing/results> and you are
looking at a finished experiment:

| Variant | Visitors | Conversions | Rate | 95% interval | Lift | p | Verdict |
|---|---|---|---|---|---|---|---|
| control | 799 | 66 | 8.3% | 6.5% to 10.4% | — | — | baseline |
| b | 792 | 99 | 12.5% | 10.4% to 15.0% | +4.2 pp (51.3%) | 0.006 | beating control |
| c | 809 | 33 | 4.1% | 2.9% to 5.7% | −4.2 pp (−50.6%) | < 0.001 | losing to control |
| d | 0 | 0 | 0.0% | — | — | — | not enough traffic |

Those numbers are hashed rather than random, so they are the numbers you get
too. `npm run seed` also lays down three more experiments covering the states a
results page has to survive — see [The demo](#the-demo).

Nothing else needs configuring: the database appears at `.data/variant-lab.db`
on first write, and variant generation runs offline until you set
`ANTHROPIC_API_KEY`.

## What this is not

Worth knowing before you clone, rather than after:

- **Not a hosted analytics product.** No accounts, no dashboard for your team,
  no data retention story. It is one process with a SQLite file next to it.
- **Not a copywriter.** With no API key the generator makes four mechanical
  edits to a headline and a CTA, and it will not invent "trusted by 10,000
  teams" to win a test. Set `ANTHROPIC_API_KEY` for actual ideas.
- **Not safe to expose as-is.** No auth, and `/api/import` fetches URLs on your
  behalf. Run it on your own machine, or deploy it with `VARIANT_LAB_DEMO=1`,
  which is what the button below does.
- **Not a sequential test.** Refreshing until it goes significant inflates false
  positives. Pick a sample size up front.
- **Not a replacement for Optimizely, VWO, or GrowthBook** if you need a visual
  editor, multi-page funnels, or a team. Those are out of scope for v1.

The longer list, with the reasons, is under [Limits](#limits).

## Try it without cloning

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/vedhith/variant-lab)

[`render.yaml`](render.yaml) deploys the seeded demo on Render's free tier. It
sets `VARIANT_LAB_DEMO=1`, which switches off importing a live URL and caps how
many experiments the instance will hold — Variant Lab has no accounts, so a
public instance has to be narrower than a clone. `src/lib/hosting.ts` says
exactly what is off and why. The database lives in `/tmp` on purpose: the demo's
value is the seeded experiments, which are rebuilt identically on every boot,
and an instance that forgets on restart cannot slowly fill with a stranger's
pasted HTML.

> **Status: week 3 of 3.** Every functional item of the v1 scope is built.
> See [Roadmap](#roadmap) for what is left.

---

## Why

Most A/B tooling assumes you already have a tag manager, a data warehouse, and
an analytics vendor. For a landing page you want to test this afternoon, that is
the whole project. Variant Lab is the small version.

The part worth stealing even if you use something else is `src/lib/bucketing.ts`
— assignment is a pure function of `(experimentId, visitorId)`, so any number of
servers agree on who sees what without sharing state.

---

## The demo

Everything interesting here is a function of traffic, and a fresh clone has
none. `npm run seed` supplies some:

```
$ npm run seed

Seeded 4 demo experiments into .data/variant-lab.db

  Pricing page — headline and CTA  2400 visitors · 198 conversions
                                   a winner, a loser, and a paused variant nobody has seen
                                   http://localhost:3000/experiments/exp_demo_pricing/results

  Signup form — button copy        260 visitors · 29 conversions
                                   a real difference that has not separated from noise yet
                                   http://localhost:3000/experiments/exp_demo_signup/results

  Docs landing — an exact tie      120 visitors · 30 conversions
                                   identical rates: p = 1, no winner named
                                   http://localhost:3000/experiments/exp_demo_docs/results

  Blog CTA — no traffic yet        0 visitors · 0 conversions
                                   a freshly created experiment before its first visitor
                                   http://localhost:3000/experiments/exp_demo_blog/results
```

Those four are chosen to cover the states a results page has to survive, not
just the happy one. The first is the table in the [Quickstart](#quickstart)
above; variant `d` in it is paused at weight 0, and reports nothing rather than
the −100% lift you would get by treating "no visitors" as "a 0% conversion
rate" — a confident claim about a page nobody has been shown.

Two properties make this a demo instead of a fixture dump. The visitors go
through the same `assignVisitor` and `recordEvent` the API uses, so the seed
breaks when the real path breaks; and the split and the conversions are hashed
rather than random, so **those numbers are what you will get too**, on any
machine, on every re-seed. `npm run seed -- --reset` rebuilds them and
`npm run seed -- --clear` removes them.

## Usage

**In the browser.** The home page has a form: paste a URL and hit **Fetch page**
(or paste your own HTML), hit **Generate variants**, edit the drafts you like,
submit. You land on the experiment page, which shows every version and how
traffic has split so far.

![The home page: the experiment form with a URL field and a Fetch page button, a
baseline HTML box, a generated variant b below it, and the four seeded
experiments listed underneath.](docs/home.png)

![The experiment page for the seeded pricing test, showing each variant's HTML
alongside how much traffic it actually received against its target, and the
paused variant labelled as receiving none.](docs/experiment.png)

**Importing a page.** Point it at a URL and get a baseline back:

```bash
curl -X POST http://localhost:3000/api/import \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.com/pricing"}'
```

```json
{
  "requestedUrl": "https://example.com/pricing",
  "finalUrl": "https://example.com/pricing",
  "title": "Pricing — Northwind Analytics",
  "html": "<h1>Incredibly powerful analytics for busy teams</h1>\n<p>Northwind turns your product events into answers. Start free, upgrade when it pays for itself.</p>\n<img src=\"https://example.com/hero.png\" srcset=\"https://example.com/hero.png 1x, https://example.com/hero@2x.png 2x\" alt=\"Dashboard\">\n<a href=\"https://example.com/signup\">Learn more</a>",
  "bytes": 361,
  "redirects": 0
}
```

The nav, the footer, the analytics `<script>`, the `<style>` block, the HTML
comment and the `onclick` handler on the CTA are all gone; the relative `src`,
`srcset` and `href` are absolute, so the page still renders when Variant Lab
serves it instead of the site it came from. Like generation, this persists
nothing — the markup comes back for you to read before it becomes the control
everything else is measured against.

`title` is what the form uses to name the experiment, and `finalUrl` (after
redirects) is stored as the experiment's `sourceUrl`.

**Drafting variants.** Ask for versions of a page:

```bash
curl -X POST http://localhost:3000/api/generate \
  -H 'content-type: application/json' \
  -d '{"baselineHtml":"<h1>Powerful analytics for busy teams</h1><a href=\"/signup\">Learn more</a>","count":3}'
```

```json
{
  "provider": "rules",
  "variants": [
    {
      "key": "b",
      "html": "<h1>Analytics for busy teams</h1><a href=\"/signup\">Learn more</a>",
      "rationale": "Headline with the intensifiers removed: \"Powerful analytics for busy teams\" → \"Analytics for busy teams\". Tests whether the claim carries the page on its own."
    },
    {
      "key": "c",
      "html": "<h1>Powerful analytics for busy teams</h1><a href=\"/signup\">See how it works</a>",
      "rationale": "Call to action made concrete: \"See how it works\" instead of \"Learn more\". The click costs the visitor exactly the same thing either way."
    }
  ],
  "short": true
}
```

Nothing is persisted by that call — drafts come back for a human to read and
edit, and become an experiment only when you POST them to `/api/experiments`.
`short: true` means fewer variants came back than you asked for, which is the
honest answer when a page gives the generator little to work with.

**From a page under test.** On load, ask which variant this visitor gets:

```bash
curl -X POST http://localhost:3000/api/assign \
  -H 'content-type: application/json' \
  -d '{"experimentId":"exp_...","visitorId":"visitor-1"}'
```

```json
{
  "experimentId": "exp_613b479132bc6bc3",
  "visitorId": "visitor-1",
  "variant": {
    "id": "var_a15f482a90a2fef2",
    "key": "control",
    "html": "<h1>Ship faster</h1>",
    "isControl": true
  },
  "assignedAt": "2026-08-02T01:09:52.681Z",
  "firstSeen": true
}
```

Omit `visitorId` and the server mints one for you to store and send back on the
next call. `firstSeen` is `true` only on a visitor's first assignment, which is
the signal to count an exposure.

**When something converts.** Tell the server which visitor did it:

```bash
curl -X POST http://localhost:3000/api/events \
  -H 'content-type: application/json' \
  -d '{"experimentId":"exp_...","visitorId":"visitor-1","name":"conversion"}'
```

The variant is deliberately not part of that request — it is read from the
visitor's stored assignment, so a client cannot credit a conversion to a
version it was never shown. A visitor with no assignment is a `400`: an event
nobody can attribute is a bug worth hearing about, not a row worth keeping.

`name` defaults to `conversion`; pass anything else (`signup`, `purchase`) to
track several outcomes on one experiment. `value` takes an optional number for
revenue or seconds on page.

### API

| Method | Path | Does |
|---|---|---|
| `POST` | `/api/import` | Fetch a live URL and return it as a baseline. Persists nothing |
| `POST` | `/api/generate` | Draft variants of a page. Persists nothing |
| `GET` | `/api/generate` | Which generator is configured |
| `POST` | `/api/experiments` | Create an experiment and its variants |
| `GET` | `/api/experiments` | List experiments (without HTML bodies) |
| `GET` | `/api/experiments/:id` | One experiment, its variants, and its current split |
| `POST` | `/api/assign` | Get this visitor's variant, assigning on first contact |
| `POST` | `/api/events` | Record a conversion against the visitor's assignment |
| `GET` | `/api/experiments/:id/results` | Rates, intervals, lift, and p-values (`?event=` to pick the name) |

Bad input returns `400` with an `{ "error": ... }` body; unknown ids return
`404`. Generation and import add two more, and the split is the same in both
cases because it is the distinction worth having — one of these is worth
retrying and the other never is:

- **`422`** — it ran and produced nothing. The generator had no idea for your
  page; the URL you imported has no content in it. Retrying gets you the same
  answer.
- **`502`** — something upstream failed. The model errored; the site was
  unreachable, answered `404`, served a PDF, or sent more than we will read.

A URL we refuse to fetch at all — a `file:` URL, one carrying credentials, one
resolving to a private address — is a `400`, because that is a fact about the
request rather than about the internet.

A demo instance adds one more:

- **`403`** — the route exists and your request was fine, but this instance has
  the feature switched off. `/api/import` always answers this when
  `VARIANT_LAB_DEMO=1`, and `POST /api/experiments` answers it once the instance
  is full. The same call against a clone would succeed, which is why it is not a
  `404`.

### Configuration

| Variable | Default | Does |
|---|---|---|
| `VARIANT_LAB_DB` | `.data/variant-lab.db` | SQLite file path. `:memory:` for a throwaway instance. |
| `ANTHROPIC_API_KEY` | unset | Set it and generation uses a model. Leave it unset and the offline rules run. |
| `VARIANT_LAB_PROVIDER` | auto | `rules` or `anthropic`, overriding the line above. CI pins `rules`. |
| `ANTHROPIC_MODEL` | `claude-sonnet-5` | Model id, when the Anthropic provider is in use. |
| `ANTHROPIC_BASE_URL` | `https://api.anthropic.com` | Point at a proxy or a stub. |
| `VARIANT_LAB_URL` | `http://localhost:3000` | Base URL the seed script prints its links against. |
| `VARIANT_LAB_ALLOW_PRIVATE_HOSTS` | unset | `1` lets `/api/import` fetch localhost and private addresses. For developing against a page on your own machine — see the warning below before setting it on a server. |
| `VARIANT_LAB_DEMO` | unset | `1` marks this instance as publicly reachable: `/api/import` is refused and new experiments are capped. Set it on anything a stranger can load. |
| `VARIANT_LAB_DEMO_MAX_EXPERIMENTS` | `200` | How many experiments a demo instance holds before it stops accepting more. `0` serves the seeded ones and takes nothing new. Ignored unless `VARIANT_LAB_DEMO` is on. |

---

## Deploying it

`render.yaml` is a [Render blueprint](https://render.com/docs/blueprint-spec)
for the demo, and the button at the top of this file runs it. Nothing about
Variant Lab is Render-specific — it is a Next.js app and a SQLite file, so any
host that gives you a Node process and a writable directory works. What matters
is what the blueprint sets, and would need setting anywhere else:

- **`VARIANT_LAB_DEMO=1`.** There are no accounts here. Without this flag a
  deploy is an unauthenticated server-side URL fetcher on a public address, and
  the SSRF guard is documented as a 95% rather than a 100%. Not optional.
- **No `ANTHROPIC_API_KEY`.** Generation falls back to the offline rules, so
  whoever finds the URL cannot spend your tokens.
- **`npm ci --include=dev`.** Render sets `NODE_ENV=production`, and both
  `next build` and the seed script live in `devDependencies`.
- **Seed on start, not on build.** `npm run seed -- --reset && npm run start`
  means every boot has the four demo experiments, whatever the disk did.

---

## How importing works

`POST /api/import` takes a URL from whoever is using the app and makes the
server fetch it. That is a request-forgery primitive unless it is fenced in — on
a hosted box, `http://169.254.169.254/` is the cloud metadata service and
`http://127.0.0.1:5432` is the database. So the fetching here is deliberately
unlike a browser's:

- **The decision is made on the address, after DNS** (`src/lib/importing/address.ts`).
  A hostname denylist never sees `metadata.example.com` resolving to a
  link-local address. IPv4 is checked against the reserved ranges; IPv6 is an
  allowlist of `2000::/3`, with the wrappers that can carry an IPv4 address
  inside them — v4-mapped, 6to4, NAT64 — unwrapped and re-checked, because
  `::ffff:127.0.0.1` is the loopback interface wearing a different hat.
- **Every address behind a name has to pass**, not just the first. Otherwise a
  name resolving to one public and one private address is just a way of asking
  which one the fetch happens to pick.
- **Redirects are followed by hand**, one hop at a time, each re-checked.
  `redirect: "follow"` would validate the URL you typed and then happily fetch
  whatever `302 Location:` pointed at.
- **The body is read through a byte counter**, checked per chunk, so a server
  that advertises 2 KB and then streams forever is cut off at the cap rather
  than filling memory. A response that is not HTML is refused before it is read
  at all.

What comes back is reduced to the page's own content: `<main>`, else
`<article>`, else `<body>`; scripts, styles, comments and inline handlers
removed; relative URLs made absolute against the page's `<base href>` or its own
URL. It is not a readability port — it errs toward keeping too much rather than
cleverly discarding the section that turns out to be the offer.

> **The guard has a known hole.** The name is resolved for the check, and
> `fetch` resolves it again a moment later when it connects. A DNS entry that
> changes between those two moments — a rebinding attack — defeats it. Closing
> that means pinning the connection to the address that was checked, which needs
> a custom agent per request and is not built. For a tool you run on your own
> machine against pages you chose, the check is the honest 95%; do not put this
> on the open internet and treat `/api/import` as safe for strangers.

---

## How generation works

Two providers behind one interface (`src/lib/generation/types.ts`), and the API
route cannot tell them apart:

- **`rules`** — the default, and what runs with no API key. Deterministic copy
  edits to text that is already on the page: strip the intensifiers out of a
  headline, cut a long headline at its first clause, turn an imperative headline
  into a question, replace a vague CTA with a concrete one. It is a rewriter,
  not a copywriter, and it will not invent "trusted by 10,000 teams" to win a
  test. When it has nothing to say about a page it returns nothing rather than a
  copy of what you gave it.
- **`anthropic`** — a `fetch` call to the Messages API, no SDK dependency. The
  prompt forbids inventing facts, changing link targets, and emitting scripts.

Whatever comes back is treated as untrusted: HTML is stripped of `<script>`,
`<iframe>`, inline `on*` handlers, and `javascript:` URLs before anyone sees it,
drafts identical to the baseline or to each other are dropped, and keys are
assigned after that filtering so they stay contiguous. Adding a provider means
implementing `VariantProvider` — nothing else in the app knows which model, if
any, wrote a variant.

The point of the offline provider is that the demo path and the real path are
the same path. The place an "it works with no API key" claim usually breaks is
where the two diverge; here CI exercises the same route a paying user hits.

---

## How assignment works

Two layers, because they fail differently.

1. **Hashing.** `sha256("<experimentId>:<visitorId>")` is folded into a float in
   `[0, 1)` and read off a cumulative-weight ruler. This is deterministic and
   needs no coordination, so a visitor gets the same answer from any server,
   including before their assignment has been written anywhere.
2. **Persistence.** The choice is then stored in `assignments`, keyed on
   `(experiment_id, visitor_id)`. Hashing alone would silently reshuffle people
   the moment you changed a weight or added a variant; the stored row is what
   keeps an in-flight experiment honest.

Variants are sorted by id before bucketing, so the order the caller happens to
pass them in cannot change who sees what. The seed includes the experiment id so
that a visitor unlucky in one experiment is not unlucky in all of them.

---

## Reading the results

`/experiments/:id/results` is the page that answers the actual question. For
each variant it shows visitors, conversions, the conversion rate with a 95%
interval, the lift over the control, and whether that lift has separated from
noise yet.

Four decisions in there are worth stating out loud, because they are the ones
that make the difference between a number and a *true* number:

- **A conversion is a visitor, not an event.** Someone who clicks the button
  five times is one conversion out of one visitor. Counting rows would push
  rates past 100% and quietly inflate whichever variant had the more
  enthusiastic clickers.
- **Rates carry a Wilson interval**, not the textbook normal one, so the
  interval stays inside `[0, 1]` and still says something sensible at the low
  counts an experiment spends its first day in.
- **Variants are compared to the control with a two-proportion test** — pooled
  standard error for the p-value, unpooled for the confidence interval on the
  difference, which is the standard pairing.
- **Degenerate cases report nothing rather than something false.** No traffic,
  a control that converted nobody, an exact tie, everyone converting: each one
  returns `null` where a claim would be unfounded. In particular, lift over a
  zero control is `null`, not infinity, and a tie is `p = 1` with no winner
  named. `src/lib/stats.ts` is pure functions of counts, and
  `tests/stats.test.ts` checks it against values worked out by hand rather than
  recorded from a first run.

The page names a leader only when a variant beats the control *significantly*
and by the largest margin. Otherwise it says so plainly — "no variant has
separated from the control yet" is the honest reading of most experiments on
their first day, and a tool that never says it is a tool that will eventually
lie to you.

---

## Limits

Real ones, not modesty:

- **The offline rules are mechanical.** Four edits to a headline and a call to
  action, and they only fire on plain-text headings and buttons — a heading with
  markup inside it is skipped rather than mangled. They exist so the pipeline
  runs with no API key, not to replace a copywriter. For actual copy ideas, set
  `ANTHROPIC_API_KEY`.
- **Generated HTML is filtered with regex**, which cannot be complete. It is a
  guard against a model handing back something executable, not a sanitizer for
  hostile input — read the drafts before you run them.
- **The stats are a fixed-horizon test.** Refreshing the results page until it
  goes significant ("peeking") inflates false positives — that is a property of
  the method, not of this implementation. Pick a sample size up front. Sequential
  testing is not implemented.
- **Screenshots, not a GIF.** The images above are real captures of the seeded
  demo (see [`docs/`](docs/README.md) for how to recapture them), but nothing
  here shows the flow in motion.
- **Importing sees the HTML a server sends, not the page a browser renders.**
  A site that builds its content in JavaScript imports as an empty shell, and
  gets a `422` saying so. There is no headless browser here and there is not
  going to be one in v1 — paste the rendered HTML instead.
- **Extraction is regex over HTML**, which cannot be complete, and the pick of
  `<main>`/`<article>`/`<body>` is a heuristic. Read what comes back before you
  test with it.
- **The import guard is not a hardened SSRF defence.** See the warning under
  [How importing works](#how-importing-works): it checks addresses after DNS and
  re-checks every redirect, but a DNS rebinding race would still get through.
- **SQLite, single process.** Fine for a landing page or a demo. Postgres is
  planned; concurrent writes across processes are not supported today.
- **No auth.** Anyone who can reach the server can create and read experiments.
  Do not put this on the open internet as-is — `VARIANT_LAB_DEMO=1` narrows a
  public instance to something defensible, but it is a smaller tool than a
  clone, not the same one with a login on it.
- **Variant HTML is stored and returned verbatim** and is capped at 512 KB.
  Whatever you paste is what gets served back, so treat it as trusted input.
- **No visual editor, no multi-page funnels, no teams.** Out of scope for v1.

---

## Roadmap

- [x] **Week 1 — it runs.** Scaffold, schema, create an experiment, sticky
      deterministic assignment, CI.
- [x] **Week 2 — it's useful.** Conversion event ingest, results page with lift
      and confidence, LLM variant generation behind a provider adapter.
- [ ] **Week 3 — it ships.**
  - [x] A seeded demo, so a fresh clone has something to look at.
  - [x] Edge cases: zero traffic, an unseen variant, an exact tie, and a
        single-variant experiment (rejected at creation — there is nothing to
        compare a lone variant against).
  - [x] Creating an experiment from a URL rather than pasted HTML.
  - [x] A deploy config, and a demo mode that makes deploying it defensible.
  - [x] Screenshots in this README, captured from the seeded demo and
        reproducible with [`docs/capture.mjs`](docs/capture.mjs).
  - [ ] A GIF of the flow in motion, which the stills do not convey.
  - [ ] A live demo at a URL, so the button above is a link as well as a
        blueprint.

---

## Development

```bash
npm test        # vitest, 300 tests
npm run typecheck
npm run build
npm run seed -- --help
```

CI runs all three on every push.

Tests use an in-memory database, so they never touch `.data/`, and no test ever
makes a network call — the model provider and the URL importer are both
exercised against an injected `fetch` and an injected DNS lookup, and the
generation route is pinned to `VARIANT_LAB_PROVIDER=rules`, so running the suite
never spends a token or opens a socket. Four files carry most of the weight:
`tests/bucketing.test.ts` asserts determinism, order-independence, weight
handling, and that the split is actually close to what was asked for;
`tests/stats.test.ts` checks the maths against known values and pins down every
degenerate case; `tests/generation-rules.test.ts` pins each copy rule to its
exact output, including the pages it declines to touch; and
`tests/importing-address.test.ts` walks every reserved range and every wrapper
an IPv4 address can hide inside, including the boundaries just outside each
private block.

---

## License

MIT — see [LICENSE](LICENSE).
