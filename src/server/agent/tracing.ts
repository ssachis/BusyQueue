import type { AgentVersion } from "#/lib/busyq/types.ts";
import type { ServerEnv } from "#/server/env.ts";
import { type PrismConfig, RunTracer } from "#/server/prism.ts";

export const AGENT_NAME = "busyq-auditor";

export function prismConfig(env: ServerEnv): PrismConfig | null {
	return env.PRISMTRACE_API_KEY && env.PRISMTRACE_PROJECT_ID
		? {
				apiKey: env.PRISMTRACE_API_KEY,
				projectId: env.PRISMTRACE_PROJECT_ID,
				host: env.PRISMTRACE_HOST,
			}
		: null;
}

/**
 * One PRISM session per run (`sessionId = runId`). Every model call and tool
 * call inside the run becomes a span; the agent version is on the root span
 * so v1 and v2 runs can be compared on the same inputs.
 */
export function createRunTracer(
	config: PrismConfig | null,
	run: { runId: string; invoiceId: string; version: AgentVersion },
): RunTracer {
	return new RunTracer(config, {
		sessionId: run.runId,
		name: "busyq_invoice_run",
		agentName: AGENT_NAME,
		input: { invoiceId: run.invoiceId, agentVersion: run.version },
		metadata: {
			agent_version: run.version,
			invoice_id: run.invoiceId,
			run_id: run.runId,
		},
	});
}
