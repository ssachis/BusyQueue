import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Menu, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Wordmark } from "#/components/logo.tsx";
import { RemindersBadge } from "#/components/reminders/reminders-badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { type NavItem, navSections } from "#/config/nav.ts";
import { siteConfig } from "#/config/site.ts";
import { cn } from "#/lib/utils.ts";
import { getBusiness } from "#/server/business.ts";

function Brand() {
	return (
		<Link
			to="/"
			aria-label={siteConfig.name}
			className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
		>
			<Wordmark />
		</Link>
	);
}

/** The business name from its profile (blank until it loads). */
function BusinessName({ className }: { className?: string }) {
	const { data } = useQuery({
		queryKey: ["business", "profile"],
		queryFn: () => getBusiness(),
		staleTime: 5 * 60_000,
	});
	return (
		<p
			className={cn("truncate text-sm text-sidebar-foreground/60", className)}
			title={data?.legalName}
		>
			{data?.legalName ?? "\u00a0"}
		</p>
	);
}

function NavBadge({ badge }: { badge: NavItem["badge"] }) {
	if (badge === "reminders") return <RemindersBadge className="ml-auto" />;
	return null;
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
	return (
		<nav aria-label="Main" className="flex flex-col gap-5">
			{navSections.map((section) => (
				<div key={section.label} className="flex flex-col gap-0.5">
					<h2 className="px-3 pb-1 text-[11px] font-medium tracking-wider text-sidebar-foreground/45 uppercase">
						{section.label}
					</h2>
					{section.items.map(({ to, label, icon: Icon, exact, badge }) => (
						<Link
							key={to}
							to={to}
							activeOptions={{ exact, includeSearch: false }}
							onClick={onNavigate}
							className="group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring data-[status=active]:bg-sidebar-primary/10 data-[status=active]:font-medium data-[status=active]:text-sidebar-primary"
						>
							<span
								aria-hidden
								className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-sidebar-primary opacity-0 transition-opacity group-data-[status=active]:opacity-100"
							/>
							<Icon className="size-[18px] shrink-0" />
							<span className="truncate">{label}</span>
							<NavBadge badge={badge} />
						</Link>
					))}
				</div>
			))}
		</nav>
	);
}

/** Sidebar layout on desktop, top bar + drawer on mobile. */
export function AppShell({ children }: { children: ReactNode }) {
	const [open, setOpen] = useState(false);

	return (
		<div className="flex min-h-screen flex-col md:flex-row">
			{/* Desktop sidebar */}
			<aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
				<div className="relative px-6 pt-7 pb-6">
					<Brand />
					<BusinessName className="mt-2" />
				</div>
				<div className="relative flex-1 overflow-y-auto px-3 pb-4">
					<NavLinks />
				</div>
				<div className="relative flex items-center justify-between px-5 py-5">
					<span className="text-xs text-sidebar-foreground/50">Demo data</span>
				</div>
			</aside>

			{/* Mobile top bar */}
			<header className="sticky top-0 z-30 flex items-center justify-between border-b bg-background/80 px-4 py-3 backdrop-blur md:hidden">
				<Brand />
				<Button
					variant="outline"
					size="icon"
					aria-label="Open menu"
					onClick={() => setOpen(true)}
				>
					<Menu />
				</Button>
			</header>

			{/* Mobile drawer */}
			<div
				className={cn(
					"fixed inset-0 z-50 md:hidden",
					open ? "pointer-events-auto" : "pointer-events-none",
				)}
				aria-hidden={!open}
			>
				<button
					type="button"
					aria-label="Close menu"
					tabIndex={open ? 0 : -1}
					className={cn(
						"absolute inset-0 bg-foreground/40 transition-opacity duration-300",
						open ? "opacity-100" : "opacity-0",
					)}
					onClick={() => setOpen(false)}
				/>
				<div
					className={cn(
						"absolute top-0 left-0 flex h-full w-64 flex-col bg-sidebar text-sidebar-foreground shadow-xl transition-transform duration-300 ease-out",
						open ? "translate-x-0" : "-translate-x-full",
					)}
				>
					<div className="flex items-center justify-between px-5 pt-5 pb-2">
						<Brand />
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label="Close menu"
							onClick={() => setOpen(false)}
						>
							<X />
						</Button>
					</div>
					<BusinessName className="px-5 pb-4" />
					<div className="flex-1 overflow-y-auto px-3 pb-6">
						<NavLinks onNavigate={() => setOpen(false)} />
					</div>
				</div>
			</div>

			<main className="min-w-0 flex-1">{children}</main>
		</div>
	);
}

/** Standard header at the top of each route. */
export function PageHeader({
	title,
	description,
	children,
}: {
	title: ReactNode;
	description?: ReactNode;
	/** Right-aligned actions. */
	children?: ReactNode;
}) {
	return (
		<div className="border-b px-4 py-5 md:px-8 md:py-6">
			<div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
				<div className="min-w-0 space-y-1.5">
					<h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
						{title}
					</h1>
					{description ? (
						<p className="max-w-prose text-sm text-muted-foreground">
							{description}
						</p>
					) : null}
				</div>
				{children ? (
					<div className="flex flex-wrap items-center gap-2">{children}</div>
				) : null}
			</div>
		</div>
	);
}

/** Standard padded content area below a PageHeader. */
export function PageBody({
	className,
	children,
}: {
	className?: string;
	children?: ReactNode;
}) {
	return <div className={cn("px-4 py-6 md:px-8", className)}>{children}</div>;
}
