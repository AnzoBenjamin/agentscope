/** Represents the result of an agent execution. */
export interface AgentResult {
  output: string;
  sessionId: string;
  totalTokens: number;
  totalCost: number;
  duration: number;
  toolCalls: number;
}

/** Configuration for an agent instance */
export interface AgentConfig {
  name: string;
  description: string;
  organizationId?: string;
  modelProvider: string;
  modelName: string;
  /** System prompt to guide the agent's behavior */
  systemPrompt: string;
  /** Available tools the agent can use */
  tools?: AgentTool[];
  /**
   * Optional OpenAI-compatible base URL (e.g. TokenRouter, OpenRouter,
   * LiteLLM, Ollama). When set, the runtime routes AI SDK calls through
   * this endpoint using {@link apiKey}.
   */
  baseUrl?: string | null;
  /**
   * Plaintext API key, decrypted at execution time from the agent's
   * persisted ciphertext. Never log or persist this value.
   */
  apiKey?: string | null;
  /**
   * Cost per 1000 tokens (USD) used for this agent's billing ledger.
   * Defaults to a built-in per-provider rate when omitted.
   */
  costPer1kTokens?: number;
}

/** A tool that an agent can invoke during execution */
export interface AgentTool {
  name: string;
  description: string;
  execute: (input: unknown) => Promise<unknown>;
}
