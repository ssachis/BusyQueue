# Demo script (about 4 minutes)

Story: **failure, fix, alert.** The agent audits a school district's vendor invoices. v1 fails the same way on every invoice that spells a vendor or unit differently. PRISM shows the failure, clusters it, and proves the v2 fix on identical inputs.

Rule to say out loud: **AI explains, code calculates, a human approves.** Every dollar amount on screen comes from tested code, not from the model.

## Before you go on stage (10 minutes)

1. `bun install`, copy `.env.example` to `.dev.vars`, fill `NICRRON_API_KEY`, `PRISMTRACE_API_KEY`, `PRISMTRACE_PROJECT_ID`.
2. `bun run db:migrate:local && bun run db:seed:local`
3. `bun run dev` (http://localhost:3000). Or use the deployed URL for every command below.
4. **Warm the PRISM view first (the real v1 run).** One batch, both versions, same inputs:
   ```
   bun scripts/run-batch.ts --url http://localhost:3000 --version v1 --concurrency 2
   bun scripts/run-batch.ts --url http://localhost:3000 --version v2 --concurrency 2
   ```
   Keep both reports. v1 prints precision 100% and low recall plus a `lookup_vendor_prices:price_not_found` count; v2 should print recall 100%.
5. In PRISM, create the alert **once** (see "PRISM setup" below), then run one more v1 batch so the alert fires on a fresh run during the demo window.
6. No keys or no network? Run `bun scripts/run-batch.ts --mode rules --version v1` and `--version v2`. It uses the same rules with no server, so the score story still works. Say it is rules-only.

## Click path

**1. The problem (30 s).** Review page (`/`). "A district food-service office buys from three contract vendors. Prices are fixed by contract, so a bill above the agreed price is money lost. Here are 40 invoices. 21 planted mistakes: overcharges, duplicate lines, wrong totals, duplicate payments, payments with no invoice." (Fictional district: Northfield Unified. Say it.)

**2. One run, 6+ tool calls (45 s).** PRISM, **Sessions**. Open one run. Point at the span tree: `get_invoice`, `lookup_vendor_prices`, `compare_lines`, `check_invoice`, `check_payments`, `calculate_impact`, `save_dispute_draft`, with `llm:` spans between them. "One session per invoice. Every model call and every tool call is a span. The agent version is on the root span."

**3. The failure and the alert (60 s).** Open a **v1** run on a variant invoice (for example `inv-1001`, vendor "Harbor Foods, Inc."). `lookup_vendor_prices` errored with `price_not_found`: the contract says "Harbor Foods", the invoice says "Harbor Foods, Inc.". Show the alert that fired on failed tool calls. "The agent did not crash. It quietly could not check those lines, which is the dangerous kind of failure."

**4. The cluster and root cause (45 s).** In PRISM, filter v1 runs with failed `lookup_vendor_prices`. 14 of 40 invoices fail the same way: vendor name variants ("HARBOR FOODS INC", "Dairy-Pure", "Valley Fresh") and unit variants ("CS", "lbs", billed per case when the contract is per lb). "Same input shape, same error, one cause."

**5. The fix (30 s).** v2: vendor alias normalisation and pack-size conversion (contract price per lb x 40 lb per case). Show the diff stat (`src/lib/rules/lookup-v2.ts`, `aliases.ts`), nothing else changed. Rerun the **same invoices** with `--version v2`.

**6. Proof (30 s).** Compare the two batch reports side by side, and the v2 sessions in PRISM: 0 failed lookups. Rules-only numbers for reference: unpriced lines 59 to 0, recall 68.4% to 100%, no false flags, $9,878.95 found of $9,878.95 planted.

**7. The human (30 s).** Back on the review page. Open `inv-1023` (Dairy Pure Co): 30 cases of 1% milk billed at $11.05, contract $9.85, **$36.00** overcharge, computed by code. Show the dispute draft, edit a line, click **Approve**. The draft goes read-only and an append-only approval is logged. "Nothing goes to the vendor without this click."

## PRISM setup (do this once, ahead of time)

PRISM's dashboard configuration is not in the repo, so do it by hand and note the exact clicks here.

- **Alert:** failed tool calls on `lookup_vendor_prices` (tool status error), project = ours. Notify to your email or a Slack channel. Test it by running one v1 invoice that uses a variant vendor name.
- **Cluster view:** group failed runs by `tool_name` and error code. The v1 cause is `price_not_found`.
- **Compare view:** filter by root-span metadata `agent_version` = `v1` vs `v2`.
- Fill in here once done: alert name ____, dashboard link ____.

## If something goes wrong

| Problem | Fallback |
| --- | --- |
| Model calls are slow or rate limited | Run with `--concurrency 1 --limit 10`; or show the pre-warmed sessions from step 4 of the setup |
| Nicrron or PRISM is down | Use `--mode rules` for the numbers, and the screenshots / video in `docs/media/` for the PRISM views |
| Alert has not fired | Show the failed span and say the alert rule; run one more v1 variant invoice and refresh |
| Local server will not start | Use the deployed URL, or the backup video |
| Review page looks off | The data and score story does not depend on it; stay in PRISM |

## What to say if asked

- **Is the data real?** No. Fictional district, synthetic invoices with planted mistakes and an answer key, so we can score the agent.
- **Does the model do the math?** No. Prices, totals and impact come from decimal-exact code. The model reads, calls tools and writes the dispute email.
- **Can it email a vendor by itself?** No. Approve is required, and it is logged.
