# BusyQ demo script (about 4 minutes)

The story: **the agent fails the same way over and over, PRISM shows us where and
why, we fix it, and the fix holds on the same invoices.**

- **App:** https://m-talks2.buddhsen-work.workers.dev
- **Agent:** Claude Sonnet 5.5 through Nicrron (`AGENT_MODEL`)
- **Data:** 40 synthetic invoices for the fictional Northfield Unified School
  District food-service office: 3 vendors and 21 planted problems.

## Before the demo (10 minutes ahead)

1. **The PRISM project's AI credential is valid.** Without it, the cluster's root-cause
   judge can't run and shows `needs_review` / "credential was rejected".
   Fix it in PRISM project settings, then re-run cluster analysis.
2. **Fresh v1 runs are inside the alert's one-hour window.** Run them within the
   hour before presenting:
   ```bash
   bun scripts/run-batch.ts --url https://m-talks2.buddhsen-work.workers.dev --version v1 --concurrency 4
   ```
3. **The cluster analysis is current.** Dashboard → Intelligence → Clusters → Analyze
   (5 credits), or:
   ```bash
   curl -X POST "$PRISMTRACE_HOST/api/intelligence/clusters/analyze?project_id=$PRISMTRACE_PROJECT_ID" \
     -H "X-PRISMtrace-Key: $PRISMTRACE_API_KEY" -H 'content-type: application/json' \
     -d "{\"project_id\":\"$PRISMTRACE_PROJECT_ID\"}"
   ```
4. **Open tabs:** the app, PRISM Sessions, PRISM Alerts, PRISM Clusters, and a
   terminal in the repo.

## 1. The problem (30 s)

> School districts buy food on fixed contract prices, and vendors drift. Our
> example: the agreed price is $2.10/lb, the invoice says $2.16/lb, and they bought
> 1,200 lb. That's $72 on one line. Nobody has time to check every invoice.

Show the dashboard (`/`), then Review bills (`/review`): the bill list, flagged bills
first by dollar impact.

## 2. One run, fully traced (60 s)

Run one invoice live:

```bash
curl -s https://m-talks2.buddhsen-work.workers.dev/api/runs \
  -H 'content-type: application/json' -d '{"invoiceId":"inv-1003","version":"v1"}'
```

- **What it finds:** bananas billed at $0.66/lb against an agreed $0.62/lb on 150 lb, so
  **$6.00**. It drafts the dispute email.
- **PRISM → Sessions:** open the run. Show the `chain` root, the `llm` calls and **7
  tool calls**: `get_invoice` → `lookup_vendor_prices` → `compare_lines` →
  `check_invoice` → `check_payments` → `calculate_impact` → `save_dispute_draft`.
- **The point:** *"the AI explains, code checks the numbers, a human approves."* The model
  never computes an amount. The draft tool rejects any dollar figure the code
  didn't produce (in testing it rejected an invented $75.00).

### Nicrron talking point (20 s)

Every model call goes through Nicrron, and the run response has a `gateway` block, for example
`{"requestedModel":"anthropic/claude-sonnet-5-5","modelCalls":6,"modelsUsed":["anthropic/claude-sonnet-5-5"],"fallbacks":0,"cacheHits":0,"costUsd":"0.040194"}`.
The same fields are on each PRISM `llm` span (`requested_model`, `resolved_model`,
`fallback_used`, `cache_hit`, `cost_usd`, `nicrron_request_id`) and on the root span.

What we checked against the live gateway (2026-10-17):
- **Fallback array.** The agent sends `models: [AGENT_MODEL, ...AGENT_FALLBACK_MODELS]`
  (default `openai/gpt-6-sol`, then `anthropic/claude-haiku-5-5`). The response's
  `model` field names the model that answered. There is no separate fallback
  header. With an unknown primary model, a request with no list returns
  `404 Model not found`. With the list, Nicrron moves on to the next model.
  A live run with `AGENT_MODEL=anthropic/claude-nonexistent-9` still completed
  on `openai/gpt-6-sol`: 8 of 8 calls fell back and it still found the $6.00 on inv-1003.
  PRISM run `5cdbfc37-c68c-42ce-b924-05d374cec0bb`,
  trace `3369f949-5fee-4a32-bd4c-6bbb25cd4286`.
- **Routing presets with tools.** All five presets returned a correct
  `get_invoice` tool call:
  - `nicrron/auto` and `nicrron/fastest` went to `anthropic/claude-haiku-5-5`
  - `nicrron/cheapest` went to `mistral/ministral-3b`
  - `nicrron/reasoning` went to `deepseek/deepseek-v4-pro`
  - `nicrron/coding` went to `anthropic/claude-opus-5-5`

  `openai/gpt-6.1-sol` rejects function tools (502), so it isn't in the fallback list.
