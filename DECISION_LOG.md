# Decision Log

## Key Assumptions

- **Board naming convention:** the agent discovers boards dynamically by
  matching board names against the substrings "deal" and "work order"
  (case-insensitive). This satisfies the "don't hardcode CSV data / query
  monday.com dynamically" requirement without needing a config step, but it
  does assume the boards keep those words in their names.
- **Column semantics inferred from header text:** rather than hardcoding
  monday.com column IDs (which are assigned per-board at import time and
  would break the "no hardcoding" requirement), the cleaning layer infers
  intent from column *titles* — any header containing "date"/"month" is
  treated as a date, "amount"/"value"/"quantity" as numeric. This is a
  heuristic, not a schema, so it's robust to re-imports but can misfire on an
  oddly named column.
- **"This quarter" and similar relative time references** are resolved by the
  LLM against the current date at request time; if a query is ambiguous about
  time range, sector, or scope, the agent is instructed to ask one clarifying
  question rather than guess silently.
- **Masked identifiers** (deal names, owner/client codes) in the source data
  are treated as opaque IDs, not real names — the agent is told not to
  fabricate real customer/employee identities it wasn't given.

## Data Quality Issues Found & Handled

The provided CSVs are genuinely messy:
- The Deals CSV has **duplicate header rows embedded mid-file** (rows where
  cells literally contain "Deal Status", "Deal Stage" etc. instead of data —
  likely from a copy-paste of multiple exported tables). These are detected
  and filtered out (`isJunkRow` in `lib/dataClean.ts`) rather than surfaced as
  garbage records.
- Empty strings, `"-"`, and `"N/A"` are all normalized to `null` rather than
  treated as distinct values, so downstream counts aren't inflated by
  meaningless string variants.
- Every cleaned record carries a `missingFields` list, and every board fetch
  returns a `dataQualitySummary` (e.g. "312 usable records, 2 malformed rows
  filtered, avg 3.1 missing fields per record"). The agent is instructed to
  surface this to the user when it affects confidence in an answer, rather
  than silently presenting a number as if it were complete.

## Trade-offs Chosen and Why

| Decision | Chosen | Alternative | Why |
|---|---|---|---|
| Integration method | monday.com **REST/GraphQL API** direct | MCP server | MCP adds a protocol layer that's harder to debug and explain under a hard time limit; direct GraphQL calls are transparent, easy to test in monday's own API playground, and just as "dynamic." |
| LLM | **Gemini 2.0 Flash** | OpenAI / Claude | Free tier with no credit card and generous context window — removed a setup blocker given the time constraint. Function calling quality is comparable for this use case. |
| Where cleaning happens | **In code** (deterministic TypeScript) | In the LLM prompt | Cheaper, faster, testable, and avoids the model silently "fixing" data in ways that aren't auditable. |
| Data passed to LLM | **Full cleaned dataset** per relevant query | Pre-aggregated summaries only | At ~520 total records the full dataset comfortably fits Gemini's context window, so the model can answer follow-up questions (e.g. "which specific deals?") without a second data-modeling layer. Trade-off: larger token usage per turn than a pre-aggregated approach. |
| Hosting | **Vercel** (Next.js, single deploy) | Separate frontend/backend | One deploy, one URL, zero DevOps — appropriate for a 5–6 hour prototype. |

## How "Leadership Updates" Was Interpreted

Interpreted as: **the agent should be able to produce a structured executive
brief on demand**, not a separate export/document-generation feature (which
would need significantly more time to do well — e.g. PDF/slide generation).
Concretely, the system prompt instructs the agent that when asked for a
"leadership update," it should structure its answer as: headline metrics →
notable risks/wins → data-quality caveats, in a scannable format. This is
exposed as a one-click prompt suggestion in the chat UI. With more time, this
would become a dedicated mode that also lets a user export the brief (e.g. to
Markdown/PDF) and optionally schedules a recurring version.

## What We'd Do Differently With More Time

- **Persistent caching layer** (e.g. Redis/Vercel KV) instead of in-memory
  cache, so data isn't re-fetched from monday.com on every cold serverless
  start.
- **Structured aggregation tools** (e.g. `sum_deal_value(filters)`,
  `pipeline_by_stage(sector)`) as additional function-calling tools, rather
  than relying on the LLM to do arithmetic over a JSON blob — more reliable
  for large numeric answers and reduces token cost.
- **Automated tests** for the cleaning layer against known-messy fixtures
  (the embedded duplicate-header rows, blank leading rows, masked-value
  edge cases) rather than the manual inspection done under time pressure here.
- **A real "leadership update" export** — generate a formatted Markdown/PDF
  brief the user can download or share, not just a chat response.
- **Write access consideration**: the assignment specifies read-only, but a
  natural next step (with explicit scope/approval) would be flagging stale
  deals or suggesting stage updates back into monday.com.
- **Better ambiguity handling**: right now clarifying questions are left
  entirely to the LLM's judgment via the system prompt; a more robust version
  would validate query scope (sector names, date ranges) against the actual
  data before answering, and explicitly list valid options when a term
  doesn't match anything in the data.
