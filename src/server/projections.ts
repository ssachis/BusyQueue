/** Projections page server functions (callable from the client). */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { IsoDate } from "#/lib/busyq/types.ts";
import { writeDigest } from "./projections-digest.ts";
import { loadProjections } from "./projections-store.ts";

const AsOfInput = z.object({ asOf: IsoDate.optional() });

export const getProjections = createServerFn({ method: "GET" })
	.validator((input: unknown) => AsOfInput.parse(input))
	.handler(({ data }) => loadProjections(data.asOf));

/** Model-written summary of the forecast; every figure is checked by code. */
export const writeProjectionsDigest = createServerFn({ method: "POST" })
	.validator((input: unknown) => AsOfInput.parse(input))
	.handler(({ data }) => writeDigest(data.asOf));
