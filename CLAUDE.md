# BusyQ (busyqueue)

The invoicing final boss. Two halves that share one money core:

1. **BusyQ agent (hackathon, build first).** An AI agent that audits school-district
   food-service vendor invoices and payments, finds money lost to mistakes, and drafts the
   fix. Track: Money Operations. Judged mainly on **PRISM** (observing and fixing
   the agent) and **Nicrron** (where every model call runs).
2. **Invoicing suite (after the demo).** Create, issue, and track six document
   types with per-country tax, clients, catalog, and AI import of paper documents.
3. **Inbox, projections, and reminders.** Connect email so incoming and outgoing
   invoices and contracts arrive on their own, project cash and month-over-month
   trends, and remind the owner well before a contract or tender lapses.

**First customer: school districts.** The food-service office of a K-12 district,
buying for several school kitchens from a few contract vendors (produce, dairy,
general foodservice). Why schools first: prices are fixed by bid or contract, so
"invoice vs agreed price" is objective and auditable; the money is public, so an
audit trail and owner approval matter; and the overbilling evidence we cite
comes mostly from college foodservice. Restaurants and other multi-site
operators stay on the roadmap and need different data, not different code. The
sample district is fictional (Northfield Unified School District).

BusyQ checks money coming *in* (vendor bills); the suite produces documents going
*out*; the inbox feeds both and watches what's coming. All three use the same
money math, line/tax model, and document reader. Contracts close the loop: their
agreed prices become the price list the BusyQ agent checks bills against.

See README.md for stack, layout, scripts, and theming.

## Non-negotiable rules

- **AI explains, code calculates, a human approves.** The model never computes,
  rounds, or decides an amount. Every number shown to a user comes from a pure,
  unit-tested function. The model only reads documents, chooses tools, and writes
  prose (explanations, dispute emails).
- **Money is exact.** Store amounts as integer minor units (cents, paise).
  Quantities and unit prices are decimal strings computed with a decimal library
  and rounded once, at the step the country rule requires. Never use JS floats
  for money.
- **Projections are arithmetic, not AI.** Forecasts, growth rates, and due dates
  come from pure functions with a stated method and range. The model may only
  narrate them. With fewer than 3 months of history, show "not enough data"
  instead of a number.
- **Nothing moves money or messages a vendor without an explicit Approve click.**
  Every approval is written to an append-only log (who, when, what, amounts).
- **Every model call and every agent tool call is traced to PRISM.** See the
  standing rule at the bottom of this file.
- All model calls go through Nicrron (`src/server/nicrron.ts`), including AI import.
  Use Nicrron's `models` fallback list rather than adding another gateway.
  (The original spec said OpenRouter. Nicrron replaces it because it is judged.)
- Phases 1–2 use synthetic data only. Phase 3 handles real mailbox content:
  process only messages classified as invoices or contracts, store the extracted
  fields plus the attachment, and redact contact details before PRISM traces.

## Architecture decisions

| Concern | Choice |
| --- | --- |
| Runtime | One Cloudflare Worker (TanStack Start SSR + server routes), `bun run deploy` |
| Database | Cloudflare D1 with Drizzle ORM (migrations in `drizzle/`) |
| Files | R2 for uploaded documents (private bucket) |
| Background work | Cloudflare Queues with retries. Needs a custom Worker entry (`src/worker.ts`) that wraps `@tanstack/react-start/server-entry` and adds `queue()` |
| Models | Nicrron, OpenAI-compatible, `nicrron/auto` by default; tool calling for the agent |
| Tracing | PRISM over HTTP (`src/server/prism.ts`) |
| Email in | Cloudflare Email Routing to an Email Worker, through a per-business forwarding address (OAuth mailbox sync comes later) |
| Scheduled work | Worker Cron Triggers (daily sweep for reminders and projections) |
| Email out | Cloudflare Email Sending (reminders and digests; vendor disputes only after Approve) |
| Validation | zod at every boundary (requests, model JSON output, CSV rows) |
| Pure logic | `src/lib/money/`, `src/lib/rules/`, `src/lib/tax/`: no I/O, fully unit-tested |
| Server-only | `src/server/`: env, DB, Nicrron, PRISM, agent loop |

Existing conventions:

- Server env is read with `getServerEnv()` in `src/server/env.ts` (Worker bindings,
  or `.dev.vars` locally). Add new secrets there and to `.env.example`, and
  upload them with `wrangler secret put`.
- Components use the semantic colour tokens in `src/styles.css` only, never raw
  palette classes. Status colours: `success`, `warning`, `info`, `destructive`.
- Commit messages: subject and body only, no `Co-Authored-By` trailer.

## Working in parallel

