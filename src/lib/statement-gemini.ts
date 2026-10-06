import { ThinkingLevel } from "@google/genai";
import { getClient, GEMINI_MODEL } from "@/lib/gemini";
import { describeProviderFailure, type ProviderFailureCode } from "@/lib/statement-provider-errors";
import {
  buildStatementPrompt,
  STATEMENT_SCHEMA,
  type StatementPromptInput,
} from "@/lib/statement-prompt";

// Reads one chunk (a few pages, or one photo) of a card statement through the
// same Gemini client and model as receipt scanning. Server-only.

export type StatementExtractCode =
  | ProviderFailureCode
  | "EMPTY"
  | "BAD_JSON"
  | "TRUNCATED";

export class StatementExtractError extends Error {
  constructor(
    readonly code: StatementExtractCode,
    readonly httpStatus: number,
    message: string,
    // Tokens Gemini billed for the attempt, when it got far enough to bill any.
    readonly inputTokens = 0,
    readonly outputTokens = 0,
  ) {
    super(message);
    this.name = "StatementExtractError";
  }
}

// Give up on the model a little before the route's own 60s limit (maxDuration),
// so a slow call is recorded as a failed chunk the user can retry rather than the
// function being killed with nothing written.
const MODEL_TIMEOUT_MS = 50_000;

export interface StatementExtractResult {
  raw: unknown;
  inputTokens: number;
  outputTokens: number;
}

// Keeps the upstream status separate from user-facing text, the same way the
// receipt route does: "busy" only ever means a genuine 503, and a refused
// document (400) is reported as an unreadable file, not as an outage.
function classifyProviderError(err: unknown): StatementExtractError {
  const f = describeProviderFailure(err);
  return new StatementExtractError(f.code, f.httpStatus, f.message);
}

export async function extractStatementChunk(
  base64: string,
  mimeType: string,
  promptInput: StatementPromptInput,
): Promise<StatementExtractResult> {
  const ai = getClient();

  let response;
  try {
    response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType, data: base64 } },
            { text: "Extract the transaction lines and statement facts from these statement pages." },
          ],
        },
      ],
      config: {
        systemInstruction: buildStatementPrompt(promptInput),
        responseMimeType: "application/json",
        responseSchema: STATEMENT_SCHEMA,
        temperature: 0,
        // A few pages is a few thousand tokens of lines; this is headroom, not a target.
        maxOutputTokens: 32768,
        // Reading a statement is transcription, not reasoning. Measured on a
        // synthetic 3-page, 9-line statement: default thinking used 5,500 tokens
        // in 13s; LOW used 2,882 in 3.6s with identical lines. Revisit if real
        // statements show misreads that more thinking would fix.
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        abortSignal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
      },
    });
  } catch (err) {
    throw classifyProviderError(err);
  }

  const usage = response.usageMetadata;
  const inputTokens = usage?.promptTokenCount ?? 0;
  // Thinking tokens are billed as output.
  const outputTokens = (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0);

  if (String(response.candidates?.[0]?.finishReason) === "MAX_TOKENS") {
    throw new StatementExtractError("TRUNCATED", 502, "These pages were too long to read in one go.", inputTokens, outputTokens);
  }

  const text = response.text;
  if (!text) {
    throw new StatementExtractError("EMPTY", 502, "We couldn't read these pages.", inputTokens, outputTokens);
  }

  try {
    return { raw: JSON.parse(text), inputTokens, outputTokens };
  } catch {
    throw new StatementExtractError("BAD_JSON", 502, "We couldn't read these pages.", inputTokens, outputTokens);
  }
}
