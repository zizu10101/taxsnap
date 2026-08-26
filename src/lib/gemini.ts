import { GoogleGenAI, Type } from "@google/genai";
import { TAX_CATEGORIES } from "@/lib/tax-categories";
import type { ReceiptItem } from "@/lib/database.types";

export interface ParsedReceipt {
  merchant_name: string;
  transaction_date: string;
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
Only trust the order unambiguously when the receipt itself disambiguates it (a month \
name, a 4-digit year, or an explicit "YYYY-MM-DD"/labeled format). Otherwise, pick \
whichever valid ordering produces a date closest to today's date - never a future date, \
and never a date years in the past just because a 2-digit group could be read as an \
old year when it also validly reads as a day or a recent year.
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
