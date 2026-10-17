import { ClipboardCheck, type LucideIcon } from "lucide-react";

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
];
