export const TAX_CATEGORIES = [
  "Job Materials",
  "Tools & Equipment",
  "Inventory",
  "Supplies",
  "Vehicle/Fuel",
  "Gas",
  "Lease",
  "407",
  "Insurance",
  "Rent",
  "Phone",
  "Internet",
  "Office/Admin",
  "Advertising",
  "Meals",
  "Other",
] as const;

export type TaxCategory = (typeof TAX_CATEGORIES)[number];
