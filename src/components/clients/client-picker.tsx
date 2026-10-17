import { Building2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
	type ClientRecord,
	type PickedClient,
	shortAddress,
	toPickedClient,
} from "#/lib/clients/index.ts";
import { findClients, getClient } from "#/server/clients.ts";
import { Combobox } from "./combobox.tsx";

export interface ClientPickerProps {
	/** Id of the client currently on the document, if any. */
	value?: string;
	/**
	 * A saved client was picked: `buyer` is the snapshot to print,
	 * `placeOfSupply` (IN) and `currency` are the client's defaults, if set.
	 */
	onSelect: (client: PickedClient) => void;
	id?: string;
	disabled?: boolean;
}

/**
 * Pick a saved client by name, email or tax ID. Shows the chosen client with
 * a Change button; archived clients never appear in the suggestions.
 */
export function ClientPicker({
	value,
	onSelect,
	id,
	disabled,
}: ClientPickerProps) {
	const [selected, setSelected] = useState<ClientRecord | null>(null);
	const [searching, setSearching] = useState(!value);

	useEffect(() => {
		if (!value) {
			setSelected(null);
			setSearching(true);
			return;
		}
		if (selected?.id === value) return;
		let cancelled = false;
		getClient({ data: { id: value } })
			.then((client) => {
				if (cancelled) return;
				setSelected(client);
				setSearching(client === null);
			})
			.catch(() => {
				if (!cancelled) setSearching(true);
			});
		return () => {
			cancelled = true;
		};
	}, [value, selected?.id]);

	if (selected && !searching) {
		return (
			<div className="flex items-start justify-between gap-3 rounded-md border px-3 py-2">
				<div className="flex min-w-0 items-start gap-2">
					<Building2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
					<div className="min-w-0">
						<div className="flex items-center gap-2">
							<span className="truncate font-medium text-sm">
								{selected.name}
							</span>
							{selected.archivedAt ? (
								<Badge variant="warning">Archived</Badge>
							) : null}
						</div>
						<div className="truncate text-xs text-muted-foreground">
							{[shortAddress(selected), selected.email]
								.filter(Boolean)
								.join(" · ")}
						</div>
					</div>
				</div>
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={disabled}
					onClick={() => setSearching(true)}
				>
					Change
				</Button>
			</div>
		);
	}

	return (
		<Combobox<ClientRecord>
			id={id}
			aria-label="Search clients"
			placeholder="Search clients by name, email or tax ID"
			autoFocus={Boolean(selected)}
			disabled={disabled}
			search={(query) => findClients({ data: { query } })}
			getKey={(c) => c.id}
			emptyText="No matching clients"
			onDismiss={() => {
				if (selected) setSearching(false);
			}}
			onSelect={(client) => {
				setSelected(client);
				setSearching(false);
				onSelect(toPickedClient(client));
			}}
			renderItem={(c) => (
				<div className="min-w-0">
					<div className="truncate font-medium">{c.name}</div>
					<div className="truncate text-xs text-muted-foreground">
						{[shortAddress(c), c.email, c.taxId].filter(Boolean).join(" · ")}
					</div>
				</div>
			)}
		/>
	);
}
