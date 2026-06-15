const { randomUUID } = require("node:crypto");
const { Pool } = require("pg");

const POSTGRES_URL =
  process.env.POSTGRES_URL ||
  "postgresql://agentscope:agentscope@localhost:5432/agentscope";

const ORG_ID = "00000000-0000-0000-0000-000000000001";

async function seed() {
  console.log("Seeding AgentScope demo data...\n");

  const pool = new Pool({ connectionString: POSTGRES_URL });

  // Clean existing data
  await pool.query("DELETE FROM event");
  await pool.query("DELETE FROM cost");
  await pool.query("DELETE FROM agent_run");
  await pool.query("DELETE FROM agent_session");
  await pool.query("DELETE FROM agent");
  await pool.query("DELETE FROM organization_invite");
  await pool.query("DELETE FROM organization_member");
  await pool.query("DELETE FROM organization");

  await pool.query(
    `INSERT INTO organization (id, name, slug, plan)
     VALUES ($1, $2, $3, $4)`,
    [ORG_ID, "AgentScope Demo", "agentscope-demo", "Hackathon"],
  );

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
      systemPrompt: "You are an expert research analyst.",
      createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      updatedAt: new Date(),
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
      systemPrompt: "You are a helpful customer support agent.",
      createdAt: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000),
      updatedAt: new Date(),
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
      systemPrompt: "You are a professional sales development representative.",
      createdAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
      updatedAt: new Date(),
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
      systemPrompt: "You are an expert software engineer.",
      createdAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
      updatedAt: new Date(),
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
      systemPrompt: "You are a financial analyst.",
      createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      updatedAt: new Date(),
    },
  ];

  for (const agent of agents) {
    await pool.query(
      `INSERT INTO agent (id, organization_id, name, description, model_provider, model_name, status, system_prompt, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        agent.id,
        agent.organizationId,
        agent.name,
        agent.description,
        agent.modelProvider,
        agent.modelName,
        agent.status,
        agent.systemPrompt,
        agent.createdAt,
        agent.updatedAt,
      ],
    );
  }
  console.log(`Created ${agents.length} agents`);

  let totalSessions = 0;
  let totalEvents = 0;
  let totalCosts = 0;

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
      const status = statuses[Math.floor(Math.random() * statuses.length)];
      const tokens = Math.floor(500 + Math.random() * 12000);
      const cost =
        Math.round((tokens / 1000) * (0.01 + Math.random() * 0.04) * 10000) /
        10000;

      const task = tasks[Math.floor(Math.random() * tasks.length)];

      await pool.query(
        `INSERT INTO agent_session (id, agent_id, organization_id, status, input, output, total_tokens, total_cost, tool_calls, started_at, ended_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          sessionId,
          agent.id,
          ORG_ID,
          status,
          task,
          status === "Failed"
            ? ""
            : "Analysis complete. Key findings: Market shows 12% YoY growth with 3 major opportunities identified. Recommend further investigation into sectors A and B.",
          tokens,
          cost,
          Math.floor(Math.random() * 8) + 1,
          startedAt,
          status === "Completed" ? endedAt : null,
          startedAt,
        ],
      );
      totalSessions++;

      const baseEvents = [
        {
          eventType: "SessionStarted",
          payload: JSON.stringify({
            agentId: agent.id,
            agentName: agent.name,
            input: "Task started",
            modelProvider: agent.modelProvider,
            modelName: agent.modelName,
          }),
          createdAt: new Date(startedAt.getTime() + 100),
        },
        {
          eventType: "PromptReceived",
          payload: JSON.stringify({
            prompt: "Execute assigned task",
            tokens: 150,
          }),
          createdAt: new Date(startedAt.getTime() + 200),
        },
        {
          eventType: "ContextLoaded",
          payload: JSON.stringify({ source: "knowledge-base", size: 4200 }),
          createdAt: new Date(startedAt.getTime() + 500),
        },
        {
          eventType: "ToolCalled",
          payload: JSON.stringify({
            toolName: "splunk-context-search",
            input: "operational telemetry",
          }),
          createdAt: new Date(startedAt.getTime() + 1200),
        },
        {
          eventType: "ToolReturned",
          payload: JSON.stringify({
            toolName: "splunk-context-search",
            output: { results: 5 },
            duration: 1800,
          }),
          createdAt: new Date(startedAt.getTime() + 3000),
        },
        {
          eventType: "ModelInvoked",
          payload: JSON.stringify({
            provider: agent.modelProvider,
            model: agent.modelName,
            tokens: Math.floor(tokens * 0.4),
          }),
          createdAt: new Date(startedAt.getTime() + 3500),
        },
        {
          eventType: "ModelCompleted",
          payload: JSON.stringify({
            provider: agent.modelProvider,
            model: agent.modelName,
            tokensIn: Math.floor(tokens * 0.4),
            tokensOut: Math.floor(tokens * 0.6),
            duration: 2500,
          }),
          createdAt: new Date(startedAt.getTime() + 6000),
        },
      ];

      const outcomeEvents =
        status === "Completed"
          ? [
              {
                eventType: "CostRecorded",
                payload: JSON.stringify({
                  provider: agent.modelProvider,
                  modelName: agent.modelName,
                  tokensIn: Math.floor(tokens * 0.4),
                  tokensOut: Math.floor(tokens * 0.6),
                  cost,
                }),
                createdAt: new Date(startedAt.getTime() + 8000),
              },
              {
                eventType: "SessionCompleted",
                payload: JSON.stringify({
                  output: "Task completed successfully",
                  duration: 30000,
                  totalTokens: tokens,
                  totalCost: cost,
                }),
                createdAt: new Date(startedAt.getTime() + 9000),
              },
            ]
          : [
              {
                eventType: "SessionFailed",
                payload: JSON.stringify({
                  error: "Rate limit exceeded",
                  duration: 15000,
                }),
                createdAt: new Date(startedAt.getTime() + 7000),
              },
            ];

      const allEvents = [...baseEvents, ...outcomeEvents];

      for (const event of allEvents) {
        await pool.query(
          `INSERT INTO event (id, session_id, event_type, payload, created_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            randomUUID(),
            sessionId,
            event.eventType,
            event.payload,
            event.createdAt,
          ],
        );
        totalEvents++;
      }

      if (status === "Completed") {
        await pool.query(
          `INSERT INTO cost (id, session_id, provider, model_name, tokens_in, tokens_out, cost, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            randomUUID(),
            sessionId,
            agent.modelProvider,
            agent.modelName,
            Math.floor(tokens * 0.4),
            Math.floor(tokens * 0.6),
            cost,
            endedAt,
          ],
        );
        totalCosts++;
      }
    }
  }

  await pool.end();

  console.log(`\nSeed complete:`);
  console.log(`   Agents:   ${agents.length}`);
  console.log(`   Sessions: ${totalSessions}`);
  console.log(`   Events:   ${totalEvents}`);
  console.log(`   Costs:    ${totalCosts}`);
  console.log(`\nReady to run: pnpm dev\n`);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
