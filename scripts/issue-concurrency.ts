/**
 * Proof that issuing (#16) is atomic, against local D1 (the same
 * .wrangler/state the dev server uses), through wrangler's platform proxy.
 *
 *   bun run db:migrate:local && bun scripts/issue-concurrency.ts [count]
 *
 * Runs the real issue store (src/server/documents/issue-store.ts) and checks:
 * 1. `count` drafts issued concurrently get `count` distinct, consecutive
 *    numbers, the counter ends at count + 1, one "issued" activity each.
 * 2. Issuing ONE draft concurrently succeeds exactly once and consumes one
 *    number; the rest are told it's already issued.
 * 3. Rejected issues (no lines, bad tax code) consume no number.
 * 4. Editing an issued document or its lines is rejected by the DB, with a
 *    friendly message from lockedDocumentMessage.
 *
 * Each run uses a fresh random series, so it can be re-run; issued test
 * documents stay in local D1 (issued documents can't be deleted).
 */
import { getPlatformProxy } from "wrangler";

declare const Bun: {
	plugin(p: {
		name: string;
		setup(build: {
			module(
				specifier: string,
				cb: () => { exports: Record<string, unknown>; loader: "object" },
			): void;
		}): void;
	}): void;
};

const count = Number(process.argv[2] ?? 10);
const proxy = await getPlatformProxy();
const DB = (proxy.env as { DB: D1Database }).DB;

// The app reads its bindings from `cloudflare:workers`; hand it the proxy's.
Bun.plugin({
	name: "cloudflare-workers-proxy",
	setup(build) {
		build.module("cloudflare:workers", () => ({
			exports: { env: proxy.env },
			loader: "object",
		}));
	},
});

const { issueDraft, lockedDocumentMessage } = await import(
	"../src/server/documents/issue-store.ts"
);
const { loadBusiness, currentBusinessId } = await import(
	"../src/server/business-store.ts"
);

let failures = 0;
function check(ok: boolean, label: string) {
	console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
	if (!ok) failures++;
}

await loadBusiness();
const businessId = currentBusinessId();
const series = `Z${crypto.randomUUID().replace(/-/g, "").slice(0, 4).toUpperCase()}`
	.replace(/[^A-Z0-9]/g, "0");
const runId = crypto.randomUUID().slice(0, 8);

async function createDraft(
	n: number,
	lines: "ok" | "none" | "bad-tax" = "ok",
): Promise<string> {
	const id = `issue-proof-${runId}-${n}`;
	const stmts = [
		DB.prepare(
			`INSERT INTO documents (id, business_id, type, status, series, date, currency, buyer)
			 VALUES (?, ?, 'invoice', 'draft', ?, '2026-10-17', 'USD', ?)`,
		).bind(
			id,
			businessId,
			series,
			JSON.stringify({
				name: "Lincoln PTA",
				addressLines: [],
				country: "US",
				region: "CA",
			}),
		),
	];
	if (lines !== "none") {
		stmts.push(
			DB.prepare(
				`INSERT INTO document_lines (document_id, line_no, description, quantity, unit_price, tax_code, rate)
				 VALUES (?, 1, 'Catering', '3', '100.00', ?, ?)`,
			).bind(
				id,
				lines === "bad-tax" ? "DE-VAT-19" : "US-SALES",
				lines === "bad-tax" ? null : "7.25",
			),
			DB.prepare(
				`INSERT INTO document_lines (document_id, line_no, description, quantity, unit_price, discount, tax_code)
				 VALUES (?, 2, 'Delivery', '1', '20.00', '5.00', 'EXEMPT')`,
			).bind(id),
		);
	}
	await DB.batch(stmts);
	return id;
}

const counter = async () =>
	(
		await DB.prepare(
			`SELECT next_number FROM document_counters
			 WHERE business_id = ? AND type = 'invoice' AND series = ? AND fiscal_year = ''`,
		)
			.bind(businessId, series)
			.first<{ next_number: number }>()
	)?.next_number ?? 1;

const expected = (n: number) => `INV-${series}-${String(n).padStart(4, "0")}`;

console.log(`series ${series}, ${count} concurrent issues\n`);

// 1. N drafts issued at once.
const ids = await Promise.all(
	Array.from({ length: count }, (_, i) => createDraft(i + 1)),
);
const started = performance.now();
const settled = await Promise.allSettled(ids.map((id) => issueDraft(id)));
const ms = Math.round(performance.now() - started);
const issued = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
for (const s of settled) {
	if (s.status === "rejected") console.log("  rejected:", String(s.reason));
}
const numbers = issued.map((r) => r.number).sort();
console.log(`  issued in ${ms} ms: ${numbers.join(", ")}`);
check(issued.length === count, `all ${count} concurrent issues succeeded`);
check(new Set(numbers).size === count, "numbers are distinct");
check(
	numbers.join() ===
		Array.from({ length: count }, (_, i) => expected(i + 1)).join(),
	`numbers are consecutive ${expected(1)}..${expected(count)}`,
);
check((await counter()) === count + 1, `counter next_number = ${count + 1}`);

