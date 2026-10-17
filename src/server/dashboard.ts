/** Home dashboard server function (callable from the client). */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { loadDashboard } from "./dashboard-store.ts";

const Input = z.object({
	/** See reminders as of this ISO date (defaults to the server's UTC date). */
	today: z.iso.date().optional(),
});

export const getDashboard = createServerFn({ method: "GET" })
	.validator((input: unknown) => Input.parse(input ?? {}))
	.handler(({ data }) => loadDashboard(data.today));
