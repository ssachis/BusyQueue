import {
	BellRing,
	Building2,
	ChartColumn,
	ClipboardCheck,
	FilePen,
	FileScan,
	FileText,
	Inbox,
	LayoutDashboard,
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
	/** A live count shown next to the label. */
	badge?: "reminders";
}

export interface NavSection {
	/** Short heading above the group. */
	label: string;
	items: NavItem[];
}

/**
 * Primary navigation, grouped by what the owner is doing: checking money
 * going out (vendor bills against agreed prices), billing money coming in
 * (our own documents), and planning ahead. Add an entry per top-level route.
 */
export const navSections: NavSection[] = [
	{
		label: "Overview",
		items: [
			{ to: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
		],
	},
	{
		label: "Money out",
		items: [
			{ to: "/review", label: "Review bills", icon: ClipboardCheck },
			{ to: "/inbox", label: "Inbox", icon: Inbox },
			{ to: "/import", label: "Import bill", icon: FileScan },
			{ to: "/contracts", label: "Contracts", icon: ScrollText },
		],
	},
	{
		label: "Money in",
		items: [
			{ to: "/documents", label: "Documents", icon: FileText },
			{ to: "/clients", label: "Clients", icon: Users },
			{ to: "/catalog", label: "Items", icon: Package },
			{ to: "/import-document", label: "Import document", icon: FilePen },
		],
	},
	{
		label: "Planning",
		items: [
			{ to: "/projections", label: "Projections", icon: ChartColumn },
			{
				to: "/reminders",
				label: "Reminders",
				icon: BellRing,
				badge: "reminders",
			},
		],
	},
	{
		label: "Settings",
		items: [{ to: "/settings/business", label: "Business", icon: Building2 }],
	},
];

/** Every nav entry in order (flat), for anything that doesn't need the groups. */
export const mainNav: NavItem[] = navSections.flatMap((s) => s.items);
