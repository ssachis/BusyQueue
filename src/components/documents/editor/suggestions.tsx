/**
 * A small accessible type-ahead (ARIA 1.2 combobox + listbox) shared by the
 * client picker and the catalog type-ahead. The caller owns the input and
 * the query; this owns which suggestion is active and the keyboard.
 */
import { type KeyboardEvent, type ReactNode, useEffect, useState } from "react";
import { cn } from "#/lib/utils.ts";

/** `value`, but only after it has stopped changing for `ms`. */
export function useDebounced<T>(value: T, ms = 150): T {
	const [debounced, setDebounced] = useState(value);
	useEffect(() => {
		const t = setTimeout(() => setDebounced(value), ms);
		return () => clearTimeout(t);
	}, [value, ms]);
	return debounced;
}

export interface Typeahead<T> {
	open: boolean;
	setOpen: (open: boolean) => void;
	active: number;
	setActive: (i: number) => void;
	onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
	pick: (item: T) => void;
	/** Props for the input element. */
	inputProps: {
		role: "combobox";
		"aria-expanded": boolean;
		"aria-controls": string;
		"aria-autocomplete": "list";
		"aria-activedescendant": string | undefined;
	};
}

export function useTypeahead<T>({
	listId,
	items,
	onPick,
}: {
	listId: string;
	items: readonly T[];
	onPick: (item: T) => void;
}): Typeahead<T> {
	const [open, setOpen] = useState(false);
	const [active, setActive] = useState(0);
	const count = items.length;

	// A new result set starts at the top.
	useEffect(() => {
		if (count >= 0) setActive(0);
	}, [count]);

	const pick = (item: T) => {
		setOpen(false);
		onPick(item);
	};

	const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
		if (e.key === "ArrowDown") {
			e.preventDefault();
			if (!open) setOpen(true);
			else if (count > 0) setActive((active + 1) % count);
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			if (count > 0) setActive((active - 1 + count) % count);
		} else if (e.key === "Enter") {
			const item = items[active];
			if (open && item !== undefined) {
				e.preventDefault();
				pick(item);
			}
		} else if (e.key === "Escape") {
			if (open) {
				e.preventDefault();
				setOpen(false);
			}
		}
	};

	return {
		open,
		setOpen,
		active,
		setActive,
		onKeyDown,
		pick,
		inputProps: {
			role: "combobox",
			"aria-expanded": open,
			"aria-controls": listId,
			"aria-autocomplete": "list",
			"aria-activedescendant":
				open && count > 0 ? `${listId}-${active}` : undefined,
		},
	};
}

/** The dropdown. Render inside a `relative` wrapper around the input. */
export function SuggestionList<T>({
	listId,
	label,
	typeahead,
	items,
	getKey,
	children,
	status,
	footer,
}: {
	listId: string;
	label: string;
	typeahead: Typeahead<T>;
	items: readonly T[];
	getKey: (item: T) => string;
	children: (item: T) => ReactNode;
	/** Shown instead of options: loading, no matches, errors. */
	status?: ReactNode;
	footer?: ReactNode;
}) {
	if (!typeahead.open) return null;
	return (
		<div className="absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md">
			<div
				id={listId}
				role="listbox"
				aria-label={label}
				className="max-h-72 overflow-y-auto py-1"
			>
				{items.map((item, i) => (
					<div
						key={getKey(item)}
						id={`${listId}-${i}`}
						role="option"
						aria-selected={i === typeahead.active}
						tabIndex={-1}
						className={cn(
							"cursor-pointer px-3 py-2 text-sm",
							i === typeahead.active && "bg-accent text-accent-foreground",
						)}
						// mousedown, not click: fires before the input's blur closes the list.
						onMouseDown={(e) => {
							e.preventDefault();
							typeahead.pick(item);
						}}
						onMouseEnter={() => typeahead.setActive(i)}
					>
						{children(item)}
					</div>
				))}
			</div>
			{status ? (
				<p className="px-3 py-2 text-sm text-muted-foreground">{status}</p>
			) : null}
			{footer ? (
				<div className="border-t px-3 py-2 text-xs text-muted-foreground">
					{footer}
				</div>
			) : null}
		</div>
	);
}
