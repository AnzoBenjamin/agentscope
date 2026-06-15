import { randomUUID } from "node:crypto";

import {
  finishSession,
  recordCost,
  recordFailure,
  startSession,
  trackModelInvocation,
  trackToolCall,
  trackToolReturn,
} from "@agentscope/telemetry";

import type { AgentConfig, AgentResult, AgentTool } from "./types";

interface AgentExecutionOptions {
  organizationId?: string;
}

/**
 * Abstract Agent class: the execution engine for AI employees.
 *
 * Every execution is automatically instrumented:
 * 1. Creates a session
 * 2. Records all events (prompts, tool calls, model invocations) to PostgreSQL + Splunk
 * 3. Tracks costs with real token counting
 * 4. Completes the session with full metrics
 * 5. All AI SDK calls are traced via OpenTelemetry (if configured)
 *
 * Subclasses can use:
 * - `useTool()` for instrumented custom tool execution
 * - `generate()` for instrumented AI SDK model calls
 */
export abstract class Agent {
  readonly id: string;
  readonly config: AgentConfig;

  /** Accumulated input (prompt) token count for the current execution */
  private _totalTokensIn = 0;
  /** Accumulated output (completion) token count for the current execution */
  private _totalTokensOut = 0;
  /** Count of tool invocations for the current execution */
  private _toolCallCount = 0;
  /** Accumulated cost for the current execution */
  private _totalCost = 0;
  /** Current session ID (null when not executing) */
  private _sessionId: string | null = null;

  constructor(id: string, config: AgentConfig) {
    this.id = id;
    this.config = config;
  }

