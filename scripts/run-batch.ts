/**
 * Run the sample invoices through the agent and score the result.
 *
 *   bun scripts/run-batch.ts --url http://localhost:3000 --version v1 --concurrency 2
 *   bun scripts/run-batch.ts --url https://<deployed> --version v1 --repeat 2   # 80 runs
 *   bun scripts/run-batch.ts --mode rules --version v1                           # rules only, no server
 *
 * Flags: --url <base>  --version v1|v2  --concurrency N (default 2)
 *        --repeat N (each invoice N times, default 1)  --limit N (first N invoices)
 *        --mode http|rules  --json (machine-readable report)
 *
 * http mode POSTs { invoiceId, version } to <base>/api/runs and expects a
 * RunResponse (see src/lib/busyq/batch.ts). 429/503 are retried with backoff;
 * anything else that goes wrong is recorded as a failed run, not a miss.
 * Output is deterministic for a given data set and agent.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	type BatchArgs,
	type RunOutcome,
	RunResponse,
	failedOutcome,
	formatReport,
	outcomeFromResponse,
	parseArgs,
	runPool,
	runWithRules,
	summarize,
} from "../src/lib/busyq/batch.ts";
import {
	parseAnswerKey,
	parseInvoice,
	parsePayments,
	parsePriceList,
} from "../src/lib/busyq/load.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function callRun(
	args: BatchArgs,
	invoiceId: string,
	repeat: number,
): Promise<RunOutcome> {
	let lastStatus = 0;
	for (let attempt = 0; attempt < 4; attempt++) {
		try {
			const res = await fetch(`${args.url}/api/runs`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ invoiceId, version: args.version }),
				signal: AbortSignal.timeout(120_000),
			});
			lastStatus = res.status;
			if (res.status === 429 || res.status === 503) {
				await sleep(2000 * (attempt + 1));
				continue;
			}
			if (!res.ok) {
				const body = (await res.text()).slice(0, 200);
				return failedOutcome(invoiceId, repeat, `http_${res.status}`, body);
			}
			const parsed = RunResponse.safeParse(await res.json());
			if (!parsed.success) {
				return failedOutcome(invoiceId, repeat, "bad_response", parsed.error.message.slice(0, 200));
			}
			return outcomeFromResponse(parsed.data, repeat);
		} catch (err) {
			if (attempt === 3) {
				const message = err instanceof Error ? err.message : String(err);
				return failedOutcome(invoiceId, repeat, "network", message.slice(0, 200));
			}
			await sleep(1000 * (attempt + 1));
		}
	}
	return failedOutcome(invoiceId, repeat, `http_${lastStatus}`, "Gave up after retries");
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const root = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
	const read = (p: string) => readFileSync(join(root, p), "utf8");

	const invoices = readdirSync(join(root, "invoices"))
		.sort()
		.map((f) => parseInvoice(JSON.parse(read(`invoices/${f}`))))
		.slice(0, args.limit ?? undefined);
	const answerKey = parseAnswerKey(read("answer_key.csv"));
	const rulesData = {
		prices: parsePriceList(read("price_list.csv")),
		payments: parsePayments(read("payments.csv")),
	};

	const jobs = Array.from({ length: args.repeat }, (_, repeat) =>
		invoices.map((invoice) => ({ invoice, repeat })),
	).flat();

	const outcomes = await runPool(jobs, args.concurrency, async ({ invoice, repeat }) =>
		args.mode === "rules"
			? runWithRules(invoice, repeat, rulesData, args.version)
			: callRun(args, invoice.id, repeat),
	);

	const report = summarize(
		args.version,
		outcomes,
		invoices.map((i) => i.id),
		answerKey,
	);
	console.log(args.json ? JSON.stringify(report, null, 2) : formatReport(report));
}

main().catch((err) => {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
});
