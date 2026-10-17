import { Combobox } from "#/components/clients/combobox.tsx";
import {
	type CatalogItemRecord,
	catalogItemToLine,
	formatUnitPrice,
} from "#/lib/clients/index.ts";
import type { DraftLine } from "#/lib/documents/types.ts";
import { findCatalogItems } from "#/server/catalog.ts";

export interface CatalogTypeaheadProps {
	/**
	 * An item was picked: a line with quantity 1 and the item's description,
	 * unit, unit price, tax code, US rate, HSN/SAC and `catalogItemId`.
	 * The editor assigns `lineNo`.
	 */
	onPick: (line: Omit<DraftLine, "lineNo">) => void;
	/** Only suggest items priced in this currency (the document's). */
	currency?: string;
	id?: string;
	placeholder?: string;
	disabled?: boolean;
}

/** Search the catalog by name or code and add the pick as a line. */
export function CatalogTypeahead({
	onPick,
	currency,
	id,
	placeholder = "Add an item from the catalog",
	disabled,
}: CatalogTypeaheadProps) {
	return (
		<Combobox<CatalogItemRecord>
			id={id}
			aria-label="Search catalog items"
			placeholder={placeholder}
			disabled={disabled}
			search={(query) => findCatalogItems({ data: { query, currency } })}
			getKey={(i) => i.id}
			emptyText={
				currency ? `No matching ${currency} items` : "No matching items"
			}
			onSelect={(item) => {
				const { lineNo: _lineNo, ...line } = catalogItemToLine(item, 1);
				onPick(line);
			}}
			renderItem={(i) => (
				<div className="flex items-baseline justify-between gap-3">
					<div className="min-w-0">
						<div className="truncate font-medium">{i.name}</div>
						{i.code ? (
							<div className="truncate font-mono text-xs text-muted-foreground">
								{i.code}
							</div>
						) : null}
					</div>
					<div className="shrink-0 text-right tabular-nums">
						{formatUnitPrice(i.unitPrice, i.currency)}
						{i.unit ? (
							<span className="text-xs text-muted-foreground"> / {i.unit}</span>
						) : null}
					</div>
				</div>
			)}
		/>
	);
}
