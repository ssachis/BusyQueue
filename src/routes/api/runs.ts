import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getDb } from "#/db/index.ts";
import { AgentVersion } from "#/lib/busyq/types.ts";
import { nicrronChatModel, runAgent } from "#/server/agent/run.ts";
import { createD1Store } from "#/server/agent/store.ts";
import { createRunTracer, prismConfig } from "#/server/agent/tracing.ts";
import { LOOKUPS } from "#/server/agent/versions.ts";
import { getServerEnv } from "#/server/env.ts";
import { getNicrron } from "#/server/nicrron.ts";

const bodySchema = z.object({
	invoiceId: z.string().min(1).max(100),
	version: AgentVersion.optional(),
});

/** POST /api/runs: audit one invoice with the agent and return the run. */
export const Route = createFileRoute("/api/runs")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				const parsed = bodySchema.safeParse(
					await request.json().catch(() => null),
				);
				if (!parsed.success) {
					return Response.json(
						{ error: "Invalid request", issues: parsed.error.issues },
						{ status: 400 },
					);
				}
				const env = getServerEnv();
				const version = parsed.data.version ?? env.AGENT_VERSION;
				if (!LOOKUPS[version]) {
					return Response.json(
						{ error: `Agent version ${version} is not available yet` },
						{ status: 400 },
					);
				}
				const store = createD1Store(getDb());
				if (!(await store.getInvoice(parsed.data.invoiceId))) {
					return Response.json(
						{ error: `No invoice ${parsed.data.invoiceId}` },
						{ status: 404 },
					);
				}
				const config = prismConfig(env);
				const result = await runAgent(
					{ invoiceId: parsed.data.invoiceId, version },
					{
						store,
						model: nicrronChatModel(getNicrron(env), env.AGENT_MODEL),
						modelName: env.AGENT_MODEL,
						tracerFor: (runId) =>
							createRunTracer(config, {
								runId,
								invoiceId: parsed.data.invoiceId,
								version,
							}),
					},
				);
				return Response.json(result, {
					status: result.status === "completed" ? 200 : 502,
				});
			},
		},
	},
});
