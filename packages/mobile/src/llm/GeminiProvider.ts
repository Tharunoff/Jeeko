import type {
  AssistantContext,
  LLMProvider,
  LLMResponse,
  Message,
  ToolCallRequest,
  ToolDeclaration
} from "@personalos/core";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODEL = "gemini-2.0-flash";

/**
 * Maps core Message[] → Gemini API "contents" format.
 * Gemini expects: { role: "user"|"model", parts: [...] }
 * Tool results go as role:"user" with functionResponse parts.
 */
function toGeminiContents(messages: Message[]): any[] {
  const contents: any[] = [];

  for (const msg of messages) {
    if (msg.role === "user") {
      // Voice messages carry inline audio bytes alongside (or instead of) text —
      // Gemini transcribes and understands it in the same call, no separate STT step.
      const parts: any[] = [];
      if (msg.text) parts.push({ text: msg.text });
      if (msg.audio) {
        parts.push({ inlineData: { mimeType: msg.audio.mimeType, data: msg.audio.base64 } });
      }
      if (parts.length === 0) parts.push({ text: "" });
      contents.push({ role: "user", parts });
    } else if (msg.role === "assistant") {
      if (msg.toolName && msg.toolArgs !== undefined) {
        // This is a tool-call request from the assistant
        contents.push({
          role: "model",
          parts: [
            {
              functionCall: {
                name: msg.toolName,
                args: msg.toolArgs as Record<string, unknown>
              }
            }
          ]
        });
      } else if (msg.text) {
        contents.push({
          role: "model",
          parts: [{ text: msg.text }]
        });
      }
    } else if (msg.role === "tool") {
      // Tool result — Gemini expects this as a user turn with functionResponse
      contents.push({
        role: "user",
        parts: [
          {
            functionResponse: {
              name: msg.toolName ?? "unknown",
              response: { result: msg.toolResult }
            }
          }
        ]
      });
    }
  }

  // Gemini requires alternating user/model turns. Merge consecutive same-role entries.
  const merged: any[] = [];
  for (const entry of contents) {
    const last = merged[merged.length - 1];
    if (last && last.role === entry.role) {
      last.parts.push(...entry.parts);
    } else {
      merged.push(entry);
    }
  }

  return merged;
}

/** Maps core ToolDeclaration[] → Gemini "tools" format */
function toGeminiTools(tools: ToolDeclaration[]): any[] {
  return [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters
      }))
    }
  ];
}

/** Parses Gemini API response → core LLMResponse */
function parseGeminiResponse(data: any): LLMResponse {
  const candidate = data.candidates?.[0];
  if (!candidate) {
    return { text: "I wasn't able to process that. Could you rephrase?" };
  }

  const parts = candidate.content?.parts ?? [];
  const textParts: string[] = [];
  const toolCalls: ToolCallRequest[] = [];

  for (const part of parts) {
    if (part.text) {
      textParts.push(part.text);
    }
    if (part.functionCall) {
      toolCalls.push({
        id: `tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: part.functionCall.name,
        args: part.functionCall.args ?? {}
      });
    }
  }

  return {
    text: textParts.length > 0 ? textParts.join("") : undefined,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined
  };
}

export class GeminiProvider implements LLMProvider {
  private apiKey: string;
  private model: string;
  private systemInstruction: string;

  constructor(params: { apiKey: string; model?: string; systemInstruction: string }) {
    this.apiKey = params.apiKey;
    this.model = params.model ?? DEFAULT_MODEL;
    this.systemInstruction = params.systemInstruction;
  }

  async generateResponse(
    messages: Message[],
    context: AssistantContext,
    tools: ToolDeclaration[]
  ): Promise<LLMResponse> {
    const url = `${GEMINI_BASE}/${this.model}:generateContent?key=${this.apiKey}`;

    const body: any = {
      contents: toGeminiContents(messages),
      tools: toGeminiTools(tools),
      toolConfig: {
        functionCallingConfig: {
          mode: "AUTO"
        }
      },
      systemInstruction: {
        parts: [
          {
            text: this.systemInstruction.replace(
              "{{CURRENT_TIME}}",
              context.now.toISOString()
            ).replace(
              "{{USER_NAME}}",
              context.user.name
            ).replace(
              "{{TIMEZONE}}",
              context.user.timezone
            )
          }
        ]
      },
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 2048
      }
    };

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "unknown error");
      throw new Error(`Gemini API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    return parseGeminiResponse(data);
  }
}
