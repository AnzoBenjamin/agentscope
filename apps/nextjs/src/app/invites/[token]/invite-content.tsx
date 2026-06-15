"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { Button } from "@agentscope/ui/button";
import { toast } from "@agentscope/ui/toast";

import { useTRPC } from "~/trpc/react";

export function InviteContent({ token }: { token: string }) {
  const trpc = useTRPC();
  const router = useRouter();
  const queryClient = useQueryClient();
  const acceptInvite = useMutation(
    trpc.auth.acceptInvite.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries(trpc.auth.pathFilter());
        toast.success("Invite accepted");
        router.push("/dashboard");
        router.refresh();
      },
      onError: (error) => {
        toast.error(error.message || "Failed to accept invite");
      },
    }),
  );

  return (
    <div className="container mx-auto px-4 py-16">
      <div className="border-border bg-card mx-auto max-w-md rounded-xl border p-6 text-center">
        <h1 className="text-2xl font-bold tracking-tight">Join AgentScope</h1>
        <p className="text-muted-foreground mt-3 text-sm">
          Accept this organization invite with the email address it was sent to.
          If you are not signed in yet, sign in from the header first.
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Button
            onClick={() => acceptInvite.mutate({ token })}
            disabled={acceptInvite.isPending}
          >
            {acceptInvite.isPending ? "Accepting..." : "Accept Invite"}
          </Button>
          <Button variant="outline" asChild>
            <Link href="/">Back to Home</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
