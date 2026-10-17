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

Show the review page: the invoice list, and the flags with dollar impact.

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
- **In the app** (`/?v=v1`): the **"Why v1 runs fail"** panel groups the failed tool
  calls and names the cause in one code-generated sentence. It lists the vendor spellings
  that don't match the price list, and the units billed differently from the contract.
  This works without PRISM's judge.
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

On `/?v=v2&invoice=inv-1001`, edit the agent's email if you want, then Approve:
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
