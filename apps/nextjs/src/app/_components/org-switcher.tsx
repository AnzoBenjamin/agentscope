"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useTRPC } from "~/trpc/react";

export function OrgSwitcher() {
  const trpc = useTRPC();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data } = useQuery({
    ...trpc.auth.me.queryOptions(),
    retry: false,
  });
  const orgOptions = useMemo(() => {
    return (data?.organizations ?? []).map((item) => ({
      id: item.organization.id,
      label: item.organization.name,
      role: item.membership.role,
    }));
  }, [data?.organizations]);
  const activeOrgId =
    data?.activeMembership?.organizationId ?? orgOptions[0]?.id;

  if (orgOptions.length === 0) return null;

  return (
    <select
      value={activeOrgId ?? ""}
      onChange={async (event) => {
        const nextOrgId = event.target.value;
        window.localStorage.setItem("agentscope:organizationId", nextOrgId);
        await queryClient.invalidateQueries();
        router.refresh();
      }}
      className="bg-background border-border hidden h-9 max-w-52 rounded-md border px-2 text-sm md:block"
      aria-label="Select organization"
    >
      {orgOptions.map((option) => (
        <option key={option.id} value={option.id}>
          {option.label} ({option.role})
        </option>
      ))}
    </select>
  );
}