const rows = await DB.prepare(
	`SELECT d.id, d.number, d.status, d.total_minor, d.seller, d.issued_at,
	        (SELECT count(*) FROM document_activity a WHERE a.document_id = d.id AND a.kind = 'issued') AS issued_logs,
	        (SELECT json_extract(detail, '$.number') FROM document_activity a WHERE a.document_id = d.id AND a.kind = 'issued') AS logged_number
	 FROM documents d WHERE d.id LIKE ?`,
)
	.bind(`issue-proof-${runId}-%`)
	.all<{
		id: string;
		number: string;
		status: string;
		total_minor: number;
		seller: string | null;
		issued_at: string | null;
		issued_logs: number;
		logged_number: string;
	}>();
check(
	rows.results.every(
		(r) =>
			r.status === "issued" &&
			r.total_minor === 33675 &&
			r.seller !== null &&
			r.issued_at !== null &&
			r.issued_logs === 1 &&
			r.logged_number === r.number,
	),
	"each document: issued, totals frozen (33675), seller snapshot, one activity row with its number",
);

// 2. One draft, issued concurrently many times.
const single = await createDraft(1000);
const race = await Promise.allSettled(
	Array.from({ length: count }, () => issueDraft(single)),
);
const winners = race.filter((r) => r.status === "fulfilled");
const losers = race.flatMap((r) => (r.status === "rejected" ? [r.reason] : []));
console.log(
	`  same draft x${count}: ${winners.length} issued, ${losers.length} rejected (${
		losers[0] instanceof Error ? losers[0].message : losers[0]
	})`,
);
check(winners.length === 1, "the same draft is issued exactly once");
check(
	losers.every((e) => e instanceof Error && /Already issued as/.test(e.message)),
	"the other attempts are told it's already issued",
);
check((await counter()) === count + 2, "only one number consumed");
const logs = await DB.prepare(
	`SELECT count(*) AS n FROM document_activity WHERE document_id = ? AND kind = 'issued'`,
)
	.bind(single)
	.first<{ n: number }>();
check(logs?.n === 1, "only one issued activity row");

// 3. Rejected issues consume no number.
const noLines = await createDraft(2000, "none");
const badTax = await createDraft(2001, "bad-tax");
const rejected = await Promise.allSettled([
	issueDraft(noLines),
	issueDraft(badTax),
]);
for (const r of rejected) {
	console.log(
		"  rejected as expected:",
		r.status === "rejected" ? (r.reason as Error).message : "NOT REJECTED",
	);
}
check(
	rejected.every((r) => r.status === "rejected"),
	"drafts with no lines or a bad tax code are rejected",
);
const next = await issueDraft(await createDraft(2002));
check(
	next.number === expected(count + 2),
	`the next good issue gets ${expected(count + 2)} (got ${next.number})`,
);

// 4. Issued documents are locked.
async function rejects(label: string, stmt: D1PreparedStatement) {
	try {
		await stmt.run();
		check(false, `${label} is rejected`);
	} catch (err) {
		const friendly = lockedDocumentMessage(err);
		console.log(`  ${label}: ${friendly}`);
		check(friendly !== null, `${label} is rejected with a friendly message`);
	}
}
await rejects(
	"editing an issued line",
	DB.prepare(
		`UPDATE document_lines SET quantity = '4' WHERE document_id = ? AND line_no = 1`,
	).bind(next.documentId),
);
await rejects(
	"adding a line to an issued document",
	DB.prepare(
		`INSERT INTO document_lines (document_id, line_no, description, quantity, unit_price, tax_code)
		 VALUES (?, 9, 'Extra', '1', '1.00', 'EXEMPT')`,
	).bind(next.documentId),
);
await rejects(
	"changing an issued total",
	DB.prepare(`UPDATE documents SET total_minor = 1 WHERE id = ?`).bind(
		next.documentId,
	),
);
await rejects(
	"deleting an issued document",
	DB.prepare(`DELETE FROM documents WHERE id = ?`).bind(next.documentId),
);
const reissue = await issueDraft(next.documentId).catch((e: Error) => e);
check(
	reissue instanceof Error && reissue.message === `Already issued as ${next.number}`,
	"re-issuing an issued document is refused",
);

await proxy.dispose();
console.log(failures ? `\n${failures} check(s) FAILED` : "\nall checks passed");
process.exit(failures ? 1 : 0);
