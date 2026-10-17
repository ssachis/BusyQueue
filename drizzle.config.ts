import { defineConfig } from "drizzle-kit";

// Generates SQL migrations only; wrangler applies them to D1
// (`db:migrate:local` / `db:migrate:remote`), so no credentials are needed here.
export default defineConfig({
	dialect: "sqlite",
	schema: "./src/db/schema/*.ts",
	out: "./drizzle",
});
