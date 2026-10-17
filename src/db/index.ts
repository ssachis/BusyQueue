import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as busyq from "./schema/busyq.ts";

export const schema = { ...busyq };

/** Drizzle client on the Worker's D1 binding. Server-only. */
export function getDb() {
	return drizzle(env.DB, { schema });
}

export type Db = ReturnType<typeof getDb>;
