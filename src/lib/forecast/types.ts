/**
 * Forecast engine inputs. Generic on purpose: the same `CashItem` describes a
 * vendor bill we owe (direction "out", BusyQ today) and an invoice we issued
 * (direction "in", the invoicing suite). Amounts are decimal strings exactly as
 * printed; every computed amount the engine returns is integer minor units.
 */
import { z } from "zod";
import { CurrencyCode, DecimalString, IsoDate } from "#/lib/busyq/types.ts";

export const Direction = z.enum(["in", "out"]);
/** "in" = money we receive (revenue), "out" = money we pay (spend). */
export type Direction = z.infer<typeof Direction>;

export const CashItem = z.object({
	id: z.string().min(1),
	direction: Direction,
	/** Canonical counterparty name (resolve aliases before calling the engine). */
	counterparty: z.string().min(1),
	currency: CurrencyCode,
	/** Document total in major units, e.g. "3522.50". */
	amount: DecimalString,
	issueDate: IsoDate,
	/** Null when the document has no due date; the engine then assumes default terms. */
	dueDate: IsoDate.nullable(),
	/** Date the item was settled in full, or null while it is open. */
	paidOn: IsoDate.nullable(),
	category: z.string().min(1).optional(),
});
export type CashItem = z.infer<typeof CashItem>;

/** One billed unit price, for price-drift alerts. Usually one invoice line. */
export const LineObservation = z.object({
	vendor: z.string().min(1),
	item: z.string().min(1),
	unit: z.string().min(1),
	unitPrice: DecimalString,
	date: IsoDate,
	/** Prices in different currencies are never compared. */
	currency: CurrencyCode.optional(),
	/** Where the observation came from (e.g. an invoice id), echoed on alerts. */
	ref: z.string().min(1).optional(),
});
export type LineObservation = z.infer<typeof LineObservation>;

/** An expected/low/high amount in integer minor units. `low ≤ expected ≤ high`. */
export interface AmountRange {
	expectedMinor: number;
	lowMinor: number;
	highMinor: number;
}

/** Cash in, cash out and net (in − out) for one period. */
export interface FlowRange {
	in: AmountRange;
	out: AmountRange;
	/** `low = in.low − out.high`, `high = in.high − out.low`. */
	net: AmountRange;
}

/** Thrown when inputs in different currencies would have to be summed. */
export class MixedCurrencyError extends Error {
	readonly currencies: string[];
	constructor(currencies: string[]) {
		super(
			`Refusing to sum amounts in different currencies (${currencies.join(", ")}). Forecast each currency separately.`,
		);
		this.name = "MixedCurrencyError";
		this.currencies = currencies;
	}
}
