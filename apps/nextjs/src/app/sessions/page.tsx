import { Suspense } from "react";

import { AuthErrorBoundary } from "../_components/auth-error-boundary";
import { OrganizationGate } from "../_components/organization-gate";
import { SessionsContent } from "./_components/sessions-content";

export const dynamic = "force-dynamic";

export default function SessionsPage() {
  return (
    <AuthErrorBoundary>
      <OrganizationGate>
        <Suspense
          fallback={
            <div className="container mx-auto px-4 py-16">
              <div className="animate-pulse space-y-4">
                <div className="bg-muted h-8 w-48 rounded-md" />
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="bg-muted h-20 rounded-xl" />
                ))}
              </div>
            </div>
          }
        >
          <SessionsContent />
        </Suspense>
      </OrganizationGate>
    </AuthErrorBoundary>
  );
}
