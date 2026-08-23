export const TAX_CATEGORIES = [
  "Job Materials",
  "Vehicle/Fuel",
  "Tools & Equipment",
  "Office/Admin",
  "Meals",
  "Advertising",
  "Insurance",
  "Other",
] as const;

export type TaxCategory = (typeof TAX_CATEGORIES)[number];
