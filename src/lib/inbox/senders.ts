/** Sender allow-list (`INBOX_ALLOWED_SENDERS`). Pure. */
import { emailDomain } from "./redact.ts";

/**
 * Entries are full addresses ("ap@ridgelinefreight.com") or domains
 * ("ridgelinefreight.com" or "@ridgelinefreight.com", subdomains included). An empty
 * list allows everyone.
 */
export function isAllowedSender(
	address: string | null | undefined,
	allowList: readonly string[],
): boolean {
	if (allowList.length === 0) return true;
	const addr = address?.trim().toLowerCase() ?? "";
	const domain = emailDomain(addr);
	if (!domain) return false;
	return allowList.some((raw) => {
		const entry = raw.trim().toLowerCase();
		if (!entry) return false;
		if (entry.includes("@") && !entry.startsWith("@")) return entry === addr;
		const d = entry.replace(/^@/, "");
		return domain === d || domain.endsWith(`.${d}`);
	});
}
