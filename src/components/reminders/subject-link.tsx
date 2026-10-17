import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { SubjectType } from "#/lib/reminders/types.ts";

/** Where a reminder's subject lives in the app. */
export function subjectHref(type: SubjectType, id: string): string {
	const enc = encodeURIComponent(id);
	switch (type) {
		case "contract":
			return `/contracts/${enc}`;
		case "vendor_bill":
			return `/review?invoice=${enc}`;
		case "document":
			return `/documents/${enc}`;
	}
}

/** Link to the contract, vendor bill (on the review page) or our document. */
export function SubjectLink({
	type,
	id,
	className,
	children,
}: {
	type: SubjectType;
	id: string;
	className?: string;
	children: ReactNode;
}) {
	switch (type) {
		case "contract":
			return (
				<Link
					to="/contracts/$contractId"
					params={{ contractId: id }}
					className={className}
				>
					{children}
				</Link>
			);
		case "vendor_bill":
			return (
				<Link to="/review" search={{ invoice: id }} className={className}>
					{children}
				</Link>
			);
		case "document":
			// The document pages land with the invoicing suite; a plain link
			// keeps this independent of that route existing yet.
			return (
				<a href={subjectHref(type, id)} className={className}>
					{children}
				</a>
			);
	}
}
