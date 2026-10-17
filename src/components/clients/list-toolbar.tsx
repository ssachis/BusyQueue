import { Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Input } from "#/components/ui/input.tsx";
import type { ArchiveFilter } from "#/lib/clients/index.ts";
import { cn } from "#/lib/utils.ts";

const FILTER_LABELS: Record<ArchiveFilter, string> = {
	active: "Active",
	archived: "Archived",
	all: "All",
};

/** Search box (debounced) and Active / Archived / All filter for a list page. */
export function ListToolbar({
	query,
	archived,
	placeholder,
	onChange,
}: {
	query: string;
	archived: ArchiveFilter;
	placeholder: string;
	onChange: (next: { query: string; archived: ArchiveFilter }) => void;
}) {
	const [text, setText] = useState(query);
	const onChangeRef = useRef(onChange);
	onChangeRef.current = onChange;

	useEffect(() => {
		if (text.trim() === query) return;
		const timer = setTimeout(
			() => onChangeRef.current({ query: text.trim(), archived }),
			250,
		);
		return () => clearTimeout(timer);
	}, [text, query, archived]);

	return (
		<div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
			<div className="relative w-full sm:max-w-sm">
				<Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
				<Input
					type="search"
					aria-label="Search"
					placeholder={placeholder}
					value={text}
					onChange={(e) => setText(e.target.value)}
					className="pl-8"
				/>
			</div>
			<fieldset className="inline-flex w-fit rounded-md border p-0.5">
				<legend className="sr-only">Show</legend>
				{(Object.keys(FILTER_LABELS) as ArchiveFilter[]).map((f) => (
					<button
						key={f}
						type="button"
						aria-pressed={archived === f}
						onClick={() => onChange({ query: text.trim(), archived: f })}
						className={cn(
							"rounded-sm px-3 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground",
							archived === f && "bg-secondary font-medium text-foreground",
						)}
					>
						{FILTER_LABELS[f]}
					</button>
				))}
			</fieldset>
		</div>
	);
}
