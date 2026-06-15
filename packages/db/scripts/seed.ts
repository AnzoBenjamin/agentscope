import { randomUUID } from "node:crypto";

import { db } from "../src/client";
import * as schema from "../src/schema";

/**
 * Seed the database with realistic demo data for AgentScope.
 * Run with: pnpm -F @agentscope/db with-env tsx scripts/seed.ts
 */

const ORG_ID = "00000000-0000-0000-0000-000000000001";

async function seed() {
  console.log("Seeding AgentScope demo data...\n");

  // Clean existing data
  await db.delete(schema.Event);
  await db.delete(schema.Cost);
  await db.delete(schema.AgentRun);
  await db.delete(schema.Session);
  await db.delete(schema.Agent);
  await db.delete(schema.OrganizationInvite);
  await db.delete(schema.OrganizationMember);
  await db.delete(schema.Organization);

  await db.insert(schema.Organization).values({
    id: ORG_ID,
    name: "AgentScope Demo",
    slug: "agentscope-demo",
    plan: "Hackathon",
  });

  // Create agents
  const agents = [
    {
      id: randomUUID(),
      organizationId: ORG_ID,
      name: "Research Agent",
      description:
        "Conducts in-depth market research, competitive analysis, and generates structured reports.",
      modelProvider: "OpenAI",
      modelName: "gpt-4o",
      status: "Active",
      costPer1kTokens: 0.03,
      systemPrompt: "You are an expert research analyst.",
    },
    {
      id: randomUUID(),
      organizationId: ORG_ID,
      name: "Support Agent",
      description:
        "Handles customer inquiries, troubleshoots issues, and escalates complex cases.",
      modelProvider: "Anthropic",
      modelName: "claude-sonnet-4-20250514",
      status: "Active",
      costPer1kTokens: 0.04,
      systemPrompt: "You are a helpful customer support agent.",
    },
    {
      id: randomUUID(),
      organizationId: ORG_ID,
      name: "Sales Agent",
      description:
        "Qualifies leads, schedules demos, and follows up with prospects.",
      modelProvider: "OpenAI",
      modelName: "gpt-4o-mini",
      status: "Active",
      costPer1kTokens: 0.01,
      systemPrompt: "You are a professional sales development representative.",
    },
    {
      id: randomUUID(),
      organizationId: ORG_ID,
      name: "Engineering Agent",
      description:
        "Reviews code, suggests improvements, and automates repetitive tasks.",
      modelProvider: "Anthropic",
      modelName: "claude-opus-4-20250514",
      status: "Paused",
      costPer1kTokens: 0.15,
      systemPrompt: "You are an expert software engineer.",
    },
    {
      id: randomUUID(),
      organizationId: ORG_ID,
      name: "Finance Agent",
      description:
        "Analyzes financial data, generates forecasts, and tracks budget variances.",
      modelProvider: "Gemini",
      modelName: "gemini-2.5-pro",
      status: "Active",
      costPer1kTokens: 0.01,
      systemPrompt: "You are a financial analyst.",
    },
  ];

  for (const agent of agents) {
    await db.insert(schema.Agent).values(agent);
  }
  console.log(`Created ${agents.length} agents`);

  // Create sessions with events for each agent
  for (const agent of agents) {
    const sessionCount =
      agent.status === "Paused" ? 2 : 5 + Math.floor(Math.random() * 5);

    for (let i = 0; i < sessionCount; i++) {
      const sessionId = randomUUID();
      const startedAt = new Date(
        Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000,
      );
      const endedAt = new Date(
        startedAt.getTime() + (60000 + Math.random() * 300000),
      );
      const statuses = [
        "Completed",
        "Completed",
        "Completed",
        "Completed",
        "Failed",
      ];
      const status = statuses[Math.floor(Math.random() * statuses.length)]!;
      const tokens = Math.floor(500 + Math.random() * 12000);
      const cost = (tokens / 1000) * (0.01 + Math.random() * 0.04);

      const tasks = [
        "Research the Uganda fintech market",
        "Analyze competitor pricing strategies for Q3",
        "Investigate emerging trends in edge computing",
        "Generate customer satisfaction report for last quarter",
        "Review security incident response procedures",
        "Analyze API performance metrics and suggest optimizations",
        "Research regulatory changes affecting our industry",
        "Generate weekly sales pipeline summary",
        "Audit user access permissions across systems",
        "Compare cloud infrastructure costs across providers",
      ];

      await db.insert(schema.Session).values({
        id: sessionId,
        agentId: agent.id,
        organizationId: ORG_ID,
        status,
        input: tasks[Math.floor(Math.random() * tasks.length)]!,
        output:
          status === "Failed"
            ? ""
            : "Analysis complete. Key findings: Market shows 12% YoY growth with 3 major opportunities identified. Recommend further investigation into sectors A and B.",
        totalTokens: tokens,
        totalCost: Math.round(cost * 10000) / 10000,
        toolCalls: Math.floor(Math.random() * 8) + 1,
        startedAt,
        endedAt: status === "Completed" ? endedAt : null,
        createdAt: startedAt,
      });

      // Create events for each session
      const events: {
        sessionId: string;
        eventType: string;
        payload: Record<string, unknown>;
        createdAt: Date;
      }[] = [
        {
          sessionId,
          eventType: "SessionStarted",
          payload: {
            agentId: agent.id,
            agentName: agent.name,
            input: "Task started",
            modelProvider: agent.modelProvider,
            modelName: agent.modelName,
          },
          createdAt: new Date(startedAt.getTime() + 100),
        },
        {
          sessionId,
          eventType: "PromptReceived",
          payload: { prompt: "Execute assigned task", tokens: 150 },
          createdAt: new Date(startedAt.getTime() + 200),
        },
        {
          sessionId,
          eventType: "ContextLoaded",
          payload: { source: "knowledge-base", size: 4200 },
          createdAt: new Date(startedAt.getTime() + 500),
        },
        {
          sessionId,
          eventType: "ToolCalled",
          payload: {
            toolName: "splunk-context-search",
            input: "operational telemetry",
          },
          createdAt: new Date(startedAt.getTime() + 1200),
        },
        {
          sessionId,
          eventType: "ToolReturned",
          payload: {
            toolName: "splunk-context-search",
            output: { results: 5 },
            duration: 1800,
          },
          createdAt: new Date(startedAt.getTime() + 3000),
        },
        {
          sessionId,
          eventType: "ModelInvoked",
          payload: {
            provider: agent.modelProvider,
            model: agent.modelName,
            tokens: Math.floor(tokens * 0.4),
          },
          createdAt: new Date(startedAt.getTime() + 3500),
        },
        {
          sessionId,
          eventType: "ModelCompleted",
          payload: {
            provider: agent.modelProvider,
            model: agent.modelName,
            tokensIn: Math.floor(tokens * 0.4),
            tokensOut: Math.floor(tokens * 0.6),
            duration: 2500,
          },
          createdAt: new Date(startedAt.getTime() + 6000),
        },
        ...(status === "Completed"
          ? [
              {
                sessionId,
                eventType: "CostRecorded",
                payload: {
                  provider: agent.modelProvider,
                  modelName: agent.modelName,
                  tokensIn: Math.floor(tokens * 0.4),
                  tokensOut: Math.floor(tokens * 0.6),
                  cost,
                },
                createdAt: new Date(startedAt.getTime() + 8000),
              },
              {
                sessionId,
                eventType: "SessionCompleted",
                payload: {
                  output: "Task completed successfully",
                  duration: 30000,
                  totalTokens: tokens,
                  totalCost: cost,
                },
                createdAt: new Date(startedAt.getTime() + 9000),
              },
            ]
          : [
              {
                sessionId,
                eventType: "SessionFailed",
                payload: { error: "Rate limit exceeded", duration: 15000 },
                createdAt: new Date(startedAt.getTime() + 7000),
              },
            ]),
      ];

      for (const event of events) {
        await db.insert(schema.Event).values(event);
      }

      // Create cost record
      if (status === "Completed") {
        await db.insert(schema.Cost).values({
          id: randomUUID(),
          sessionId,
          provider: agent.modelProvider,
          modelName: agent.modelName,
          tokensIn: Math.floor(tokens * 0.4),
          tokensOut: Math.floor(tokens * 0.6),
          cost: Math.round(cost * 10000) / 10000,
          createdAt: endedAt,
        });
      }
    }
  }

  // Count results
  const agentCount = (await db.select().from(schema.Agent)).length;
  const sessionCount = (await db.select().from(schema.Session)).length;
  const eventCount = (await db.select().from(schema.Event)).length;
  const costCount = (await db.select().from(schema.Cost)).length;

  console.log(`\nSeed complete:`);
  console.log(`   Agents:   ${agentCount}`);
  console.log(`   Sessions: ${sessionCount}`);
  console.log(`   Events:   ${eventCount}`);
  console.log(`   Costs:    ${costCount}`);
  console.log(`\nReady to run: pnpm dev\n`);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
