import { Suspense } from "react";

import { AuthErrorBoundary } from "../_components/auth-error-boundary";
import { OrganizationGate } from "../_components/organization-gate";
import { AgentsContent } from "./_components/agents-content";

export const dynamic = "force-dynamic";

export default function AgentsPage() {
  return (
    <AuthErrorBoundary>
      <OrganizationGate>
        <Suspense
          fallback={
            <div className="container mx-auto px-4 py-16">
              <div className="animate-pulse space-y-8">
                <div className="bg-muted h-8 w-48 rounded-md" />
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {[1, 2, 3, 4, 5, 6].map((i) => (
                    <div key={i} className="bg-muted h-44 rounded-xl" />
                  ))}
                </div>
              </div>
            </div>
          }
        >
          <AgentsContent />
        </Suspense>
      </OrganizationGate>
    </AuthErrorBoundary>
  );
}
