/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const issueDocument = vi.fn();
const getIssueState = vi.fn();
const invalidate = vi.fn(async () => {});
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock("#/server/documents/issue.ts", () => ({
	issueDocument: (...args: unknown[]) => issueDocument(...args),
	getIssueState: (...args: unknown[]) => getIssueState(...args),
}));
vi.mock("@tanstack/react-router", () => ({
	useRouter: () => ({ invalidate }),
}));
vi.mock("sonner", () => ({
	toast: { success: toastSuccess, error: toastError },
}));

const { IssueButton } = await import("./issue-button.tsx");

function wrap(ui: ReactNode) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>{ui}</QueryClientProvider>,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
});
afterEach(cleanup);

describe("IssueButton", () => {
	it("confirms, issues, toasts and reloads the page", async () => {
		let resolve: (v: unknown) => void = () => {};
		issueDocument.mockReturnValue(
			new Promise((r) => {
				resolve = r;
			}),
		);
		wrap(<IssueButton documentId="doc-1" status="draft" />);

		fireEvent.click(screen.getByRole("button", { name: "Issue" }));
		expect(
			screen.getByText("This assigns the next number and locks the document."),
		).toBeTruthy();
		expect(issueDocument).not.toHaveBeenCalled();

		fireEvent.click(screen.getByRole("button", { name: "Issue now" }));
		expect(await screen.findByText("Issuing…")).toBeTruthy();
		expect(issueDocument).toHaveBeenCalledWith({
			data: { documentId: "doc-1" },
		});

		resolve({ documentId: "doc-1", number: "INV-0007" });
		expect(await screen.findByText("INV-0007")).toBeTruthy();
		expect(screen.getByText("Issued")).toBeTruthy();
		expect(toastSuccess).toHaveBeenCalledWith("Issued as INV-0007");
		await waitFor(() => expect(invalidate).toHaveBeenCalled());
	});

	it("can cancel the confirm step", () => {
		wrap(<IssueButton documentId="doc-1" status="draft" />);
		fireEvent.click(screen.getByRole("button", { name: "Issue" }));
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		expect(screen.getByRole("button", { name: "Issue" })).toBeTruthy();
		expect(issueDocument).not.toHaveBeenCalled();
	});

	it("shows the server's error and stays a draft", async () => {
		issueDocument.mockRejectedValue(
			new Error("Add at least one line before issuing"),
		);
		wrap(<IssueButton documentId="doc-1" status="draft" />);
		fireEvent.click(screen.getByRole("button", { name: "Issue" }));
		fireEvent.click(screen.getByRole("button", { name: "Issue now" }));
		await waitFor(() =>
			expect(toastError).toHaveBeenCalledWith(
				"Add at least one line before issuing",
			),
		);
		expect(screen.getByRole("button", { name: "Issue now" })).toBeTruthy();
		expect(invalidate).not.toHaveBeenCalled();
	});

	it("shows the number and status of issued and void documents", async () => {
		getIssueState.mockResolvedValue({ status: "issued", number: "INV-0001" });
		wrap(<IssueButton documentId="doc-1" status="issued" />);
		expect(await screen.findByText("INV-0001")).toBeTruthy();
		expect(screen.getByText("Issued")).toBeTruthy();
		expect(screen.queryByRole("button")).toBeNull();
		cleanup();

		getIssueState.mockResolvedValue({ status: "void", number: "INV-0002" });
		wrap(<IssueButton documentId="doc-2" status="void" />);
		expect(await screen.findByText("INV-0002")).toBeTruthy();
		expect(screen.getByText("Void")).toBeTruthy();
	});
});
