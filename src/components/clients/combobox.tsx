import { Loader2, Search } from "lucide-react";
import {
	type KeyboardEvent,
	type ReactNode,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import { Input } from "#/components/ui/input.tsx";
import { cn } from "#/lib/utils.ts";

export interface ComboboxProps<T> {
	id?: string;
	placeholder: string;
	"aria-label"?: string;
	/** Fetch matches for the typed text ("" on focus). */
	search: (query: string) => Promise<T[]>;
	getKey: (item: T) => string;
	renderItem: (item: T) => ReactNode;
	onSelect: (item: T) => void;
	emptyText: string;
	autoFocus?: boolean;
	disabled?: boolean;
	/** Called with Escape or when focus leaves without a pick. */
	onDismiss?: () => void;
}

const DEBOUNCE_MS = 150;

/**
 * Text input with an async suggestion list (ARIA combobox pattern):
 * arrows move, Enter picks, Escape closes. Stale responses are dropped.
 * The input clears after a pick.
 */
export function Combobox<T>({
	id,
	placeholder,
	"aria-label": ariaLabel,
	search,
	getKey,
	renderItem,
	onSelect,
	emptyText,
	autoFocus,
	disabled,
	onDismiss,
}: ComboboxProps<T>) {
	const listId = useId();
	const [query, setQuery] = useState("");
	const [open, setOpen] = useState(false);
	const [items, setItems] = useState<T[]>([]);
	const [active, setActive] = useState(0);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const request = useRef(0);
	const searchRef = useRef(search);
	searchRef.current = search;

	useEffect(() => {
		if (!open) return;
		const seq = ++request.current;
		setLoading(true);
		const timer = setTimeout(() => {
			searchRef
				.current(query)
				.then((found) => {
					if (seq !== request.current) return;
					setItems(found);
					setActive(0);
					setError(null);
				})
				.catch((err: unknown) => {
					if (seq !== request.current) return;
					setItems([]);
					setError(err instanceof Error ? err.message : "Search failed");
				})
				.finally(() => {
					if (seq === request.current) setLoading(false);
				});
		}, DEBOUNCE_MS);
		return () => clearTimeout(timer);
	}, [query, open]);

	function pick(item: T) {
		onSelect(item);
		setQuery("");
		setOpen(false);
	}

	function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
		if (e.key === "ArrowDown") {
			e.preventDefault();
			if (!open) setOpen(true);
			else setActive((i) => Math.min(i + 1, items.length - 1));
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			setActive((i) => Math.max(i - 1, 0));
		} else if (e.key === "Enter") {
			const item = items[active];
			if (open && item) {
				e.preventDefault();
				pick(item);
			}
		} else if (e.key === "Escape") {
			setOpen(false);
			onDismiss?.();
		}
	}

	const optionId = (i: number) => `${listId}-opt-${i}`;
	const showList = open && !disabled;

	return (
		<div className="relative">
			<Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
			<Input
				id={id}
				role="combobox"
				aria-label={ariaLabel}
				aria-expanded={showList}
				aria-controls={listId}
				aria-autocomplete="list"
				aria-activedescendant={
					showList && items[active] ? optionId(active) : undefined
				}
				autoComplete="off"
				autoFocus={autoFocus}
				disabled={disabled}
				placeholder={placeholder}
				value={query}
				className="pl-8"
				onChange={(e) => {
					setQuery(e.target.value);
					setOpen(true);
				}}
				onFocus={() => setOpen(true)}
				onBlur={() => {
					setOpen(false);
					onDismiss?.();
				}}
				onKeyDown={onKeyDown}
			/>
			{showList ? (
				<div
					id={listId}
					role="listbox"
					className="absolute z-40 mt-1 max-h-80 w-full overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
				>
					{items.map((item, i) => (
						<div
							key={getKey(item)}
							id={optionId(i)}
							role="option"
							tabIndex={-1}
							aria-selected={i === active}
							className={cn(
								"cursor-pointer rounded-sm px-2 py-1.5 text-sm",
								i === active && "bg-accent text-accent-foreground",
							)}
							onMouseEnter={() => setActive(i)}
							// mousedown fires before the input's blur closes the list
							onMouseDown={(e) => {
								e.preventDefault();
								pick(item);
							}}
						>
							{renderItem(item)}
						</div>
					))}
					{items.length === 0 ? (
						<div className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground">
							{loading ? (
								<>
									<Loader2 className="size-4 animate-spin" />
									Searching…
								</>
							) : (
								(error ?? emptyText)
							)}
						</div>
					) : null}
				</div>
			) : null}
		</div>
	);
}
