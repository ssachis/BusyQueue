/**
 * Saved-client picker for the document editor's "Bill to" card (#14).
 * Type-ahead over active clients by name, email, tax ID or city. Picking one
 * hands the client to the editor, which fills the buyer snapshot. When a
 * client is linked it shows the link with Change and Clear instead.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Search, UserRound, X } from "lucide-react";
import { useId, useState } from "react";
import {
	SuggestionList,
	useDebounced,
	useTypeahead,
} from "#/components/documents/editor/suggestions.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";
import { findClients } from "#/server/clients.ts";

type ClientOption = Awaited<ReturnType<typeof findClients>>[number];

export interface ClientPickerProps {
	/** The linked client, if any; its printed name comes from the buyer. */
	clientId?: string;
	linkedName: string;
	onPick: (client: ClientOption) => void;
	/** Unlink and empty the buyer. */
	onClear: () => void;
	disabled?: boolean;
}

export function ClientPicker({
	clientId,
	linkedName,
	onPick,
	onClear,
	disabled,
}: ClientPickerProps) {
	const [changing, setChanging] = useState(false);

	if (clientId && !changing) {
		return (
			<div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
				<UserRound className="size-4 text-muted-foreground" />
				<span className="min-w-0 flex-1 truncate">
					<span className="text-muted-foreground">Saved client: </span>
					<Link
						to="/clients/$id"
						params={{ id: clientId }}
						className="font-medium underline-offset-4 hover:underline"
					>
						{linkedName || "Unnamed client"}
					</Link>
				</span>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					disabled={disabled}
					onClick={() => setChanging(true)}
				>
					Change
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					disabled={disabled}
					onClick={onClear}
					className="text-muted-foreground"
				>
					<X />
					Clear
				</Button>
			</div>
		);
	}

	return (
		<ClientSearch
			autoFocus={changing}
			disabled={disabled}
			onCancel={changing ? () => setChanging(false) : undefined}
			onPick={(c) => {
				setChanging(false);
				onPick(c);
			}}
		/>
	);
}

function ClientSearch({
	onPick,
	onCancel,
	autoFocus,
	disabled,
}: {
	onPick: (client: ClientOption) => void;
	onCancel?: () => void;
	autoFocus?: boolean;
	disabled?: boolean;
}) {
	const listId = useId();
	const inputId = useId();
	const [query, setQuery] = useState("");
	const debounced = useDebounced(query.trim());
	const [focused, setFocused] = useState(false);
	const results = useQuery({
		queryKey: ["clients", "search", debounced],
		queryFn: () => findClients({ data: { query: debounced } }),
		enabled: focused,
		staleTime: 30_000,
	});
	const items = results.data ?? [];
	const typeahead = useTypeahead({
		listId,
		items,
		onPick: (c) => {
			setQuery("");
			onPick(c);
		},
	});

	const status = results.isPending
		? "Searching…"
		: results.isError
			? "Could not load clients."
			: items.length === 0
				? debounced
					? `No saved client matches "${debounced}". Type the buyer below.`
					: "No saved clients yet. Type the buyer below and save it as a client."
				: null;

	return (
		<div className="space-y-1.5">
			<label htmlFor={inputId} className="text-xs text-muted-foreground">
				Saved client
			</label>
			<div className="flex gap-2">
				<div className="relative min-w-0 flex-1">
					<Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
					<Input
						id={inputId}
						{...typeahead.inputProps}
						value={query}
						disabled={disabled}
						autoFocus={autoFocus}
						autoComplete="off"
						placeholder="Search by name, email or tax ID"
						className="pl-8"
						onChange={(e) => {
							setQuery(e.target.value);
							typeahead.setOpen(true);
						}}
						onFocus={() => {
							setFocused(true);
							typeahead.setOpen(true);
						}}
						onBlur={() => typeahead.setOpen(false)}
						onKeyDown={(e) => {
							if (e.key === "Escape" && !typeahead.open && onCancel) {
								onCancel();
								return;
							}
							typeahead.onKeyDown(e);
						}}
					/>
					<SuggestionList
						listId={listId}
						label="Saved clients"
						typeahead={typeahead}
						items={items}
						getKey={(c) => c.id}
						status={status}
					>
						{(c) => (
							<span className="block min-w-0">
								<span className="block truncate font-medium">{c.name}</span>
								<span className="block truncate text-xs text-muted-foreground">
									{[
										c.email,
										c.taxId,
										[c.city, c.country].filter(Boolean).join(", "),
									]
										.filter(Boolean)
										.join(" · ")}
								</span>
							</span>
						)}
					</SuggestionList>
				</div>
				{onCancel ? (
					<Button type="button" variant="ghost" onClick={onCancel}>
						Cancel
					</Button>
				) : null}
			</div>
		</div>
	);
}
