"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@agentscope/ui/button";
import { Input } from "@agentscope/ui/input";
import { toast } from "@agentscope/ui/toast";

import { useTRPC } from "~/trpc/react";

export function OrganizationGate({ children }: { children: React.ReactNode }) {
  const trpc = useTRPC();
  const router = useRouter();
  const queryClient = useQueryClient();
  const meQuery = useQuery({
    ...trpc.auth.me.queryOptions(),
    retry: false,
  });
  const [name, setName] = useState("");

  const createOrganization = useMutation(
    trpc.auth.createOrganization.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries(trpc.auth.pathFilter());
        await queryClient.invalidateQueries(trpc.agent.pathFilter());
        toast.success("Organization created");
        router.refresh();
      },
      onError: (error) => {
        toast.error(error.message || "Failed to create organization");
      },
    }),
  );

  if (meQuery.isLoading) {
    return (
      <div className="container mx-auto px-4 py-16">
        <div className="mx-auto max-w-md space-y-4">
          <div className="bg-muted h-8 w-56 animate-pulse rounded-md" />
          <div className="bg-muted h-28 animate-pulse rounded-xl" />
        </div>
      </div>
    );
  }

  if (meQuery.isError || !meQuery.data) {
    return (
      <div className="container mx-auto px-4 py-16">
        <div className="mx-auto max-w-md text-center">
          <h1 className="text-3xl font-bold tracking-tight">
            Sign In Required
          </h1>
          <p className="text-muted-foreground mt-4">
            Sign in or create an account to access your AgentScope workspace.
          </p>
          <div className="mt-8">
            <Button asChild>
              <Link href="/">Back to Home</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (meQuery.data.organizations.length === 0) {
    const defaultName = `${meQuery.data.session.user.name}'s Organization`;

    return (
      <div className="container mx-auto px-4 py-16">
        <div className="border-border bg-card mx-auto max-w-lg rounded-xl border p-6">
          <h1 className="text-2xl font-bold tracking-tight">
            Create Your Organization
          </h1>
          <p className="text-muted-foreground mt-2 text-sm">
            AgentScope scopes agents, sessions, invites, and Splunk telemetry to
            an organization. Create one to provision your starter AI employees.
          </p>
          <form
            className="mt-6 flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              createOrganization.mutate({
                name: name.trim() || defaultName,
              });
            }}
          >
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={defaultName}
              aria-label="Organization name"
            />
            <Button type="submit" disabled={createOrganization.isPending}>
              {createOrganization.isPending
                ? "Creating..."
                : "Create Organization"}
            </Button>
          </form>
        </div>
      </div>
    );
  }

  return children;
}
