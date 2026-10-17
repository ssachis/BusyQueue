/**
 * Convert / duplicate menu (#18). Lists the conversions allowed for this
 * document (only once it's issued) plus "Duplicate as new draft" (always).
 * Each creates a NEW draft and opens it; the source is never changed.
 * The document page mounts it with exactly these props.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import {
	ArrowRightLeft,
	ChevronDown,
	Copy,
	FileMinus,
	FileText,
	Loader2,
	Receipt,
	Truck,
} from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { type ComponentType, useState } from "react";
import { toast } from "sonner";
import { Button } from "#/components/ui/button.tsx";
import {
	CONVERSIONS,
	conversionTargets,
	DOCUMENT_TYPE_NAMES,
} from "#/lib/documents/conversions.ts";
import type { DocumentType } from "#/lib/documents/types.ts";
import { convertDocument } from "#/server/documents/convert.ts";
import { duplicateDocument } from "#/server/documents/duplicate.ts";

export interface ConvertMenuProps {
	documentId: string;
	type: DocumentType;
	status: "draft" | "issued" | "void";
}

const TARGET: Record<
	DocumentType,
	{ label: string; icon: ComponentType<{ className?: string }> }
> = {
	invoice: { label: "Convert to invoice", icon: FileText },
	proforma: { label: "Convert to pro forma invoice", icon: FileText },
	credit_note: { label: "Create credit note", icon: FileMinus },
	receipt: { label: "Create receipt", icon: Receipt },
	delivery_note: { label: "Create delivery note", icon: Truck },
	quote: { label: "Convert to quote", icon: FileText },
};

const itemClass =
	"flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground [&_svg]:size-4 [&_svg]:text-muted-foreground";

/** The viewer's calendar date (YYYY-MM-DD) for the new draft's date. */
function localToday(): string {
	const d = new Date();
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function ConvertMenu({ documentId, type, status }: ConvertMenuProps) {
	const router = useRouter();
	const queryClient = useQueryClient();
	const [pending, setPending] = useState<DocumentType | "duplicate" | null>(
		null,
	);
	const targets = conversionTargets(type, status);
	const convertible = CONVERSIONS[type].length > 0;

	async function run(action: DocumentType | "duplicate") {
		setPending(action);
		try {
			const result =
				action === "duplicate"
					? await duplicateDocument({
							data: { documentId, today: localToday() },
						})
					: await convertDocument({
							data: { documentId, toType: action, today: localToday() },
						});
			toast.success(
				action === "duplicate"
					? "Duplicated as a new draft"
					: `New ${DOCUMENT_TYPE_NAMES[result.type]} draft created`,
			);
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: ["document-history", documentId],
				}),
				queryClient.invalidateQueries({
					queryKey: ["document-links", documentId],
				}),
			]);
			await router.navigate({ href: `/documents/${result.documentId}` });
		} catch (err) {
			toast.error(
				err instanceof Error ? err.message : "Could not create the draft",
			);
		} finally {
			setPending(null);
		}
	}

	return (
		<DropdownMenu.Root>
			<DropdownMenu.Trigger asChild>
				<Button variant="outline" disabled={pending !== null}>
					{pending ? <Loader2 className="animate-spin" /> : <ArrowRightLeft />}
					{pending ? "Creating draft…" : "Convert"}
					<ChevronDown className="opacity-60" />
				</Button>
			</DropdownMenu.Trigger>
			<DropdownMenu.Portal>
				<DropdownMenu.Content
					align="end"
					sideOffset={4}
					className="z-50 min-w-56 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
				>
					{targets.map((to) => {
						const { label, icon: Icon } = TARGET[to];
						return (
							<DropdownMenu.Item
								key={to}
								className={itemClass}
								onSelect={() => run(to)}
							>
								<Icon />
								{label}
							</DropdownMenu.Item>
						);
					})}
					{targets.length === 0 && convertible ? (
						<DropdownMenu.Label className="px-2 py-1.5 text-xs text-muted-foreground">
							{status === "void"
								? "A void document can't be converted."
								: `Issue this ${DOCUMENT_TYPE_NAMES[type]} to convert it.`}
						</DropdownMenu.Label>
					) : null}
					{convertible ? (
						<DropdownMenu.Separator className="-mx-1 my-1 h-px bg-border" />
					) : null}
					<DropdownMenu.Item
						className={itemClass}
						onSelect={() => run("duplicate")}
					>
						<Copy />
						Duplicate as new draft
					</DropdownMenu.Item>
				</DropdownMenu.Content>
			</DropdownMenu.Portal>
		</DropdownMenu.Root>
	);
}
