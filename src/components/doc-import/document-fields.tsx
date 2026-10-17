import { Input } from "#/components/ui/input.tsx";
import { Textarea } from "#/components/ui/textarea.tsx";
import { label as typeLabel } from "#/lib/doc-import/classify.ts";
import type {
	BuyerField,
	DocImportForm,
	SellerContext,
} from "#/lib/doc-import/form.ts";
import { DOCUMENT_TYPES } from "#/lib/documents/types.ts";
import { cn } from "#/lib/utils.ts";
import { Field, type FieldState, flagClass, selectClass } from "./field.tsx";

type HeaderField = "date" | "dueDate" | "currency" | "placeOfSupply";

const HEADER: { field: HeaderField; label: string; placeholder?: string }[] = [
	{ field: "date", label: "Date", placeholder: "YYYY-MM-DD" },
	{
		field: "dueDate",
		label: "Due / valid until",
		placeholder: "Empty for none",
	},
	{ field: "currency", label: "Currency", placeholder: "USD" },
];

const BUYER: {
	field: Exclude<BuyerField, "address">;
	label: string;
	placeholder?: string;
}[] = [
	{ field: "name", label: "Customer name" },
	{ field: "email", label: "Email" },
	{ field: "city", label: "City" },
	{ field: "region", label: "State / province", placeholder: "CA" },
	{ field: "postalCode", label: "Postal code" },
	{ field: "country", label: "Country", placeholder: "US" },
	{ field: "taxId", label: "Tax ID" },
];

/** Type, dates, currency, the buyer, and notes/terms. */
export function DocumentFields({
	form,
	seller,
	state,
	onChange,
	disabled,
}: {
	form: DocImportForm;
	seller: SellerContext;
	state: (path: string) => FieldState;
	/** `path` is the edited field, so the page can clear its flag. */
	onChange: (form: DocImportForm, path: string) => void;
	disabled?: boolean;
}) {
	const input = (path: string, value: string, set: (v: string) => void) => {
		const s = state(path);
		return {
			id: `d-${path}`,
			value,
			disabled,
			onChange: (e: { target: { value: string } }) => set(e.target.value),
			"aria-invalid": s.issue ? true : undefined,
			className: flagClass(s.flagged),
		};
	};
	const setTop = (field: keyof DocImportForm, value: string) =>
		onChange({ ...form, [field]: value }, field);
	const setBuyer = (field: BuyerField, value: string) =>
		onChange(
			{ ...form, buyer: { ...form.buyer, [field]: value } },
			`buyer.${field}`,
		);

	return (
		<div className="space-y-6">
			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
				<Field id="d-type" label="Document type" state={state("type")}>
					<select
						id="d-type"
						value={form.type}
						disabled={disabled}
						onChange={(e) => setTop("type", e.target.value)}
						aria-invalid={state("type").issue ? true : undefined}
						className={cn(selectClass, flagClass(state("type").flagged))}
					>
						{DOCUMENT_TYPES.map((t) => (
							<option key={t} value={t}>
								{typeLabel(t)}
							</option>
						))}
					</select>
				</Field>
				{HEADER.map(({ field, label, placeholder }) => (
					<Field
						key={field}
						id={`d-${field}`}
						label={label}
						state={state(field)}
					>
						<Input
							placeholder={placeholder}
							{...input(field, form[field], (v) => setTop(field, v))}
						/>
					</Field>
				))}
				{seller.country === "IN" ? (
					<Field
						id="d-placeOfSupply"
						label="Place of supply"
						state={state("placeOfSupply")}
					>
						<Input
							placeholder="Buyer's state code"
							{...input("placeOfSupply", form.placeOfSupply, (v) =>
								setTop("placeOfSupply", v),
							)}
						/>
					</Field>
				) : null}
				<Field
					id="d-printed.number"
					label="Number as printed"
					state={{
						...state("printed.number"),
						reason: "Reference only: the draft is numbered when issued",
					}}
				>
					<Input
						{...input("printed.number", form.printed.number, (v) =>
							onChange(
								{ ...form, printed: { ...form.printed, number: v } },
								"printed.number",
							),
						)}
					/>
				</Field>
			</div>

			<fieldset className="space-y-4">
				<legend className="mb-3 text-sm font-medium">Customer</legend>
				<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
					{BUYER.slice(0, 2).map(({ field, label }) => (
						<Field
							key={field}
							id={`d-buyer.${field}`}
							label={label}
							state={state(`buyer.${field}`)}
							className="lg:col-span-2"
						>
							<Input
								{...input(`buyer.${field}`, form.buyer[field], (v) =>
									setBuyer(field, v),
								)}
							/>
						</Field>
					))}
					<Field
						id="d-buyer.address"
						label="Address lines"
						state={state("buyer.address")}
						className="sm:col-span-2 lg:col-span-4"
					>
						<Textarea
							rows={2}
							{...input("buyer.address", form.buyer.address, (v) =>
								setBuyer("address", v),
							)}
						/>
					</Field>
					{BUYER.slice(2).map(({ field, label, placeholder }) => (
						<Field
							key={field}
							id={`d-buyer.${field}`}
							label={label}
							state={state(`buyer.${field}`)}
						>
							<Input
								placeholder={placeholder}
								{...input(`buyer.${field}`, form.buyer[field], (v) =>
									setBuyer(field, v),
								)}
							/>
						</Field>
					))}
				</div>
			</fieldset>

			<div className="grid gap-4 sm:grid-cols-2">
				<Field id="d-notes" label="Notes" state={state("notes")}>
					<Textarea
						rows={3}
						{...input("notes", form.notes, (v) => setTop("notes", v))}
					/>
				</Field>
				<Field id="d-terms" label="Terms" state={state("terms")}>
					<Textarea
						rows={3}
						{...input("terms", form.terms, (v) => setTop("terms", v))}
					/>
				</Field>
			</div>
		</div>
	);
}
