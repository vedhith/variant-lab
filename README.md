# Variant Lab

Run a real A/B test on a page without wiring up an analytics stack first.

You paste a page, give it a second version, and Variant Lab handles the part
that is easy to get subtly wrong: splitting visitors deterministically, keeping
each one on the same version across visits, and counting what actually happened.

> **Status: week 2 of 3.** Assignment, conversion tracking, and a results page
> with lift and confidence all work end to end. LLM variant generation is the
> next slice — see [Roadmap](#roadmap) for exactly what is and is not built yet.

---

## Why

Most A/B tooling assumes you already have a tag manager, a data warehouse, and
a analytics vendor. For a landing page you want to test this afternoon, that is
the whole project. Variant Lab is the small version: one SQLite file, one HTTP
endpoint, no accounts.

The part worth stealing even if you use something else is `src/lib/bucketing.ts`
— assignment is a pure function of `(experimentId, visitorId)`, so any number of
servers agree on who sees what without sharing state.

---

## Install

Requires Node 22 or newer.

```bash
git clone https://github.com/vedhithkrishnakumar-cell/variant-lab
cd variant-lab
npm install
npm run dev
```

Open <http://localhost:3000>. There is nothing else to configure — the database
is created at `.data/variant-lab.db` on first write.

## Usage

**In the browser.** The home page has a form: name the experiment, paste your
baseline HTML, paste a variant, submit. You land on the experiment page, which
shows both versions and how traffic has split so far.

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
| `POST` | `/api/experiments` | Create an experiment and its variants |
| `GET` | `/api/experiments` | List experiments (without HTML bodies) |
| `GET` | `/api/experiments/:id` | One experiment, its variants, and its current split |
| `POST` | `/api/assign` | Get this visitor's variant, assigning on first contact |
| `POST` | `/api/events` | Record a conversion against the visitor's assignment |
| `GET` | `/api/experiments/:id/results` | Rates, intervals, lift, and p-values (`?event=` to pick the name) |

Bad input returns `400` with an `{ "error": ... }` body; unknown ids return `404`.

### Configuration

| Variable | Default | Does |
|---|---|---|
| `VARIANT_LAB_DB` | `.data/variant-lab.db` | SQLite file path. `:memory:` for a throwaway instance. |

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

- **No LLM generation yet.** You write the variants by hand. The generator is
  the next slice and drops in behind the same `POST /api/experiments` shape.
- **The stats are a fixed-horizon test.** Refreshing the results page until it
  goes significant ("peeking") inflates false positives — that is a property of
  the method, not of this implementation. Pick a sample size up front. Sequential
  testing is not implemented.
- **No screenshot in this README yet.** The results page is real and running,
  but capturing it is part of the week-3 ship slice.
- **SQLite, single process.** Fine for a landing page or a demo. Postgres is
  planned; concurrent writes across processes are not supported today.
- **No auth.** Anyone who can reach the server can create and read experiments.
  Do not put this on the open internet as-is.
- **Variant HTML is stored and returned verbatim** and is capped at 512 KB.
  Whatever you paste is what gets served back, so treat it as trusted input.
- **No visual editor, no multi-page funnels, no teams.** Out of scope for v1.

---

## Roadmap

- [x] **Week 1 — it runs.** Scaffold, schema, create an experiment, sticky
      deterministic assignment, CI.
- [ ] **Week 2 — it's useful.** Conversion event ingest ✔, results page with
      lift and confidence ✔, LLM variant generation behind a provider adapter
      (not started).
- [ ] **Week 3 — it ships.** Demo mode that needs no API key, screenshots,
      edge cases (zero traffic, one variant, tied results).

---

## Development

```bash
npm test        # vitest, 110 tests
npm run typecheck
npm run build
```

CI runs all three on every push.

Tests use an in-memory database, so they never touch `.data/`. Two files carry
most of the weight: `tests/bucketing.test.ts` asserts determinism,
order-independence, weight handling, and that the split is actually close to
what was asked for; `tests/stats.test.ts` checks the maths against known
values and pins down every degenerate case.

---

## License

MIT — see [LICENSE](LICENSE).
