/**
 * Server-only business data access. No sign-in for the hackathon: every
 * request acts for the one demo business. `currentBusinessId()` is the seam
 * where a session lookup goes later; business-scoped code should call it
 * rather than hard-coding the id.
 *
 * Kept separate from the server functions in business.ts so the client
 * bundle never imports the D1 client.
 */
import { eq } from "drizzle-orm";
import { getDb } from "#/db/index.ts";
import { businesses } from "#/db/schema/business.ts";
import {
	type BusinessProfile,
	DEMO_BUSINESS,
	DEMO_BUSINESS_ID,
} from "#/lib/business/profile.ts";

export function currentBusinessId(): string {
	return DEMO_BUSINESS_ID;
}

/** The current business, created from DEMO_BUSINESS on first use. */
export async function loadBusiness() {
	const db = getDb();
	const id = currentBusinessId();
	const [row] = await db.select().from(businesses).where(eq(businesses.id, id));
	if (row) return row;
	await db
		.insert(businesses)
		.values({ id, ...DEMO_BUSINESS })
		.onConflictDoNothing();
	const [created] = await db
		.select()
		.from(businesses)
		.where(eq(businesses.id, id));
	if (!created) throw new Error("Could not create the business profile");
	return created;
}

export type Business = Awaited<ReturnType<typeof loadBusiness>>;

export async function saveBusiness(profile: BusinessProfile) {
	await loadBusiness();
	await getDb()
		.update(businesses)
		.set({ ...profile, updatedAt: new Date().toISOString() })
		.where(eq(businesses.id, currentBusinessId()));
	return loadBusiness();
}
