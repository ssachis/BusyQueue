import { Loader2, Send } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "#/components/ui/button.tsx";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "#/components/ui/card.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Label } from "#/components/ui/label.tsx";
import { Textarea } from "#/components/ui/textarea.tsx";
import { UPLOAD_ACCEPT } from "#/lib/import/extraction.ts";
import { buildEml } from "#/lib/inbox/eml.ts";
import { simulateEmail } from "#/server/inbox/functions.ts";
import agreementUrl from "./samples/ridgeline-rate-agreement.png?url";
import rfl20417Url from "./samples/ridgeline-rfl-20417.png?url";
import rfl20431Url from "./samples/ridgeline-rfl-20431.png?url";

const SIGNATURE =
	"\n\nThanks,\nDana Ortiz, Billing\nRidgeline Freight Lines\n(815) 555-0187 · dana.ortiz@ridgelinefreight.example\n4100 Rail Yard Road, Joliet, IL 60436\n";

/** Sample carrier emails around fictional documents rendered into ./samples. */
const SAMPLES = [
	{
		id: "rfl-20417",
		label: "Carrier invoice RFL-20417",
		url: rfl20417Url,
		filename: "Invoice_RFL-20417.png",
		from: "Ridgeline Freight Billing <billing@ridgelinefreight.example>",
		subject: "Invoice RFL-20417, PRO 7731045",
		body: `Hello,\n\nPlease find our invoice for PRO 7731045 attached.${SIGNATURE}`,
	},
	{
		// No invoice wording: the rules are unsure, so the model classifies it.
		id: "rfl-20431-scan",
		label: "Unlabeled scan (the model classifies it)",
		url: rfl20431Url,
		filename: "scan0001.png",
		from: "Ridgeline Freight <dispatch@ridgelinefreight.example>",
		subject: "Paperwork for load 88213",
		body: `Hi,\n\nAttached are the freight charges for load 88213, Dallas to Memphis, due net 30.${SIGNATURE}`,
	},
	{
		id: "ra-2026-014",
		label: "Carrier rate agreement (filed by hand)",
		url: agreementUrl,
		filename: "Rate_Agreement_RA-2026-014.png",
		from: "Ridgeline Freight Sales <sales@ridgelinefreight.example>",
		subject: "Signed rate agreement for 2026",
		body: `Hello,\n\nOur countersigned rate agreement for 2026 is attached.${SIGNATURE}`,
	},
] as const;

export function SimulateForm({
	address,
	onSent,
}: {
	address: string;
	onSent: () => void;
}) {
	const [sampleId, setSampleId] = useState<string>(SAMPLES[0].id);
	const sample = SAMPLES.find((s) => s.id === sampleId) ?? SAMPLES[0];
	const [from, setFrom] = useState<string>(sample.from);
	const [subject, setSubject] = useState<string>(sample.subject);
	const [body, setBody] = useState<string>(sample.body);
	const [file, setFile] = useState<File | null>(null);
	const [sending, setSending] = useState(false);

	function choose(id: string) {
		const next = SAMPLES.find((s) => s.id === id);
		if (!next) return;
		setSampleId(id);
		setFrom(next.from);
		setBody(next.body);
		setSubject(next.subject);
		setFile(null);
	}

	async function send() {
		setSending(true);
		try {
			const attachment = file
				? {
						filename: file.name,
						contentType: file.type || "application/octet-stream",
						bytes: new Uint8Array(await file.arrayBuffer()),
					}
				: {
						filename: sample.filename,
						contentType: "image/png",
						bytes: new Uint8Array(
							await (await fetch(sample.url)).arrayBuffer(),
						),
					};
			const raw = buildEml({
				from,
				to: address,
				subject,
				text: body,
				attachments: [attachment],
			});
			await simulateEmail({ data: { raw } });
			toast.success("Delivered to the inbox");
			onSent();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : "Could not deliver");
		} finally {
			setSending(false);
		}
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>Simulate an email</CardTitle>
				<CardDescription>
					For the demo and local testing: builds a real .eml and runs it through
					the same code as mail to {address}. Send the same one twice to see the
					duplicate check.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<form
					className="grid gap-4"
					onSubmit={(e) => {
						e.preventDefault();
						void send();
					}}
				>
					<div className="grid gap-2">
						<Label htmlFor="sim-sample">Attachment</Label>
						<select
							id="sim-sample"
							value={sampleId}
							onChange={(e) => choose(e.target.value)}
							className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
						>
							{SAMPLES.map((s) => (
								<option key={s.id} value={s.id}>
									{s.label}
								</option>
							))}
						</select>
						<Input
							type="file"
							accept={UPLOAD_ACCEPT}
							aria-label="Or attach your own file"
							onChange={(e) => setFile(e.target.files?.[0] ?? null)}
						/>
						<p className="text-xs text-muted-foreground">
							{file
								? `Attaching ${file.name} instead of the sample.`
								: "Or pick your own PDF or photo above."}
						</p>
					</div>
					<div className="grid gap-4 sm:grid-cols-2">
						<div className="grid gap-2">
							<Label htmlFor="sim-from">From</Label>
							<Input
								id="sim-from"
								value={from}
								onChange={(e) => setFrom(e.target.value)}
							/>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="sim-subject">Subject</Label>
							<Input
								id="sim-subject"
								value={subject}
								onChange={(e) => setSubject(e.target.value)}
							/>
						</div>
					</div>
					<div className="grid gap-2">
						<Label htmlFor="sim-body">Message</Label>
						<Textarea
							id="sim-body"
							rows={4}
							value={body}
							onChange={(e) => setBody(e.target.value)}
						/>
					</div>
					<div>
						<Button type="submit" disabled={sending}>
							{sending ? <Loader2 className="animate-spin" /> : <Send />}
							Send to the inbox
						</Button>
					</div>
				</form>
			</CardContent>
		</Card>
	);
}