- **Exact cache.** At temperature 0, a repeated plain request gets
  `X-Nicrron-Cache: HIT`, returns in about 200 ms and costs $0.
  **Requests that carry `tools` were never cached**, even with `x-nicrron-cache: true`.
  Agent runs therefore show `cacheHits: 0` on a repeat run (two back-to-back inv-1003
  runs: 0 and 0). That is honest, not a bug.
- **Cost.** The completion body has no cost field. Its `usage` field has
  `cache_read_tokens` (provider prompt-cache pass-through). The completion `id`
  (also `x-request-id`) looks up `GET /v1/generation?id=…` → `total_cost`. That
  endpoint isn't in the public docs but answers immediately. We read the cost as an
  exact decimal string and add it up with big.js. A run's cost appears only
  when every call reported one.

## 3. The failure, the alert, the cluster (60 s)

Recorded v1 batch against the deployed app, 40 invoices:

```
Precision        100.0%   (13 correct, 0 false flags)
Recall            68.4%   (6 planted problems missed)
Dollars found    $9,775.70 of $9,878.95 planted
Failed tool calls inside completed runs:
  lookup_vendor_prices:price_not_found x 14
```

- **PRISM → Sessions:** open a failed v1 run, e.g. `inv-1001` ("Harbor Foods, Inc."):
  - `lookup_vendor_prices` is red: `price_not_found: No agreed price for 5 of 5
    lines from vendor "Harbor Foods, Inc."`.
  - The agent says it couldn't check the lines instead of guessing.
- **In the app** (`/review`): when the latest check of a bill had failed tool calls, a
  small **"couldn't be fully checked"** notice groups them and lists the vendor spellings
  that don't match the price list, and the units billed differently from the contract.
  The bill itself says "Couldn't fully check this bill". This works without PRISM's judge.
- **PRISM → Alerts:** rule *"BusyQ: failed tool calls (v1 price lookup)"*,
  `trace_failures_per_hour` above 3, high severity.
- **PRISM → Clusters:** *"failures in busyq-auditor …"*:
  - 34 runs, severity high, trend rising;
  - the `failed_tool_call` detector fires on 100% of members.
- **Root cause:** the vendor prints its name and units its own way
  ("HARBOR FOODS INC", "Dairy-Pure", "CS", "lbs", billed per case), and v1 only
  matches exact strings.

## 4. The fix, on the same inputs (45 s)

The v2 lookup changes three things:
- **Vendor names:** ignores case, punctuation and suffixes like "Inc" and "LLC", and
  only matches when exactly one vendor fits.
- **Units:** treats synonyms as the same unit ("lbs" → "lb", "CS" → "case").
- **Packs:** prices a case through its pack size (40 lb × $2.10 = $84.00/case).

Recorded v2 batch on the **same 40 invoices**:

```
Precision        100.0%   (19 correct, 0 false flags)
Recall           100.0%   (0 planted problems missed)
Dollars found    $9,878.95 of $9,878.95 planted
```

- **No failed tool calls.** `inv-1001` now finds the planted **$30.00** bread
  overcharge, and all 7 tools are `ok`.
- **PRISM:** v2 sessions are all green, and nothing new joins the cluster.

## 5. Human in the loop (15 s)

On `/review?invoice=inv-1001`, edit the agent's email if you want, then Approve:
- **The approval is logged:** who, when, what and how much go into an append-only table.
- **The database enforces it:** triggers stop approvals being edited or deleted, and an
  approved draft can't change.

## Fallbacks

- **Model or network is slow:** use the recorded batch output above, and show sessions
  from the 18:09–18:16 UTC runs on 2026-10-17.
- **No network at all:** `bun scripts/run-batch.ts --mode rules --version v1|v2`
  runs the same rules locally with no model calls and gives the same scores.
- **Last resort:** the backup video.

## Reference runs (deployed, 2026-10-17)

| Invoice | Version | Run / PRISM session | PRISM trace | Result |
| --- | --- | --- | --- | --- |
| inv-1001 (Harbor Foods, Inc.) | v1 | `25cb2133-04af-45df-a8c4-44669cb4b0d7` | `801d507d-4d2c-4fd2-9de5-e9a73394c422` | lookup failed, $0 found |
| inv-1001 (Harbor Foods, Inc.) | v2 | `6758d34e-6fa8-45e4-b2a8-193405908391` | `ce3a160e-77b4-4f38-9b26-671c9f763d12` | $30.00 overcharge |
| inv-1003 (Valley Fresh Produce) | v1 | `01fbf8df-075a-491e-817b-c4acdec2a6b3` | `e9271d65-4c53-4fd9-9d22-fc3d7a114ab1` | $6.00 overcharge |

The invoices with variants (v1 fails, v2 passes) are inv-1001, 1004, 1005, 1006, 1007,
1012, 1020, 1022, 1023, 1024, 1026, 1028, 1033 and 1037.
