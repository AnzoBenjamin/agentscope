import { cache } from "react";
import { headers } from "next/headers";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";

import type { AppRouter } from "@agentscope/api";
import { appRouter, createTRPCContext } from "@agentscope/api";

import { auth } from "~/auth/server";
import { createQueryClient } from "./query-client";

/**
 * This wraps the `createTRPCContext` helper and provides the required context for the tRPC API when
 * handling a tRPC call from a React Server Component.
 */
const createContext = cache(async () => {
  const heads = new Headers(await headers());
  heads.set("x-trpc-source", "rsc");

  return createTRPCContext({
    headers: heads,
    auth,
  });
});

const getQueryClient = cache(createQueryClient);

export const trpc = createTRPCOptionsProxy<AppRouter>({
  router: appRouter,
  ctx: createContext,
  queryClient: getQueryClient,
});

export function HydrateClient(props: { children: React.ReactNode }) {
  const queryClient = getQueryClient();
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      {props.children}
    </HydrationBoundary>
  );
}
export function prefetch(
  queryOptions: { queryKey: readonly unknown[] } & Record<string, unknown>,
) {
  const queryClient = getQueryClient();
  // Type-narrow at runtime: infinite queries carry `{ type: "infinite" }` in
  // their query key and need `prefetchInfiniteQuery` to set the cursor
  // machinery. The two-step `as unknown as` cast is type-safe (it goes
  // through `unknown` which is compatible with everything) and avoids the
  // unchecked `as any` that was here previously.
  const queryKey = queryOptions.queryKey;
  const meta = queryKey[1] as { type?: unknown } | undefined;
  if (meta?.type === "infinite") {
    void queryClient.prefetchInfiniteQuery(
      queryOptions as unknown as Parameters<
        typeof queryClient.prefetchInfiniteQuery
      >[0],
    );
  } else {
    void queryClient.prefetchQuery(
      queryOptions as unknown as Parameters<typeof queryClient.prefetchQuery>[0],
    );
  }
}
