# BusyQ: an agent that audits school-district food-service invoices

*Money Talks 2, Money Operations track. Built with PRISM and Nicrron.*

## Inspiration

School food-service offices buy from a few contract vendors at fixed prices, but nobody has time to check every invoice line against the contract. Overcharges, duplicate lines, wrong totals and duplicate payments slip through, and the money is public money. Overbilling of this kind is well documented in college and school foodservice.

## What it does

BusyQ reads a district's vendor invoices and payments, checks them against the contract price list, and finds money lost to mistakes:

- **Overcharges** against the agreed price (including lines billed per case when the contract is per pound)
- **Duplicate lines** and **wrong totals** on an invoice
- **Duplicate payments** and **payments with no invoice**

For each flagged invoice it drafts the dispute email to the vendor. An owner reviews the findings, edits the draft and clicks **Approve**. Nothing goes to a vendor without that click, and every approval is written to an append-only log.

**AI explains, code calculates, a human approves.** The model chooses tools and writes prose. Every dollar amount comes from pure, unit-tested, decimal-exact code (amounts are integer cents; no floats).

Example from the demo data: a Dairy Pure invoice bills 30 cases of 1% milk at $11.05; the contract price is $9.85. BusyQ flags a **$36.00** overcharge and drafts the dispute.

## How PRISM shows the failure, the fix and the alert

The demo story is failure, fix, alert.

- **Sessions:** every invoice is one PRISM session. Each model call and each of the 6+ tool calls (`get_invoice`, `lookup_vendor_prices`, `compare_lines`, `check_invoice`, `check_payments`, `calculate_impact`, `save_dispute_draft`) is a span, with tool name, status, error, latency and the agent version.
- **Alert:** v1 deliberately matches vendors and units by exact string. On invoices that spell a vendor or unit differently ("HARBOR FOODS INC", "CS", billed per case against a per-lb contract), `lookup_vendor_prices` fails with `price_not_found`. A PRISM alert on failed tool calls fires on a real v1 run.
- **Root cause:** 14 of 40 invoices fail the same way, which PRISM clusters. We fixed the cause in v2 (vendor alias normalisation and pack-size conversion) and re-ran the **same inputs**: failures cleared.

Rules-only scores on the 40-invoice set: v1 recall 68.4% with 59 unpriced lines; v2 recall 100%, zero false flags, $9,878.95 found of $9,878.95 planted. A batch runner prints this report for any agent version against a local or deployed URL.

## How we built it

TanStack Start on a single Cloudflare Worker, D1 with Drizzle for runs, findings, dispute drafts and approvals, zod at every boundary, big.js for exact money. All model calls go through **Nicrron** (OpenAI-compatible, with tool calling). A seeded generator creates a fictional district (Northfield Unified School District) with planted mistakes and an answer key, so the agent is scored, not eyeballed.

## Challenges

Making failures visible: v1 does not crash, it silently cannot check some lines. Keeping the model away from the arithmetic. Getting the failure to be a real, repeated, clusterable pattern instead of a staged one.

## What is next

Contracts feed the price list automatically, an inbox that receives vendor bills by email, and cash and price-drift projections.

## Data note

All demo data is **synthetic**. Northfield Unified School District and its vendors are fictional.

## Links

- Repo: https://github.com/ssachis/BusyQueue
- Demo video: _add link_
- Screenshots: `docs/media/`
