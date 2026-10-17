import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as activity from "./schema/activity.ts";
import * as business from "./schema/business.ts";
import * as busyq from "./schema/busyq.ts";
import * as catalog from "./schema/catalog.ts";
import * as clients from "./schema/clients.ts";
import * as contracts from "./schema/contracts.ts";
import * as docImports from "./schema/doc-imports.ts";
import * as documentLinks from "./schema/document-links.ts";
import * as documentPayments from "./schema/document-payments.ts";
import * as documents from "./schema/documents.ts";
import * as imports from "./schema/imports.ts";
import * as numbering from "./schema/numbering.ts";
import * as reminders from "./schema/reminders.ts";

export const schema = {
	...busyq,
	...business,
	...documents,
	...activity,
	...numbering,
	...documentPayments,
	...documentLinks,
	...contracts,
	...imports,
	...clients,
	...catalog,
	...reminders,
	...docImports,
};

/** Drizzle client on the Worker's D1 binding. Server-only. */
export function getDb() {
	return drizzle(env.DB, { schema });
}

export type Db = ReturnType<typeof getDb>;
