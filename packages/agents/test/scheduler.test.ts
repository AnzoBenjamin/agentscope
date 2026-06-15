import assert from "node:assert/strict";
import { test } from "node:test";

import type { ScheduleFrequency } from "../src/scheduler";

void test("ScheduleFrequency includes the supported cadence strings", () => {
  const frequencies: ScheduleFrequency[] = [
    "Once",
    "Hourly",
    "Daily",
    "Weekly",
    "Monthly",
    "Cron",
  ];
  for (const freq of frequencies) {
    assert.ok(typeof freq === "string");
  }
});
