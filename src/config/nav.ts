import {
	Building2,
	ClipboardCheck,
	FileScan,
	FileText,
	type LucideIcon,
	ScrollText,
} from "lucide-react";

export interface NavItem {
	to: string;
	label: string;
	icon: LucideIcon;
	/** Only mark active on an exact path match (use for "/"). */
	exact?: boolean;
}

/** Primary navigation. Add an entry per top-level route. */
export const mainNav: NavItem[] = [
	{ to: "/", label: "Review", icon: ClipboardCheck, exact: true },
	{ to: "/documents", label: "Documents", icon: FileText },
	{ to: "/contracts", label: "Contracts", icon: ScrollText },
	{ to: "/import", label: "Import", icon: FileScan },
	{ to: "/settings/business", label: "Business", icon: Building2 },
];