Work happens on separate branches and machines. Keep changes from colliding:

- One branch and PR per piece of work, branched from the latest `main`. Stay
  inside the files and folders your change owns.
- Shared types (`src/lib/busyq/types.ts`) and the DB schema change only in their
  own small PR, so others can rebase right away.
- The Drizzle schema is split by domain (`src/db/schema/<domain>.ts`). Generate a
  migration only after rebasing on `main`. Never hand-merge `drizzle/meta`: if it
  conflicts, delete your migration and run `db:generate` again.
- On a `bun.lock` conflict, take `main`'s version and run `bun install`. If
  `src/routeTree.gen.ts` conflicts, run `bun run build` to regenerate it.
- If something you need hasn't merged yet, build against the shared zod types
  and fixtures, then wire in the real thing when it lands.

## Plan

Phases run in order. Every change ends green on `bun run typecheck`,
`bun run check`, and `bun run test`.

### Phase 0: Foundations (done)

- TanStack Start + Tailwind semantic tokens + UI primitives, deployed to Cloudflare
- Nicrron client and `POST /api/chat`
- PRISM trace per chat turn

### Phase 1: BusyQ agent demo (hackathon)

1. **Shared types and money core.**
   - zod schemas in `src/lib/busyq/types.ts`: `Invoice`, `InvoiceLine`,
     `PriceRow`, `Payment`, `Finding`, `ToolResult`.
   - `src/lib/money/`: decimal helpers, minor-unit conversion, formatting,
     rounding modes.
2. **PRISM tool-call ingest, resolved early.**
   - `/api/traces` only documents `model`, `input_messages`, `output_message`,
     `latency_ms`, and `session_id`.
   - Confirm PRISM's span/tool-call format (the Python SDK posts to
     `/api/spans/ingest`) and whether it accepts tool name, status, error, and
     metadata. Don't guess field names.
3. **Synthetic data.**
   - `scripts/generate-data.ts`, seeded and deterministic, writes to `data/`:
     - `price_list.csv` (vendor, item, unit, agreed unit price, pack size)
     - 30–50 `invoices/*.json` for school kitchens with planted mistakes
       (overcharge, duplicate line, wrong total)
     - `payments.csv` with duplicate payments and payments with no invoice
     - `answer_key.csv`
   - About 10 invoices use vendor-name and unit variants ("HARBOR FOODS INC" vs
     "Harbor Foods", "case" vs "lb"), so v1 fails the same way repeatedly.
4. **Rules engine (no AI).** `src/lib/rules/`:
   - `lookupPrices`: v1 matches exact strings only, on purpose
   - `compareLines`, `checkInvoice`, `checkPayments`, `calculateImpact`
   - `scoreRun` against the answer key
5. **Persistence.**
   - D1 + Drizzle: vendors, price_list, invoices, invoice_lines, payments,
     agent_runs, findings, dispute_drafts, approvals (append-only).
   - A seed script loads `data/`.
6. **Agent loop.**
   - A Nicrron tool-calling loop in `src/server/agent/`, one run per invoice.
   - 6+ tool calls per run: `get_invoice`, `lookup_vendor_prices`,
     `compare_lines`, `check_invoice`, `check_payments`, `calculate_impact`,
     `save_dispute_draft`.
   - Tools return structured errors instead of throwing.
   - `AGENT_VERSION` (`v1` | `v2`) chooses the lookup.
   - `POST /api/runs` starts a run.
7. **PRISM tool-level tracing.**
   - One session per run.
   - One trace or span per model call and per tool call, with tool name,
     status, error, latency, and agent version.
8. **Batch runner.** `scripts/run-batch.ts` runs 50+ invoices with bounded
   concurrency and prints the score per agent version.
9. **Review UI.** One page:
   - the invoice list
   - per invoice: flags with $ impact (from code), the AI explanation, and an
     editable dispute draft
   - **Approve**, which writes to the approvals log and makes the draft read-only
10. **v2 fix.**
    - Vendor alias normalisation, plus unit conversion through pack size.
    - Re-run the same inputs under v2.
11. **Demo.**
    - A PRISM alert on failed tool calls, the cluster walkthrough, and the demo script.
    - A Devpost write-up and a backup video.

**What judges must see in PRISM:**
- **Sessions:** one run opened, showing 6+ tool calls.
- **Alert:** the failed-tool-call alert firing on a real v1 run.
- **Root cause:** a cluster of 3+ failed v1 runs with its cause, then v2 passing on the same inputs.

### Phase 2: Invoicing suite

1. **Auth and business profile.**
   - Users, a business (legal name, address, tax IDs, country, state/province,
     logo, accent colour), and membership.
