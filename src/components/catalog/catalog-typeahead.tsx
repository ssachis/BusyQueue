/**
 * Catalog type-ahead on a document line's description (#14). Typing searches
 * active catalog items by name or code; picking one hands the item to the
 * line, which fills description, unit, price and tax. Typing freely still
 * works: the input is the description field.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useId, useState } from "react";
import {
	SuggestionList,
	useDebounced,
	useTypeahead,
} from "#/components/documents/editor/suggestions.tsx";
import { formatDecimalMoney } from "#/components/documents/preview/format.ts";
import { Input } from "#/components/ui/input.tsx";
import { findCatalogItems } from "#/server/catalog.ts";

export type CatalogOption = Awaited<
	ReturnType<typeof findCatalogItems>
>[number];

export interface CatalogTypeaheadProps {
	id: string;
	value: string;
	onChange: (value: string) => void;
	onPick: (item: CatalogOption) => void;
	/** Shown beside prices in the suggestions. */
	currency: string;
	placeholder?: string;
	invalid?: boolean;
}

export function CatalogTypeahead({
	id,
	value,
	onChange,
	onPick,
	currency,
	placeholder,
	invalid,
}: CatalogTypeaheadProps) {
	const listId = useId();
	const [touched, setTouched] = useState(false);
	const query = useDebounced(value.trim());
	const results = useQuery({
		queryKey: ["catalog", "search", query],
		queryFn: () => findCatalogItems({ data: { query } }),
		enabled: touched,
		staleTime: 30_000,
	});
	const items = results.data ?? [];
	const typeahead = useTypeahead({ listId, items, onPick });
	const show = typeahead.open && (items.length > 0 || results.isError);

	return (
		<div className="relative">
			<Input
				id={id}
				{...typeahead.inputProps}
				aria-expanded={show}
				value={value}
				placeholder={placeholder}
				autoComplete="off"
				aria-invalid={invalid ? true : undefined}
				onChange={(e) => {
					setTouched(true);
					onChange(e.target.value);
					typeahead.setOpen(true);
				}}
				onFocus={() => {
					// An empty line offers the catalog straight away.
					if (value.trim() === "") {
						setTouched(true);
						typeahead.setOpen(true);
					}
				}}
				onBlur={() => typeahead.setOpen(false)}
				onKeyDown={(e) => {
					if (e.key === "ArrowDown") setTouched(true);
					typeahead.onKeyDown(e);
				}}
			/>
			{show ? (
				<SuggestionList
					listId={listId}
					label="Catalog items"
					typeahead={typeahead}
					items={items}
					getKey={(i) => i.id}
					status={results.isError ? "Could not load the catalog." : null}
					footer={
						<span>
							From your{" "}
							<Link to="/catalog" className="underline underline-offset-4">
								catalog
							</Link>
							. Keep typing to enter a one-off line.
						</span>
					}
				>
					{(item) => (
						<span className="flex items-baseline justify-between gap-3">
							<span className="min-w-0">
								<span className="block truncate font-medium">{item.name}</span>
								{item.code ? (
									<span className="block font-mono text-xs text-muted-foreground">
										{item.code}
									</span>
								) : null}
							</span>
							<span className="shrink-0 text-xs text-muted-foreground tabular-nums">
								{formatDecimalMoney(item.unitPrice, currency)}
								{item.unit ? ` / ${item.unit}` : ""}
							</span>
						</span>
					)}
				</SuggestionList>
			) : null}
		</div>
	);
}
