import { Suspense } from "react";

import { AuthErrorBoundary } from "../_components/auth-error-boundary";
import { DashboardContent } from "../_components/dashboard/dashboard-content";
import { OrganizationGate } from "../_components/organization-gate";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  return (
    <AuthErrorBoundary>
      <OrganizationGate>
        <Suspense
          fallback={
            <div className="container mx-auto px-4 py-16">
              <div className="animate-pulse space-y-8">
                <div className="bg-muted h-8 w-64 rounded-md" />
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="bg-muted h-32 rounded-xl" />
                  ))}
                </div>
              </div>
            </div>
          }
        >
          <DashboardContent />
        </Suspense>
      </OrganizationGate>
    </AuthErrorBoundary>
  );
}
