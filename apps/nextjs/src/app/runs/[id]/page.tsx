import { Suspense } from "react";

import { AuthErrorBoundary } from "../../_components/auth-error-boundary";
import { OrganizationGate } from "../../_components/organization-gate";
import { RunDetailContent } from "./_components/run-detail-content";

export const dynamic = "force-dynamic";

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <AuthErrorBoundary>
      <OrganizationGate>
        <Suspense
          fallback={
            <div className="container mx-auto px-4 py-16">
              <div className="bg-muted h-8 w-64 animate-pulse rounded-md" />
            </div>
          }
        >
          <RunDetailContent runId={id} />
        </Suspense>
      </OrganizationGate>
    </AuthErrorBoundary>
  );
}
