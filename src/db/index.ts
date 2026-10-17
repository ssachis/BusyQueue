import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as activity from "./schema/activity.ts";
import * as business from "./schema/business.ts";
import * as busyq from "./schema/busyq.ts";
import * as contracts from "./schema/contracts.ts";
import * as documentPayments from "./schema/document-payments.ts";
import * as documents from "./schema/documents.ts";
import * as numbering from "./schema/numbering.ts";

export const schema = {
	...busyq,
	...business,
	...documents,
	...activity,
	...numbering,
	...documentPayments,
	...contracts,
};

/** Drizzle client on the Worker's D1 binding. Server-only. */
export function getDb() {
	return drizzle(env.DB, { schema });
}

export type Db = ReturnType<typeof getDb>;
