import assert from "node:assert/strict";
import { test } from "node:test";

import type { BudgetUsage, CostBudgetPeriod } from "../src/cost-budget";

void test("CostBudgetPeriod is one of Hourly|Daily|Weekly|Monthly", () => {
  const periods: CostBudgetPeriod[] = ["Hourly", "Daily", "Weekly", "Monthly"];
  for (const period of periods) {
    assert.ok(typeof period === "string");
  }
});

void test("BudgetUsage exposes remaining budget", () => {
  const usage: BudgetUsage = {
    period: "Daily",
    usedCents: 250,
    usedTokens: 0,
    maxCostCents: 1000,
    maxTokens: 0,
    enforceHardCap: false,
    remainingCents: 750,
    remainingTokens: 0,
  };
  assert.equal(usage.remainingCents, 750);
  assert.equal(usage.enforceHardCap, false);
});
