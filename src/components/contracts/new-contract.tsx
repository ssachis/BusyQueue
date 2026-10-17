import { useNavigate } from "@tanstack/react-router";
import { FileText, Loader2, Sparkles, Upload } from "lucide-react";
import { type ChangeEvent, type FormEvent, useRef, useState } from "react";
import { toast } from "sonner";
import { PageBody, PageHeader } from "#/components/app-shell.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "#/components/ui/card.tsx";
import { Label } from "#/components/ui/label.tsx";
import { Textarea } from "#/components/ui/textarea.tsx";
import { MAX_CONTRACT_CHARS } from "#/lib/contracts/types.ts";
import { readContract } from "#/server/contracts.ts";
import sampleContract from "../../../data/contracts/harbor-foods-2026.txt?raw";

/** Plain-text formats read in the browser. PDFs: copy the text and paste it. */
const TEXT_FILES = ".txt,.text,.md,.csv,text/plain,text/markdown,text/csv";

export function NewContract() {
	const navigate = useNavigate();
	const fileInput = useRef<HTMLInputElement>(null);
	const [text, setText] = useState("");
	const [sourceName, setSourceName] = useState<string | null>(null);
	const [reading, setReading] = useState(false);

	async function onFile(e: ChangeEvent<HTMLInputElement>) {
		const file = e.target.files?.[0];
		e.target.value = "";
		if (!file) return;
		if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
			toast.error(
				"PDFs aren't read yet. Open the PDF, copy its text and paste it here.",
			);
			return;
		}
		if (file.size > MAX_CONTRACT_CHARS * 4) {
			toast.error("That file is too large to read at once.");
			return;
		}
		setText(await file.text());
		setSourceName(file.name);
	}

	async function onSubmit(e: FormEvent) {
		e.preventDefault();
		setReading(true);
		try {
			const result = await readContract({ data: { text, sourceName } });
			toast.success(`Contract read by ${result.model}`);
			await navigate({
				to: "/contracts/$contractId",
				params: { contractId: result.id },
			});
		} catch (err) {
			toast.error(
				err instanceof Error ? err.message : "Could not read the contract",
			);
			setReading(false);
		}
	}

	return (
		<>
			<PageHeader
				title="Add a contract"
				description="Paste a bid award or vendor price agreement. BusyQ reads the term and the agreed prices; you check them against the current price list before anything changes."
			/>
			<PageBody>
				<form onSubmit={onSubmit} className="max-w-4xl space-y-6">
					<Card>
						<CardHeader>
							<CardTitle>Contract text</CardTitle>
							<CardDescription>
								Paste the text, or upload a .txt file. For a PDF, copy its text
								and paste it here.
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-3">
							<div className="flex flex-wrap items-center gap-2">
								<input
									ref={fileInput}
									type="file"
									accept={TEXT_FILES}
									className="hidden"
									onChange={onFile}
								/>
								<Button
									type="button"
									variant="outline"
									size="sm"
									onClick={() => fileInput.current?.click()}
								>
									<Upload />
									Upload text file
								</Button>
								<Button
									type="button"
									variant="outline"
									size="sm"
									onClick={() => {
										setText(sampleContract);
										setSourceName("harbor-foods-2026.txt");
									}}
								>
									<FileText />
									Use sample: Harbor Foods 2026 award
								</Button>
								{sourceName ? (
									<span className="text-xs text-muted-foreground">
										{sourceName}
									</span>
								) : null}
							</div>
							<div className="space-y-1.5">
								<Label htmlFor="contract-text" className="sr-only">
									Contract text
								</Label>
								<Textarea
									id="contract-text"
									value={text}
									onChange={(e) => {
										setText(e.target.value);
										if (!e.target.value) setSourceName(null);
									}}
									placeholder="NOTICE OF AWARD … Item / Unit / Unit price …"
									className="min-h-[24rem] font-mono text-xs"
									maxLength={MAX_CONTRACT_CHARS}
								/>
								<p className="text-xs text-muted-foreground">
									The model only transcribes. Every price it returns must appear
									in this text, or it is blocked.
								</p>
							</div>
						</CardContent>
					</Card>
					<div className="flex justify-end">
						<Button type="submit" disabled={reading || text.trim().length < 40}>
							{reading ? (
								<>
									<Loader2 className="animate-spin" />
									Reading the contract…
								</>
							) : (
								<>
									<Sparkles />
									Read contract
								</>
							)}
						</Button>
					</div>
				</form>
			</PageBody>
		</>
	);
}
