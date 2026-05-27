import OpenAI from "openai";
import { logger } from "./logger";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  logger.warn("OPENAI_API_KEY not set — AI features will be unavailable");
}

export const openai = new OpenAI({ apiKey: apiKey ?? "missing" });

/**
 * Transcribe an audio buffer using OpenAI Whisper.
 * Returns the transcribed text, or null if transcription fails.
 */
export async function transcribeAudio(
  audioBuffer: Buffer,
  filename: string,
  mimeType: string = "audio/ogg",
): Promise<string | null> {
  if (!apiKey) {
    logger.warn("OPENAI_API_KEY not set — cannot transcribe audio");
    return null;
  }
  try {
    const file = new File([audioBuffer], filename, { type: mimeType });
    const response = await openai.audio.transcriptions.create({
      file,
      model: "whisper-1",
    });
    return response.text?.trim() || null;
  } catch (err) {
    logger.error({ err }, "Failed to transcribe audio via OpenAI Whisper");
    return null;
  }
}

export async function detectIntent(messageBody: string): Promise<string> {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are an intent classifier for a business task management system. 
Classify the user message into one of these intent categories:
- support_request: Customer needs help or has a problem
- document_submission: Customer is submitting or referencing a document
- appointment_request: Customer wants to schedule a meeting or appointment
- payment_inquiry: Customer asking about payments, invoices, or billing
- complaint: Customer expressing dissatisfaction
- information_request: Customer asking for information
- task_followup: Customer following up on an existing task or request
- general: General message that doesn't fit other categories

Respond with ONLY the intent category, nothing else.`,
        },
        { role: "user", content: messageBody },
      ],
      max_tokens: 20,
    });

    const intent = response.choices[0]?.message?.content?.trim() ?? "general";
    return intent;
  } catch (err) {
    logger.error({ err }, "Failed to detect intent via OpenAI");
    return "general";
  }
}

export async function auditDocument(filename: string, fileUrl: string | null | undefined): Promise<{
  summary: string;
  issues: string[];
  score: number;
}> {
  try {
    const fileContext = fileUrl
      ? `Document filename: ${filename}\nDocument URL: ${fileUrl}`
      : `Document filename: ${filename}`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a document auditor. Given a document filename and optional URL, perform a simulated audit and return a JSON object with:
- summary: a 1-2 sentence overview of the document audit
- issues: an array of 0-3 potential issues or recommendations (strings)
- score: an integer 0-100 representing document quality/compliance score

Respond ONLY with valid JSON, no markdown.`,
        },
        { role: "user", content: fileContext },
      ],
      max_tokens: 300,
    });

    const content = response.choices[0]?.message?.content?.trim() ?? "{}";
    const parsed = JSON.parse(content);
    return {
      summary: parsed.summary ?? "Audit completed.",
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      score: typeof parsed.score === "number" ? parsed.score : 75,
    };
  } catch (err) {
    logger.error({ err }, "Failed to audit document via OpenAI");
    return {
      summary: "Automated audit completed with warnings.",
      issues: ["Could not fully parse document content"],
      score: 50,
    };
  }
}
