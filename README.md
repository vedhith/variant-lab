# Variant Lab

Run a real A/B test on a page without wiring up an analytics stack first.

You paste a page, give it a second version, and Variant Lab handles the part
that is easy to get subtly wrong: splitting visitors deterministically, keeping
each one on the same version across visits, and counting what actually happened.

> **Status: week 1 of 3.** Assignment works end to end. LLM variant generation
> and the results/stats page are the next two slices — see
> [Roadmap](#roadmap) for exactly what is and is not built yet.

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

### API

| Method | Path | Does |
|---|---|---|
| `POST` | `/api/experiments` | Create an experiment and its variants |
| `GET` | `/api/experiments` | List experiments (without HTML bodies) |
| `GET` | `/api/experiments/:id` | One experiment, its variants, and its current split |
| `POST` | `/api/assign` | Get this visitor's variant, assigning on first contact |

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

## Limits

Real ones, not modesty:

- **No stats yet.** Conversion events have a table but no ingest endpoint, and
  there is no results page. Right now this splits traffic; it does not yet tell
  you which version won.
- **No LLM generation yet.** You write the variants by hand. The generator is
  the next slice and drops in behind the same `POST /api/experiments` shape.
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
- [ ] **Week 2 — it's useful.** LLM variant generation behind a provider
      adapter, conversion event ingest, results page with lift and confidence.
- [ ] **Week 3 — it ships.** Demo mode that needs no API key, screenshots,
      edge cases (zero traffic, one variant, tied results).

---

## Development

```bash
npm test        # vitest, 63 tests
npm run typecheck
npm run build
```

CI runs all three on every push.

Tests use an in-memory database, so they never touch `.data/`. `tests/bucketing.test.ts`
is the interesting file — it asserts determinism, order-independence, weight
handling, and that the split is actually close to what was asked for.

---

## License

MIT — see [LICENSE](LICENSE).
