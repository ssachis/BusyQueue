import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { AgentVersion } from "#/lib/busyq/types.ts";
import { executeRun } from "#/server/agent/execute.ts";

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
				const run = await executeRun(parsed.data);
				if (!run.ok) {
					return Response.json({ error: run.error }, { status: run.status });
				}
				return Response.json(run.result, {
					status: run.result.status === "completed" ? 200 : 502,
				});
			},
		},
	},
});
