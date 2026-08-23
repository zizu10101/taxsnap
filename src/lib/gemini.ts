import { GoogleGenAI, Type } from "@google/genai";
import { TAX_CATEGORIES } from "@/lib/tax-categories";

export interface ParsedReceipt {
  merchant_name: string;
  transaction_date: string;
  total_amount: number;
  tax_amount: number;
  tax_category: string;
  items_summary: string;
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
    items_summary: {
      type: Type.STRING,
      description:
        "A brief one-sentence summary of the items/services purchased.",
    },
  },
  required: [
    "merchant_name",
    "transaction_date",
    "total_amount",
    "tax_amount",
    "tax_category",
    "items_summary",
  ],
};

const SYSTEM_PROMPT = `You are a receipt-parsing assistant for TaxSnap, an app used by \
self-employed trade contractors (painters, handymen, barbers, etc.) to track tax \
write-offs. Given a photo of a receipt, extract the merchant name, transaction date, \
total amount, sales tax amount, and the single best-fit tax write-off category from \
this list: ${TAX_CATEGORIES.join(", ")}.

Rules:
- transaction_date must be formatted as YYYY-MM-DD. If the year is missing, assume the \
most recent plausible year.
- total_amount and tax_amount must be plain numbers (no currency symbols).
- If tax_amount is not printed on the receipt, use 0.
- Pick exactly one tax_category from the provided list, choosing the closest match for \
a self-employed trade contractor's business expenses.
- items_summary should briefly describe what was purchased (e.g. "Paint, brushes, and \
drop cloths").
- If the image is not a legible receipt, make a best-effort guess but keep values minimal \
(0 for amounts, "Unknown" for merchant_name).`;

export async function parseReceiptImage(
  base64Image: string,
  mimeType: string,
): Promise<ParsedReceipt> {
  const ai = getClient();

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
      systemInstruction: SYSTEM_PROMPT,
      responseMimeType: "application/json",
      responseSchema: RECEIPT_SCHEMA,
      temperature: 0.1,
    },
  });

  const text = response.text;
  if (!text) throw new Error("Gemini returned an empty response");

  const parsed = JSON.parse(text) as ParsedReceipt;

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
    items_summary: parsed.items_summary || "",
  };
}
