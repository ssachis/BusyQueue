import { FileUp, Loader2 } from "lucide-react";
import { type DragEvent, useRef, useState } from "react";
import { Button } from "#/components/ui/button.tsx";
import { Card, CardContent } from "#/components/ui/card.tsx";
import { MAX_UPLOAD_BYTES, UPLOAD_ACCEPT } from "#/lib/import/extraction.ts";
import { cn } from "#/lib/utils.ts";
import sample1003 from "../../../data/scans/inv-1003.png?url";
import sample1004 from "../../../data/scans/inv-1004.png?url";
import sample1006 from "../../../data/scans/inv-1006.png?url";

/** Rendered from data/invoices by scripts/render-scans.ts. */
const SAMPLES = [
	{ url: sample1003, name: "inv-1003.png", label: "Valley Fresh (overcharge)" },
	{
		url: sample1004,
		name: "inv-1004.png",
		label: "VALLEY FRESH, CS/lbs (v1 fails)",
	},
	{
		url: sample1006,
		name: "inv-1006.png",
		label: "Harbor Foods (wrong total)",
	},
];

export function UploadPanel({
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
							? "Reading the invoice through Nicrron…"
							: "Drop a photo or PDF of a vendor invoice"}
					</span>
					<span className="text-sm text-muted-foreground">
						{busy
							? "A vision model transcribes every printed value. This takes a few seconds."
							: `PNG, JPEG, WebP or PDF, up to ${MAX_UPLOAD_BYTES / 1024 / 1024} MB. Or click to choose a file.`}
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
					<span className="text-muted-foreground">Try a sample scan:</span>
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
