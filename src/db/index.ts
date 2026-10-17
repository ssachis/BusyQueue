import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as business from "./schema/business.ts";
import * as busyq from "./schema/busyq.ts";

export const schema = { ...busyq, ...business };

/** Drizzle client on the Worker's D1 binding. Server-only. */
export function getDb() {
	return drizzle(env.DB, { schema });
}

export type Db = ReturnType<typeof getDb>;
