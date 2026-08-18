# Launch notes

Drafts and targets for when Variant Lab goes out. Nothing here has been posted.

**Post these by hand, from a real account.** Hacker News and every subreddit
below remove bot submissions, and a launch comment that reads like it was
generated is worse than no launch — the whole value of a Show HN is that a
person is standing behind it and answering questions in the thread for the next
few hours. Do not schedule it for a day you cannot do that.

---

## Not ready to post until

- [x] **A screenshot of the results page is in the README.** The seeded pricing
      experiment, which puts a winner, a loser and a paused variant in one
      frame. `docs/capture.mjs` recaptures all three stills.
- [x] **A GIF of the flow.** Optional, and weaker than the still: the stills
      already show the verdict, which is the thing people need to see. Worth
      recording only if the URL → generate → results flow reads better in
      motion.
- [ ] **A live demo is deployed and linked.** `render.yaml` makes it one click,
      but a Show HN with a working URL and one without are different launches.
      Deploy it, put the URL at the top of the README, and check it survives a
      hundred people hitting it at once.
- [ ] Repo is public, description and topics set (see below).
- [ ] CI is green on `main` and the badge, if one is added, is not red.

---

## Repo metadata

Set through the GitHub API before posting anywhere — topics are most of how a
repo gets found in search, and an empty description is a dead result.

```
PATCH /repos/vedhith/variant-lab
  { "description": "A/B test a landing page in an afternoon — AI-drafted
    variants, sticky assignment, and a results page that says which one won.
    Next.js + SQLite, no accounts.",
    "homepage": "<live demo URL once deployed>" }

PUT /repos/vedhith/variant-lab/topics
  { "names": ["ab-testing", "split-testing", "experimentation",
              "conversion-optimization", "landing-page", "nextjs",
              "typescript", "sqlite", "self-hosted", "analytics",
              "feature-flags", "statistics"] }
```

---

## Show HN

**Title** (80 char limit, no "I built"):

> Show HN: Variant Lab – A/B test a landing page without an analytics stack

Alternates, if the first reads flat:

> Show HN: Variant Lab – AI drafts page variants, it tells you which one won
> Show HN: Self-hosted A/B testing in one SQLite file

**First comment:**

> I wanted to test a headline on a landing page and found that step one was
> setting up a tag manager, step two was a data warehouse, and step three was
> picking an analytics vendor. So this is the small version: clone it, run
> `npm run seed`, and you are looking at a finished experiment in about a
> minute.
>
> You give it a URL or paste HTML, it drafts alternative versions, and it
> handles the parts that are easy to get subtly wrong:
>
> - **Assignment is a pure function of `(experimentId, visitorId)`** hashed onto
>   a cumulative-weight ruler, so any number of servers agree on who sees what
>   with no shared state — and it is then persisted, so changing a weight
>   mid-experiment does not silently reshuffle everyone.
> - **A conversion is a visitor, not an event.** Counting rows pushes rates past
>   100% and quietly inflates whichever variant had the more enthusiastic
>   clickers.
> - **Degenerate cases return null instead of a number.** Lift over a zero
>   control is `null`, not infinity. A variant nobody has been shown reports
>   nothing rather than −100%. That last one was a real bug the seeded demo
>   caught: the results page was confidently reporting total failure for a
>   paused variant with zero visitors.
> - **The results page names a leader only when one has actually separated.**
>   "Nothing has separated yet" is the honest reading of most experiments on
>   their first day, and a tool that never says it will eventually lie to you.
>
> The generator has an offline provider that does deterministic copy edits —
> strip the intensifiers from a headline, make a vague CTA concrete — so the
> whole thing runs with no API key and CI exercises the same route a paying user
> hits. Set `ANTHROPIC_API_KEY` and it uses a model instead.
>
> Honest limits: SQLite and a single process, no auth, fixed-horizon stats (so
> no peeking), and the URL importer sees server-rendered HTML rather than what a
> browser paints. There is a `VARIANT_LAB_DEMO=1` mode that turns off the
> importer and caps growth, because an unauthenticated server-side URL fetcher
> on a public address is a bad idea and I would rather say so than hope nobody
> notices.
>
> Happy to talk about the bucketing or the stats — those were the interesting
> parts to get right.

**Timing.** Weekday, 8–10am ET is the usual advice. Be at a keyboard for the
next four hours.

---

## Reddit

Read each subreddit's self-promotion rule before posting — several require a
comment history, and a few ban link posts outright. Space these out over a
couple of weeks rather than blasting them on one day.

| Subreddit | Angle | Notes |
|---|---|---|
| r/SideProject | The build story | Most forgiving, good first post |
| r/webdev | The tool | Showoff Saturday thread is safest |
| r/nextjs | Next.js 16 + SQLite in one app | Small but on-topic |
| r/selfhosted | Self-hosted alternative to Optimizely/VWO | Screenshot is in the README now; still wants a Docker story — see gaps below |
| r/javascript | Deterministic bucketing implementation | Prefers technical depth over launches |
| r/analytics | The stats decisions | Lead with Wilson intervals and the null cases, not the product |
| r/SaaS, r/Entrepreneur | Test your landing page without a vendor | Lower quality discussion, decent traffic |
| r/opensource | MIT, self-hostable | Fine once it is public |

**Do not** post to r/programming — it removes project launches almost
automatically. If it belongs there at all it is as a writeup of the bucketing
or the SSRF guard, not as a link to the repo.

---

## Awesome lists

Each of these takes a PR. Read the contributing guide first; most reject
entries that do not match the exact line format, and several have age or
popularity floors that this repo does not clear yet.

| List | Fit | Blocker |
|---|---|---|
| `awesome-selfhosted` | Good — MIT, self-hostable, Node | Requires a live demo **and** a documented deploy path, plus the project generally being a few months old. Not yet. |
| `awesome-abtesting` | Direct fit | Small list, low traffic, but exactly the category |
| `awesome-nextjs` | App-built-with-Next section | Easy once public |
| `awesome-analytics` | Under experimentation tools | Easy once public |
| `awesome-opensource-alternatives` | Alternative to Optimizely / VWO / Google Optimize | Wants the comparison stated plainly — the "what this is not" section covers it |
| `awesome-growth` / `awesome-cro` | Conversion tooling | Varies by list, check activity first |

Add a Docker deployment path before trying `awesome-selfhosted`; the list's
readers expect one and `render.yaml` alone will not satisfy the reviewers.

---

## Things to have an answer ready for

These will come up, and the honest answer is better than a defensive one:

- **"Why not just use GrowthBook / PostHog / Unleash?"** Use them. They have
  auth, teams, and a hosted option. This is for the case where the setup cost of
  those is the reason the test never happens.
- **"Your stats are wrong because [peeking / multiple comparisons]."** Peeking
  is named in the README as a real limit, and multiple comparisons genuinely is
  not corrected for — every variant is tested against the control at α = 0.05.
  Say so; do not argue.
- **"An LLM writing your marketing copy is a bad idea."** Partly agreed, which
  is why the drafts land in editable textareas and nothing is persisted by
  generation. The offline provider is a rewriter and cannot invent a claim.
- **"This is an SSRF."** The guard is real — post-DNS address checks, every
  address behind a name, redirects re-checked one hop at a time, a byte cap —
  and its one hole, a DNS rebinding race, is documented in the README rather
  than hidden. The demo deployment turns the importer off entirely.
- **"Is this AI-generated code?"** It was built with an agent, and every commit
  in the history is a real slice that ran and passed its tests when it landed.
  The bugs listed in the README were found by the test suite and the seeded
  demo, not written around.
