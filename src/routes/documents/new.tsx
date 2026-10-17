import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
	ClipboardList,
	FileText,
	type LucideIcon,
	Receipt,
	ReceiptText,
	Truck,
	Undo2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageBody, PageHeader } from "#/components/app-shell.tsx";
import { localIsoDate } from "#/components/documents/editor/form.ts";
import {
	TYPE_DESCRIPTION,
	TYPE_LABEL,
} from "#/components/documents/preview/format.ts";
import { DOCUMENT_TYPES, type DocumentType } from "#/lib/documents/types.ts";
import { cn } from "#/lib/utils.ts";
import { createDraftDocument } from "#/server/documents/drafts.ts";

export const Route = createFileRoute("/documents/new")({
	component: NewDocument,
});

const ICON: Record<DocumentType, LucideIcon> = {
	invoice: FileText,
	quote: ClipboardList,
	proforma: ReceiptText,
	credit_note: Undo2,
	receipt: Receipt,
	delivery_note: Truck,
};

function NewDocument() {
	const navigate = useNavigate();
	const [creating, setCreating] = useState<DocumentType | null>(null);

	async function create(type: DocumentType) {
		setCreating(type);
		try {
			const { id } = await createDraftDocument({
				data: { type, date: localIsoDate() },
			});
			await navigate({ to: "/documents/$id", params: { id } });
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Could not create");
			setCreating(null);
		}
	}

	return (
		<>
			<PageHeader
				title="New document"
				description="Pick a type. You get an editable draft; it is numbered when you issue it."
			/>
			<PageBody>
				<ul className="grid max-w-4xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{DOCUMENT_TYPES.map((type) => {
						const Icon = ICON[type];
						return (
							<li key={type}>
								<button
									type="button"
									onClick={() => create(type)}
									disabled={creating !== null}
									className={cn(
										"flex h-full w-full flex-col items-start gap-3 rounded-xl border bg-card p-5 text-left shadow-sm transition-colors outline-none hover:border-primary/50 hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60",
										creating === type && "border-primary",
									)}
								>
									<span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
										<Icon className="size-5" />
									</span>
									<span className="space-y-1">
										<span className="block font-semibold">
											{TYPE_LABEL[type]}
										</span>
										<span className="block text-sm text-muted-foreground">
											{creating === type
												? "Creating draft…"
												: TYPE_DESCRIPTION[type]}
										</span>
									</span>
								</button>
							</li>
						);
					})}
				</ul>
			</PageBody>
		</>
	);
}
