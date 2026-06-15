import { Suspense } from "react";

import { AuthErrorBoundary } from "../_components/auth-error-boundary";
import { OrganizationGate } from "../_components/organization-gate";
import { SettingsContent } from "./settings-content";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return (
    <AuthErrorBoundary>
      <OrganizationGate>
        <Suspense
          fallback={
            <div className="container mx-auto px-4 py-16">
              <div className="animate-pulse space-y-5">
                <div className="bg-muted h-8 w-56 rounded-md" />
                <div className="bg-muted h-96 rounded-xl" />
              </div>
            </div>
          }
        >
          <SettingsContent />
        </Suspense>
      </OrganizationGate>
    </AuthErrorBoundary>
  );
}
