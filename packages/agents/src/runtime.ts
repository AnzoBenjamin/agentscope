import type { AgentConfig } from "./types";
import { ResearchAgent } from "./research-agent";

export function createRuntimeAgent(input: {
  id: string;
  type: string;
  config: Partial<AgentConfig>;
}) {
  const base = {
    ...input.config,
    name: input.config.name ?? "AgentScope Agent",
  };

  if (input.type === "Reliability") {
    return new ResearchAgent(input.id, {
      ...base,
      description:
        base.description ??
        "Investigates failure, retry, latency, and Splunk readiness risks.",
      systemPrompt:
        base.systemPrompt ??
        "You are an SRE for AI employees. Use Splunk telemetry to explain reliability risks, retries, stuck jobs, and mitigation priorities.",
    });
  }

  if (input.type === "CostAnalyst") {
    return new ResearchAgent(input.id, {
      ...base,
      description:
        base.description ??
        "Investigates model spend, token usage, and plan-limit pressure.",
      systemPrompt:
        base.systemPrompt ??
        "You are a FinOps analyst for AI systems. Use Splunk telemetry and AgentScope cost events to attribute spend, detect waste, and recommend model or usage controls.",
    });
  }

  if (input.type === "Security") {
    return new ResearchAgent(input.id, {
      ...base,
      description:
        base.description ??
        "Investigates risky tool use, audit gaps, and access-control concerns.",
      systemPrompt:
        base.systemPrompt ??
        "You are a security operations analyst for AI agents. Use Splunk telemetry to identify risky tool use, missing audit evidence, suspicious access, and containment steps.",
    });
  }

  return new ResearchAgent(input.id, base);
}
