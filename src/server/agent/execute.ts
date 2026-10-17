/**
 * Run the agent on one invoice with the real dependencies (D1, Nicrron,
 * PRISM). Shared by `POST /api/runs` and the review page's Run button so both
 * produce identical, traced runs.
 */

import { getDb } from "#/db/index.ts";
import type { AgentVersion } from "#/lib/busyq/types.ts";
import { getServerEnv } from "#/server/env.ts";
import { getNicrron } from "#/server/nicrron.ts";
import { nicrronChatModel, type RunResult, runAgent } from "./run.ts";
import { createD1Store } from "./store.ts";
import { createRunTracer, prismConfig } from "./tracing.ts";
import { LOOKUPS } from "./versions.ts";

export type ExecuteResult =
	| { ok: true; result: RunResult }
	| { ok: false; status: 400 | 404; error: string };

export async function executeRun(input: {
	invoiceId: string;
	version?: AgentVersion;
}): Promise<ExecuteResult> {
	const env = getServerEnv();
	const version = input.version ?? env.AGENT_VERSION;
	if (!LOOKUPS[version]) {
		return {
			ok: false,
			status: 400,
			error: `Agent version ${version} is not available yet`,
		};
	}
	const store = createD1Store(getDb());
	if (!(await store.getInvoice(input.invoiceId))) {
		return { ok: false, status: 404, error: `No invoice ${input.invoiceId}` };
	}
	const config = prismConfig(env);
	const result = await runAgent(
		{ invoiceId: input.invoiceId, version },
		{
			store,
			model: nicrronChatModel(getNicrron(env), {
				model: env.AGENT_MODEL,
				fallbacks: env.AGENT_FALLBACK_MODELS,
			}),
			modelName: env.AGENT_MODEL,
			tracerFor: (runId) =>
				createRunTracer(config, { runId, invoiceId: input.invoiceId, version }),
		},
	);
	return { ok: true, result };
}