  /**
   * Execute the agent with the given input.
   * This is the main entry point. It handles all the instrumentation
   * automatically so subclasses focus on the actual logic.
   */
  async execute(
    input: string,
    options: AgentExecutionOptions = {},
  ): Promise<AgentResult> {
    const sessionId = randomUUID();
    const startTime = Date.now();
    this._totalTokensIn = 0;
    this._totalTokensOut = 0;
    this._toolCallCount = 0;
    this._totalCost = 0;
    this._sessionId = sessionId;
    let output = "";
    const organizationId = options.organizationId ?? this.config.organizationId;

    if (!organizationId) {
      throw new Error("organizationId is required to execute an agent.");
    }

    await startSession({
      sessionId,
      agentId: this.id,
      agentName: this.config.name,
      organizationId,
      input,
      modelProvider: this.config.modelProvider,
      modelName: this.config.modelName,
    });

    try {
      output = await this.run(input, sessionId);
      const duration = Date.now() - startTime;

      // Previously: `tokensIn: this._totalTokens` (which was tokensIn +
      // tokensOut summed) and `tokensOut: Math.floor(_totalTokens * 0.7)`
      // (a fabricated ratio). That made per-session cost attribution in
      // the dashboard impossible. Now we track tokensIn/tokensOut
      // separately and pass the real values to `recordCost`.
      await recordCost({
        sessionId,
        agentName: this.config.name,
        provider: this.config.modelProvider,
        modelName: this.config.modelName,
        tokensIn: this._totalTokensIn,
        tokensOut: this._totalTokensOut,
        cost: this._totalCost,
      });

      await finishSession({
        sessionId,
        output,
        duration,
        totalTokens: this._totalTokensIn + this._totalTokensOut,
        totalCost: this._totalCost,
        toolCalls: this._toolCallCount,
      });

      return {
        output,
        sessionId,
        totalTokens: this._totalTokensIn + this._totalTokensOut,
        totalCost: this._totalCost,
        duration,
        toolCalls: this._toolCallCount,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      await recordFailure({
        sessionId,
        error: error instanceof Error ? error.message : "Unknown error",
        duration,
      });
      throw error;
    } finally {
      this._sessionId = null;
    }
  }

  /** Subclasses implement the actual agent logic. */
  protected abstract run(input: string, sessionId: string): Promise<string>;

  /**
   * Run a tool and automatically instrument it.
   * Tracks tool calls via telemetry and Splunk.
   */
  protected async useTool(tool: AgentTool, input: unknown): Promise<unknown> {
    const sid = this._sessionId;
    if (!sid) throw new Error("Cannot call useTool outside of execute()");

    await trackToolCall({
      sessionId: sid,
      toolName: tool.name,
      input,
    });
    this._toolCallCount++;

    const startTime = Date.now();
    const result = await tool.execute(input);
    await trackToolReturn({
      sessionId: sid,
      toolName: tool.name,
      output: result,
      duration: Date.now() - startTime,
    });
    return result;
  }

  /**
   * Generate text using Vercel AI SDK with real model calls.
   * Automatically tracks tokens, cost, and traces.
   *
   * Usage in subclasses:
   *   const text = await this.generate("Explain quantum computing");
   */
  protected async generate(prompt: string): Promise<string> {
    const sid = this._sessionId;
    if (!sid) throw new Error("Cannot call generate outside of execute()");

    const startTime = Date.now();

    try {
      // Dynamic import of AI SDK, only loaded when actually used.
      const { generateText } = await import("ai");
      const model = await this.resolveModel();

      const result = await generateText({
        model,
        system: this.config.systemPrompt,
        prompt,
      });

      const duration = Date.now() - startTime;
      const tokensIn = result.usage.inputTokens ?? 0;
      const tokensOut = result.usage.outputTokens ?? 0;
      this._totalTokensIn += tokensIn;
      this._totalTokensOut += tokensOut;
      // Charge input + output at the configured per-1K rate, rounded to
      // 6 decimal places (micro-dollar precision) so the persisted cost
      // doesn't accumulate IEEE-754 noise (e.g. 0.10021000000000001).
      this._totalCost += this.calculateCost(tokensIn, tokensOut);

      await trackModelInvocation({
        sessionId: sid,
        provider: this.config.modelProvider,
        model: this.config.modelName,
        tokens: tokensIn,
        tokensOut,
        duration,
        output: result.text,
      });

      return result.text;
    } catch (error) {
      // Fallback: track invocation even on error
      const duration = Date.now() - startTime;
      await trackModelInvocation({
        sessionId: sid,
        provider: this.config.modelProvider,
        model: this.config.modelName,
        tokens: 0,
        tokensOut: 0,
        duration,
        output: "[generation failed]",
      });
      throw new Error(
        `AI model call failed for ${this.config.modelProvider}/${this.config.modelName}`,
        { cause: error },
      );
    }
  }

  /**
   * Generate text with tools available to the model.
   * The AI SDK handles tool calling automatically.
   */
  protected async generateWithTools(
    prompt: string,
    tools: Record<string, unknown>,
  ): Promise<{ text: string; toolResults: unknown[] }> {
    const sid = this._sessionId;
    if (!sid)
      throw new Error("Cannot call generateWithTools outside of execute()");

    const startTime = Date.now();
    const toolResults: unknown[] = [];

    try {
      const { generateText } = await import("ai");
      const model = await this.resolveModel();

      // Wrap tools with tracking (v5: tools are objects with description/inputSchema/execute)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const instrumentedTools: Record<string, any> = {};
      for (const [name, def] of Object.entries(tools)) {
        instrumentedTools[name] = {
          description: (def as { description?: string }).description ?? name,
          inputSchema: (def as { inputSchema?: unknown }).inputSchema ?? {},
          execute: async (args: unknown) => {
            // Call the original tool's execute function for real results
            const originalExecute = (
              def as { execute?: (input: unknown) => Promise<unknown> }
            ).execute;
            const startTime = Date.now();

            // Track the tool call via this.useTool (which also records the event)
            const result = await this.useTool(
              {
                name,
                description:
                  (def as { description?: string }).description ?? "",
                execute: async (toolInput: unknown) => {
                  return originalExecute
                    ? await originalExecute(toolInput)
                    : toolInput;
                },
              },
              args,
            );
            toolResults.push({
              tool: name,
              args,
              result,
              duration: Date.now() - startTime,
            });
            return result;
          },
        };
      }

      const result = await generateText({
        model,
        system: this.config.systemPrompt,
        prompt,
        tools: instrumentedTools,
      });

      const duration = Date.now() - startTime;
      const tokensIn = result.usage.inputTokens ?? 0;
      const tokensOut = result.usage.outputTokens ?? 0;
      this._totalTokensIn += tokensIn;
      this._totalTokensOut += tokensOut;
      this._totalCost += this.calculateCost(tokensIn, tokensOut);

      await trackModelInvocation({
        sessionId: sid,
        provider: this.config.modelProvider,
        model: this.config.modelName,
        tokens: tokensIn,
        tokensOut,
        duration,
        output: result.text,
      });

      return { text: result.text, toolResults };
    } catch (error) {
      const duration = Date.now() - startTime;
      await trackModelInvocation({
        sessionId: sid,
        provider: this.config.modelProvider,
        model: this.config.modelName,
        tokens: 0,
        tokensOut: 0,
        duration,
        output: "[generation failed]",
      });
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  /**
   * Track a model invocation manually for custom external calls.
   * @deprecated Use generate() or generateWithTools() for real AI SDK calls.
   */
  protected async invokeModel(
    provider: string,
    model: string,
    tokensIn: number,
    tokensOut: number,
    duration: number,
    output?: string,
  ): Promise<void> {
    const sid = this._sessionId;
    if (!sid) throw new Error("Cannot call invokeModel outside of execute()");

    this._totalTokensIn += tokensIn;
    this._totalTokensOut += tokensOut;
    await trackModelInvocation({
      sessionId: sid,
      provider,
      model,
      tokens: tokensIn,
      tokensOut,
      duration,
      output,
    });
  }

  /**
   * Round a USD cost to 6 decimal places (micro-dollar precision).
   *
   * Without this, `0.03 * 3340 / 1000` becomes `0.10021000000000001` in
   * IEEE-754 — a value the Splunk investigator and the session-detail UI
   * both render verbatim. Truncating to 6 decimals matches the precision
   * of Stripe and most LLM billing dashboards.
   */
  private static roundCost(usd: number): number {
    if (!Number.isFinite(usd)) return 0;
    return Math.round(usd * 1e6) / 1e6;
  }

  /** Calculate cost based on model provider pricing. */
  protected calculateCost(tokensIn: number, tokensOut = 0): number {
    // Per-agent override wins. Otherwise fall back to a built-in rate table
    // for the named provider. Custom OpenAI-compatible endpoints usually
    // set costPer1kTokens explicitly; Anthropic / OpenAI / Gemini use the
    // built-in defaults. Input and output are charged at the same rate
    // here — providers that distinguish (e.g. OpenAI's 1:3 input:output
    // ratio) should override `costPer1kTokens` per agent.
    const totalTokens = tokensIn + tokensOut;
    const override = this.config.costPer1kTokens;
    const raw =
      typeof override === "number" && override >= 0
        ? (totalTokens / 1000) * override
        : (() => {
            const pricing: Record<string, number> = {
              openai: 0.03, // $0.03/1K tokens (GPT-4 class)
              anthropic: 0.04, // $0.04/1K tokens (Claude class)
              gemini: 0.01, // $0.01/1K tokens
            };
            const rate =
              pricing[this.config.modelProvider.toLowerCase()] ?? 0.03;
            return (totalTokens / 1000) * rate;
          })();
    return Agent.roundCost(raw);
  }

  /**
   * Resolve a Vercel AI SDK model handle for the configured provider.
   *
   * Routing rules:
   * - If the agent has a custom `baseUrl`, treat it as OpenAI-compatible and
   *   build a `createOpenAI({ baseURL, apiKey })` client. This covers
   *   TokenRouter, OpenRouter, LiteLLM, Ollama, vLLM, etc.
   * - Otherwise, dispatch on provider name: `anthropic*` -> Anthropic SDK,
   *   everything else -> OpenAI SDK.
   */
  private async resolveModel() {
    const provider = this.config.modelProvider.toLowerCase();
    const { baseUrl, apiKey } = this.config;

    if (baseUrl) {
      const { createOpenAI } = await import("@ai-sdk/openai");
      // Some self-hosted gateways (Ollama, vLLM) reject any Authorization
      // header. Omit `apiKey` entirely when none is configured so the SDK
      // doesn't send `Bearer undefined`.
      const openai = apiKey
        ? createOpenAI({ baseURL: baseUrl, apiKey })
        : createOpenAI({ baseURL: baseUrl });
      return openai(this.config.modelName);
    }

    if (provider.includes("anthropic")) {
      const { anthropic } = await import("@ai-sdk/anthropic");
      return anthropic(this.config.modelName);
    }

    const { openai } = await import("@ai-sdk/openai");
    return openai(this.config.modelName);
  }
}
