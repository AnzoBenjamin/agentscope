import { Suspense } from "react";

import { AuthErrorBoundary } from "../_components/auth-error-boundary";
import { OrganizationGate } from "../_components/organization-gate";
import { SchedulesContent } from "./_components/schedules-content";

export const dynamic = "force-dynamic";

export default function SchedulesPage() {
  return (
    <AuthErrorBoundary>
      <OrganizationGate>
        <Suspense
          fallback={
            <div className="container mx-auto px-4 py-16">
              <div className="animate-pulse space-y-4">
                <div className="bg-muted h-8 w-48 rounded-md" />
                <div className="bg-muted h-64 rounded-xl" />
              </div>
            </div>
          }
        >
          <SchedulesContent />
        </Suspense>
      </OrganizationGate>
    </AuthErrorBoundary>
  );
}
