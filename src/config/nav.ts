import {
	BellRing,
	Building2,
	ClipboardCheck,
	FileScan,
	FileText,
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
	{ to: "/import", label: "Import", icon: FileScan },
	{ to: "/reminders", label: "Reminders", icon: BellRing },
	{ to: "/settings/business", label: "Business", icon: Building2 },
];
