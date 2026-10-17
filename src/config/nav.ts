import {
	BellRing,
	Building2,
	ChartColumn,
	ClipboardCheck,
	FilePen,
	FileScan,
	FileText,
	Inbox,
	type LucideIcon,
	Package,
	ScrollText,
	Users,
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
	{ to: "/clients", label: "Clients", icon: Users },
	{ to: "/catalog", label: "Items", icon: Package },
	{ to: "/contracts", label: "Contracts", icon: ScrollText },
	{ to: "/inbox", label: "Inbox", icon: Inbox },
	{ to: "/import", label: "Import", icon: FileScan },
	{ to: "/projections", label: "Projections", icon: ChartColumn },
	{ to: "/reminders", label: "Reminders", icon: BellRing },
	{ to: "/import-document", label: "Import document", icon: FilePen },
	{ to: "/settings/business", label: "Business", icon: Building2 },
];
