export interface MembershipRoleState {
  id: string;
  role: string;
  status: string;
}

export function hasAnotherActiveOwner(
  memberships: MembershipRoleState[],
  memberId: string,
) {
  return memberships.some(
    (membership) =>
      membership.id !== memberId &&
      membership.role === "Owner" &&
      membership.status === "Active",
  );
}
