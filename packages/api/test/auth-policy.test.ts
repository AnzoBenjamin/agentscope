import assert from "node:assert/strict";
import test from "node:test";

import { hasAnotherActiveOwner } from "../src/router/auth-policy";

void test("hasAnotherActiveOwner allows owner changes when another active owner exists", () => {
  assert.equal(
    hasAnotherActiveOwner(
      [
        { id: "owner-1", role: "Owner", status: "Active" },
        { id: "owner-2", role: "Owner", status: "Active" },
      ],
      "owner-1",
    ),
    true,
  );
});

void test("hasAnotherActiveOwner rejects the last active owner", () => {
  assert.equal(
    hasAnotherActiveOwner(
      [
        { id: "owner-1", role: "Owner", status: "Active" },
        { id: "admin-1", role: "Admin", status: "Active" },
        { id: "owner-2", role: "Owner", status: "Disabled" },
      ],
      "owner-1",
    ),
    false,
  );
});
