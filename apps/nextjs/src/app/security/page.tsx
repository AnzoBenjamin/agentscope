import { Suspense } from "react";

import { AuthErrorBoundary } from "../_components/auth-error-boundary";
import { OrganizationGate } from "../_components/organization-gate";
import { SecurityContent } from "./_components/security-content";

export const dynamic = "force-dynamic";

export default function SecurityPage() {
  return (
    <AuthErrorBoundary>
      <OrganizationGate>
        <Suspense
          fallback={
            <div className="container mx-auto px-4 py-16">
              <div className="animate-pulse space-y-4">
                <div className="bg-muted h-8 w-48 rounded-md" />
                <div className="bg-muted h-96 rounded-xl" />
              </div>
            </div>
          }
        >
          <SecurityContent />
        </Suspense>
      </OrganizationGate>
    </AuthErrorBoundary>
  );
}
