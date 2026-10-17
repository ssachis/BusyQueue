/**
 * Convert and duplicate (#18). On an issued document: one button per allowed
 * conversion (quote → invoice; invoice → receipt, credit note, delivery
 * note). On any document: "Duplicate", which makes an unnumbered draft.
 * Each action opens the new draft.
 */
import { useNavigate } from "@tanstack/react-router";
import { Copy, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "#/components/ui/button.tsx";
import { conversionTargets } from "#/lib/documents/conversion.ts";
import type { DocumentStatus, DocumentType } from "#/lib/documents/types.ts";
import { convertDocumentTo } from "#/server/documents/convert.ts";
import { duplicateDocumentAsDraft } from "#/server/documents/duplicate.ts";
import { TYPE_LABEL } from "./preview/format.ts";

export interface ConvertMenuProps {
	documentId: string;
	type: DocumentType;
	status: DocumentStatus;
}

/** The viewer's calendar date (YYYY-MM-DD). */
function localToday(): string {
	const d = new Date();
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function ConvertMenu({ documentId, type, status }: ConvertMenuProps) {
	const navigate = useNavigate();
	const [busy, setBusy] = useState<string | null>(null);
	const targets = conversionTargets(type, status);

	async function run(key: string, action: () => Promise<{ id: string }>) {
		setBusy(key);
		try {
			const { id } = await action();
			toast.success("Draft created");
			await navigate({ to: "/documents/$id", params: { id } });
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Something went wrong");
		} finally {
			setBusy(null);
		}
	}

	return (
		<>
			{targets.map((to) => (
				<Button
					key={to}
					variant="outline"
					disabled={busy !== null}
					onClick={() =>
						run(to, () =>
							convertDocumentTo({
								data: { documentId, to, date: localToday() },
							}),
						)
					}
				>
					{busy === to ? <Loader2 className="animate-spin" /> : null}
					Make {TYPE_LABEL[to].toLowerCase()}
				</Button>
			))}
			<Button
				variant="outline"
				disabled={busy !== null}
				onClick={() =>
					run("duplicate", () =>
						duplicateDocumentAsDraft({
							data: { documentId, date: localToday() },
						}),
					)
				}
			>
				{busy === "duplicate" ? <Loader2 className="animate-spin" /> : <Copy />}
				Duplicate
			</Button>
		</>
	);
}
