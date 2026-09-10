import { GoogleGenAI, Type } from "@google/genai";
import { TAX_CATEGORIES } from "@/lib/tax-categories";
import type { ReceiptItem } from "@/lib/database.types";

export interface ParsedReceipt {
  merchant_name: string;
  transaction_date: string;
  /**
   * True when transaction_date was resolved via the locale-default
   * fallback (see buildSystemPrompt) rather than an unambiguous signal -
   * the UI should prompt the user to double-check it before saving.
   */
  date_ambiguous: boolean;
  total_amount: number;
  tax_amount: number;
  tax_category: string;
  items: ReceiptItem[];
}

let client: GoogleGenAI | null = null;

function getClient() {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

const RECEIPT_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    merchant_name: {
      type: Type.STRING,
      description: "The name of the store or vendor on the receipt.",
    },
    transaction_date: {
      type: Type.STRING,
      description: "The date of the transaction, formatted as YYYY-MM-DD.",
    },
    date_ambiguous: {
      type: Type.BOOLEAN,
      description:
        "True only if transaction_date's day/month order was resolved by the " +
        "locale-default fallback (last resort in the date rules below) rather " +
        "than an unambiguous signal, a >12 value, or other receipt context. " +
        "False whenever the date was actually determined with confidence.",
    },
    total_amount: {
      type: Type.NUMBER,
      description: "The final total amount paid, including tax.",
    },
    tax_amount: {
      type: Type.NUMBER,
      description: "The sales tax amount charged. Use 0 if not shown.",
    },
    tax_category: {
      type: Type.STRING,
      description: "The best-fit IRS Schedule C style write-off category.",
      enum: [...TAX_CATEGORIES],
    },
    items: {
      type: Type.ARRAY,
      description:
        "Itemized list of individual products or services on the receipt, one entry per line item.",
      items: {
        type: Type.OBJECT,
        properties: {
          name: {
            type: Type.STRING,
            description: "Short description of the item or service.",
          },
          amount: {
            type: Type.NUMBER,
            description: "The price printed for this line item.",
          },
        },
        required: ["name", "amount"],
      },
    },
  },
  required: [
    "merchant_name",
    "transaction_date",
    "date_ambiguous",
    "total_amount",
    "tax_amount",
    "tax_category",
    "items",
  ],
};

function buildSystemPrompt(today: string) {
  return `You are a receipt-parsing assistant for TaxSnap, an app used by \
self-employed trade contractors (painters, handymen, barbers, etc.) to track tax \
write-offs. Given a photo of a receipt, extract the merchant name, transaction date, \
total amount, sales tax amount, the single best-fit tax write-off category, and an \
itemized breakdown of what was purchased.

Today's date is ${today}. Receipts are almost always photographed within days or weeks \
of the purchase, not years later.

Rules:
- transaction_date must be formatted as YYYY-MM-DD. If the year is missing, assume the \
most recent plausible year.
- A numeric date's field order (e.g. "26/08/23") is often ambiguous - it could be \
DD/MM/YY, MM/DD/YY, or YY/MM/DD, and receipts don't reliably follow one convention. \
There is no single format you can always assume - work through these in order, and stop \
at the first one that resolves it:
  1. Unambiguous signal: the receipt itself disambiguates it - a month name/abbreviation \
("Aug", "August"), a clearly-labeled format, or a 4-digit year in an unambiguous position. \
Use it directly. date_ambiguous is false.
  2. Out-of-range value: if one of the two numeric fields is greater than 12, it cannot be \
a month, so it must be the day (e.g. "15/08" can only be DD/MM - the 15th of August). Use \
that ordering. date_ambiguous is false.
  3. Other context on the receipt: if both fields could be either day or month (both ≤12), \
look for anything else printed on the receipt that resolves it - a day-of-week (check which \
of the two candidate dates actually falls on that weekday), a timestamp or other detail that \
only makes sense for one reading, or the store's evident country/locale from its address, \
phone number format, language, or currency symbol (e.g. a Canadian address or "ON"/"CAD" \
implies DD/MM or ISO order is far more likely than US-style MM/DD). Use whichever reading \
that context supports. date_ambiguous is false.
  4. Locale-default fallback: if none of the above resolves it, default to DD/MM order \
(TaxSnap's users are primarily Canadian small businesses, where DD/MM and ISO YYYY-MM-DD \
are more common than US-style MM/DD) - but this is a guess, so set date_ambiguous to true \
so the user is prompted to double-check it.
- Regardless of which rule above resolved the day/month order, the final date must still \
pass a sanity check: never a future date, and never a date years in the past when a 2-digit \
year group could also validly read as the current/recent year. If applying rules 1-3 would \
produce a date that fails this check, treat the date as unresolved by those rules, fall back \
to whichever valid ordering lands closest to today instead, and set date_ambiguous to true.
- If the image is too illegible to make out numbers/text confidently at all, keep \
transaction_date as your best guess but set date_ambiguous to true.
- total_amount and tax_amount must be plain numbers (no currency symbols).
- If tax_amount is not printed on the receipt, use 0.
- Pick exactly one tax_category from this list, choosing the closest match for a \
self-employed trade contractor's business expenses: ${TAX_CATEGORIES.join(", ")}.
- items should list each distinct product or service line from the receipt with its own
  price (e.g. [{"name": "Interior latex paint 1gal", "amount": 38.99}, {"name": "Paint
  brush set", "amount": 12.50}]). Skip subtotal/tax/total lines - those aren't items.
- If individual line items and prices aren't legible, return a single item summarizing
  the purchase with the full total_amount as its amount.
- If the image is not a legible receipt, make a best-effort guess but keep values minimal \
(0 for amounts, "Unknown" for merchant_name, a single generic item).`;
}

export async function parseReceiptImage(
  base64Image: string,
  mimeType: string,
): Promise<ParsedReceipt> {
  const ai = getClient();
  const today = new Date().toISOString().slice(0, 10);

  const response = await ai.models.generateContent({
    model: "gemini-3.6-flash",
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType, data: base64Image } },
          {
            text: "Extract the structured tax write-off data from this receipt image.",
          },
        ],
      },
    ],
    config: {
      systemInstruction: buildSystemPrompt(today),
      responseMimeType: "application/json",
      responseSchema: RECEIPT_SCHEMA,
      temperature: 0.1,
    },
  });

  const text = response.text;
  if (!text) throw new Error("Gemini returned an empty response");

  const parsed = JSON.parse(text) as ParsedReceipt;

  const items = Array.isArray(parsed.items)
    ? parsed.items
        .filter((item) => item?.name)
        .map((item) => ({
          name: String(item.name),
          amount: Number(item.amount) || 0,
        }))
    : [];

  return {
    merchant_name: parsed.merchant_name || "Unknown",
    transaction_date:
      parsed.transaction_date || new Date().toISOString().slice(0, 10),
    // Missing entirely is an even less confident guess than the model's own
    // locale-default fallback, so it's flagged ambiguous regardless of what
    // date_ambiguous the model reported.
    date_ambiguous: !parsed.transaction_date || Boolean(parsed.date_ambiguous),
    total_amount: Number(parsed.total_amount) || 0,
    tax_amount: Number(parsed.tax_amount) || 0,
    tax_category: TAX_CATEGORIES.includes(
      parsed.tax_category as (typeof TAX_CATEGORIES)[number],
    )
      ? parsed.tax_category
      : "Other",
    items,
  };
}
