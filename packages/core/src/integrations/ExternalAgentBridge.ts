import type { AgentCommand, AgentResult, ExternalAgentBridge } from "../types/index";

/**
 * The entire "Apollo" integration boundary for V1: a typed interface plus this inert
 * implementation. Nothing in the decision engine imports this except as an optional,
 * unused constructor parameter — the engine works completely independently of it.
 * A future Apollo adapter implements `ExternalAgentBridge` and gets swapped in; nothing
 * else in the codebase needs to change.
 */
export class DisabledAgentBridge implements ExternalAgentBridge {
  async execute(_command: AgentCommand): Promise<AgentResult> {
    return { success: false, error: "Apollo integration is not implemented in V1." };
  }
}
