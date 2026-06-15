import { agentRouter } from "./router/agent";
import { alertsRouter } from "./router/alerts";
import { analyticsRouter } from "./router/analytics";
import { authRouter } from "./router/auth";
import { billingRouter } from "./router/billing";
import { complianceRouter } from "./router/compliance";
import { costBudgetRouter } from "./router/cost-budget";
import { organizationRouter } from "./router/organization";
import { scheduleRouter } from "./router/schedule";
import { securityRouter } from "./router/security";
import { sessionRouter } from "./router/session";
import { splunkRouter } from "./router/splunk";
import { streamRouter } from "./router/stream";
import { createTRPCRouter } from "./trpc";

export const appRouter = createTRPCRouter({
  auth: authRouter,
  organization: organizationRouter,
  agent: agentRouter,
  session: sessionRouter,
  schedule: scheduleRouter,
  costBudget: costBudgetRouter,
  stream: streamRouter,
  analytics: analyticsRouter,
  splunk: splunkRouter,
  billing: billingRouter,
  compliance: complianceRouter,
  alerts: alertsRouter,
  security: securityRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;
