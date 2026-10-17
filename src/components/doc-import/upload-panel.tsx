import { FileUp, Loader2 } from "lucide-react";
import { type DragEvent, useRef, useState } from "react";
import { Button } from "#/components/ui/button.tsx";
import { Card, CardContent } from "#/components/ui/card.tsx";
import { MAX_UPLOAD_BYTES, UPLOAD_ACCEPT } from "#/lib/import/extraction.ts";
import { cn } from "#/lib/utils.ts";
import ptaQuote from "../../../data/scans/documents/pta-catering-quote.png?url";
import riversideInvoice from "../../../data/scans/documents/riverside-usd-invoice.png?url";

/** Rendered by scripts/render-doc-scans.ts. */
const SAMPLES = [
	{
		url: ptaQuote,
		name: "pta-catering-quote.png",
		label: "Handwritten PTA catering quote",
	},
	{
		url: riversideInvoice,
		name: "riverside-usd-invoice.png",
		label: "Invoice to Riverside USD",
	},
];

export function DocUploadPanel({
	busy,
	onFile,
}: {
	busy: boolean;
	onFile: (file: File) => void;
}) {
	const input = useRef<HTMLInputElement>(null);
	const [over, setOver] = useState(false);

	const pick = (file: File | undefined) => {
		if (file && !busy) onFile(file);
	};
	const onDrop = (e: DragEvent) => {
		e.preventDefault();
		setOver(false);
		pick(e.dataTransfer.files[0]);
	};
	const sample = async (s: (typeof SAMPLES)[number]) => {
		const blob = await (await fetch(s.url)).blob();
		pick(new File([blob], s.name, { type: "image/png" }));
	};

	return (
		<Card className="py-0">
			<CardContent className="space-y-4 p-6">
				<button
					type="button"
					disabled={busy}
					onClick={() => input.current?.click()}
					onDragOver={(e) => {
						e.preventDefault();
						setOver(true);
					}}
					onDragLeave={() => setOver(false)}
					onDrop={onDrop}
					className={cn(
						"flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-12 text-center transition-colors",
						"hover:border-primary/60 hover:bg-accent/40 focus-visible:border-ring focus-visible:outline-none",
						over ? "border-primary bg-accent/60" : "border-border",
						busy && "pointer-events-none opacity-70",
					)}
				>
					{busy ? (
						<Loader2 className="size-8 animate-spin text-muted-foreground" />
					) : (
						<FileUp className="size-8 text-muted-foreground" />
					)}
					<span className="font-medium">
						{busy
							? "Reading the document through Nicrron…"
							: "Drop a photo or PDF of a quote, invoice or receipt you wrote"}
					</span>
					<span className="text-sm text-muted-foreground">
						{busy
							? "A vision model transcribes it; code then maps tax codes and checks the totals."
							: `Typed or handwritten. PNG, JPEG, WebP or PDF, up to ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`}
					</span>
				</button>
				<input
					ref={input}
					type="file"
					accept={UPLOAD_ACCEPT}
					className="sr-only"
					tabIndex={-1}
					onChange={(e) => {
						pick(e.target.files?.[0]);
						e.target.value = "";
					}}
				/>
				<div className="flex flex-wrap items-center gap-2 text-sm">
					<span className="text-muted-foreground">Try a sample:</span>
					{SAMPLES.map((s) => (
						<Button
							key={s.name}
							size="sm"
							variant="outline"
							disabled={busy}
							onClick={() => sample(s)}
						>
							{s.label}
						</Button>
					))}
				</div>
			</CardContent>
		</Card>
	);
}
