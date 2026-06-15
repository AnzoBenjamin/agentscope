import { Suspense } from "react";

import { getSession } from "~/auth/server";
import { AuthShowcase } from "./auth-showcase";

export async function AuthSection() {
  const session = await getSession();

  return (
    <Suspense fallback={null}>
      <AuthShowcase session={session} compact />
    </Suspense>
  );
}
