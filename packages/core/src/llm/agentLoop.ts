import type { AssistantContext, LLMProvider, Message } from "../types/index";
import type { DataStore } from "../store/DataStore";
import { ALL_TOOLS, executeTool, toolDeclarations } from "./tools";

const DEFAULT_MAX_ROUNDS = 6;
const FALLBACK_TEXT = "I don't have enough information to determine this accurately from what I can access right now.";

export interface AgentLoopResult {
  text: string;
  transcript: Message[];
}

/**
 * The multi-turn tool-calling loop. The LLM never touches app state directly — every
 * effect goes through `executeTool`, which validates args (zod) and runs against the
 * on-device `DataStore` + the deterministic engines. This is what keeps the LLM out of
 * the "source of truth for scheduling/capacity/priority" role: it can only ask for
 * tools to be run and restyle their results into prose.
 */
export async function runAgentLoop(params: {
  messages: Message[];
  context: AssistantContext;
  provider: LLMProvider;
  store: DataStore;
  now: Date;
  maxRounds?: number;
}): Promise<AgentLoopResult> {
  const { provider, store, now, context } = params;
  const maxRounds = params.maxRounds ?? DEFAULT_MAX_ROUNDS;
  const tools = toolDeclarations();
  const messages: Message[] = [...params.messages];

  for (let round = 0; round < maxRounds; round++) {
    const response = await provider.generateResponse(messages, context, tools);

    if (!response.toolCalls || response.toolCalls.length === 0) {
      return { text: response.text ?? FALLBACK_TEXT, transcript: messages };
    }

    // When a provider returns several tool calls at once (parallel calls in a
    // single model turn), push all the assistant "requests" first and all the
    // "results" after — not interleaved per-call. Interleaving would split what
    // was one model turn + one results turn into several alternating turns; for
    // providers like Gemini that stamp turn-level metadata (a thought signature)
    // only on part of a multi-part turn, replaying it back in the wrong shape is
    // rejected outright. Grouping this way lets each provider's own
    // message-merging reconstruct the original turn boundaries.
    for (const call of response.toolCalls) {
      messages.push({
        role: "assistant",
        toolCallId: call.id,
        toolName: call.name,
        toolArgs: call.args,
        providerMeta: call.providerMeta
      });
    }
    for (const call of response.toolCalls) {
      let toolResult: unknown;
      try {
        toolResult = await executeTool(call.name, call.args, { store, now });
      } catch (err) {
        toolResult = { error: err instanceof Error ? err.message : String(err) };
      }
      messages.push({ role: "tool", toolCallId: call.id, toolName: call.name, toolResult });
    }
  }

  return { text: FALLBACK_TEXT, transcript: messages };
}

export { ALL_TOOLS, toolDeclarations, executeTool };