2. **Tax engine.** `src/lib/tax/`, pure and fixture-tested for IN, US, UK, DE,
   FR, AU, CA, AE. Per-line tax plus each country's rounding rule.
   - **India (GST 2.0):** current slabs; CGST+SGST when supplier state equals
     place of supply, otherwise IGST; HSN/SAC on each line. Check the slab rates
     against the current CBIC notification before hard-coding them.
   - **Canada:** GST, HST, PST, or QST depending on the province.
   - **Reverse charge** for B2B cross-border supplies in the EU, UK, and UAE.
   - **US:** a sales-tax rate per line, entered by the user.
   - Headings and statutory notes per country.
3. **Clients and catalog.**
   - Clients: address, tax ID, place of supply. Clients with history are
     archived, never deleted.
   - Items catalog: price, unit, tax rate, code. Type-ahead on line items.
   - "Save as client" from a one-off document.
4. **Document editor.**
   - One editor for invoice, quote, proforma, credit note, receipt, and delivery note.
   - Drafts have no number. Totals come from the tax engine, with a live preview.
   - A per-document activity log (`logActivity()`) that later features write to.
5. **Issuing.**
   - The next number per business, type, and series (plus fiscal year where
     the country needs it), assigned atomically in a D1 batch.
   - Snapshots the business and client details. Issued documents are immutable.
6. **Payments.**
   - Partial payments with balance tracking, mark as paid, void.
   - Status is derived, never stored twice.
7. **Conversions and duplicate.**
   - quote → invoice, and invoice → receipt / credit note / delivery note,
     with links stored both ways.
   - Duplicate as a new draft.
   - An activity history view.
8. **Print.** Four layouts, with the accent colour as a CSS variable. Print /
   save as PDF from the browser.
9. **AI import.**
   - Upload → R2 → Queue (custom `src/worker.ts`) → read through Nicrron with a
     `models` fallback list.
   - Matches a client, then creates an editable draft with uncertain fields
     flagged. Traced to PRISM.

### Phase 3: Inbox, projections, and reminders

1. **Forwarding inbox.**
   - A per-business address on an Email Worker that sends attachments into the
     AI-import pipeline.
   - Messages are classified as invoice in, invoice out, contract, or ignore,
     and filed by direction.
   - Dedupe on attachment hash plus document number.
2. **Contracts.**
   - A document type for contracts and tenders, with extracted dates, notice
     period, auto-renew flag, and agreed prices.
   - Confirmed prices update the vendor's price list, which feeds the BusyQ agent.
3. **Forecast engine.** `src/lib/forecast/`:
   - **Cash calendar:** expected cash in and out over the next 30/60/90 days,
     from due dates adjusted by each counterparty's history.
   - **Trend:** month-over-month change, shown as a trailing 3-month band;
     needs at least 3 months of history.
   - **Drift alerts** for vendor spend and prices.
   - A model-written digest from these numbers only.
4. **Reminders.**
   - A daily cron. Contract reminders fire at `end_date − max(notice_period, 30 days)`.
     Invoices coming due or overdue are reminded too.
   - Idempotent per (subject, kind, due date).
   - Shown in the app and sent by email; can be snoozed or dismissed.
5. **Projections dashboard.** The cash calendar, trend bands, drift alerts, and
   the digest, with a "not enough data" state.
6. **Mailbox OAuth (later).** Gmail and Microsoft 365 sync for history
   backfill. Gmail's restricted scopes need Google's security assessment
   before production.

## PRISM tracing (do not remove)

This project sends traces to PRISM. Env vars: `PRISMTRACE_API_KEY`,
`PRISMTRACE_PROJECT_ID`, `PRISMTRACE_HOST`.

Tracing is currently wired at: `src/server/prism.ts` (HTTP ingest client and `RunTracer` span trees), `src/server/chat.ts` (Nicrron chat turn, traced on success and error), `src/routes/api/chat.ts` (POST /api/chat entry point, assigns `sessionId`), `src/server/agent/run.ts` (agent loop: every model call and tool call is a span), `src/server/agent/tracing.ts` (one PRISM session per run, agent version on the root span), `src/server/agent/gateway.ts` (Nicrron fallback, cache and cost metadata on each `llm` span and the root span), `src/routes/api/runs.ts` (POST /api/runs entry point), `src/server/env.ts` (PRISM env vars), `src/server/contracts-extract.ts` (contract reading: one session per contract, the Nicrron model call and each check as spans), `src/server/contracts-review.ts` (contract confirm, same session)

**Standing rule.** Whenever you add or change an agent, chain, graph, tool,
retriever, or any entry point that calls a model, wire it to PRISM before you
finish. Unwired code is invisible in the dashboard. If you are unsure whether
something is covered, assume it is not and wire it.
