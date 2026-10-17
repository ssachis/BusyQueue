/** Business profile server functions (callable from the client). */
import { createServerFn } from "@tanstack/react-start";
import { BusinessProfile } from "#/lib/business/profile.ts";
import { loadBusiness, saveBusiness } from "./business-store.ts";

export const getBusiness = createServerFn({ method: "GET" }).handler(() =>
	loadBusiness(),
);

export const updateBusiness = createServerFn({ method: "POST" })
	.validator((input: unknown) => BusinessProfile.parse(input))
	.handler(({ data }) => saveBusiness(data));
