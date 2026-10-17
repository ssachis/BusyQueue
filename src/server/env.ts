import { env as workerEnv } from "cloudflare:workers";
import { z } from "zod";

/** Treat blank values as unset (common for placeholders in .dev.vars). */
const optionalString = z.preprocess(
	(v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
	z.string().min(1).optional(),
);

const serverEnvSchema = z.object({
	// ── Nicrron (OpenAI-compatible model gateway) ──
	NICRRON_API_KEY: optionalString,
	NICRRON_BASE_URL: z.string().url().default("https://api.nicrron.ai/v1"),
	/** Routing preset or concrete model, e.g. nicrron/auto, anthropic/claude-sonnet-5. */
	NICRRON_MODEL: z.string().min(1).default("nicrron/auto"),

	// ── BusyQ agent ──
	/** Model for agent runs (tool calling). Overrides NICRRON_MODEL for the agent only. */
	AGENT_MODEL: z.string().min(1).default("anthropic/claude-sonnet-5-5"),
	/**
	 * Comma-separated models Nicrron cascades to, in order, when AGENT_MODEL
	 * is rate-limited, down or unknown (sent as the `models` fallback array).
	 * Each one must support tool calling.
	 */
	AGENT_FALLBACK_MODELS: optionalString
		.default("openai/gpt-6-sol,anthropic/claude-haiku-5-5")
		.transform((v) =>
			v
				.split(",")
				.map((m) => m.trim())
				.filter((m) => m.length > 0),
		),
	/** Default price-lookup version when a run doesn't ask for one. */
	AGENT_VERSION: z.enum(["v1", "v2"]).default("v1"),

	// ── Contracts → price list ──
	/** Model that reads contracts and transcribes their terms and prices. */
	CONTRACT_MODEL: z.string().min(1).default("anthropic/claude-sonnet-5-5"),
	/**
	 * Comma-separated models Nicrron falls back to, in order, when
	 * CONTRACT_MODEL errors or is rate-limited (sent as `models`).
	 */
	CONTRACT_FALLBACK_MODELS: z
		.string()
		.default("openai/gpt-5.4-mini,anthropic/claude-haiku-5-5")
		.transform((v) =>
			v
				.split(",")
				.map((m) => m.trim())
				.filter(Boolean),
		),

	// ── PRISM tracing (disabled when the key is unset) ──
	PRISMTRACE_API_KEY: optionalString,
	PRISMTRACE_PROJECT_ID: optionalString,
	PRISMTRACE_HOST: z
		.string()
		.url()
		.default("https://api.prism.blockconvey.com"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

/**
 * Validated server env. Reads Worker bindings (wrangler vars + secrets, or
 * .dev.vars locally). Server-only: never import from client components.
 */
export function getServerEnv(): ServerEnv {
	const result = serverEnvSchema.safeParse(workerEnv);
	if (!result.success) {
		const details = result.error.issues
			.map((i) => `  ${i.path.join(".")}: ${i.message}`)
			.join("\n");
		throw new Error(`Invalid server environment:\n${details}`);
	}
	return result.data;
}
