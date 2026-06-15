import type { Metadata, Viewport } from "next";
import Link from "next/link";

import { ThemeProvider, ThemeToggle } from "@agentscope/ui/theme";
import { Toaster } from "@agentscope/ui/toast";

import { AuthSection } from "~/app/_components/auth-section";
import { NavApprovalBadge } from "~/app/_components/nav-approval-badge";
import { OrgSwitcher } from "~/app/_components/org-switcher";
import { env } from "~/env";
import { TRPCReactProvider } from "~/trpc/react";

import "~/app/styles.css";

export const metadata: Metadata = {
  metadataBase: new URL(
    env.VERCEL_ENV === "production"
      ? "https://agentscope.dev"
      : "http://localhost:3000",
  ),
  title: "AgentScope - The OS for AI Employees",
  description:
    "Deploy, manage, monitor, and audit AI employees. Powered by Splunk.",
  openGraph: {
    title: "AgentScope - The OS for AI Employees",
    description:
      "Deploy, manage, monitor, and audit AI employees. Powered by Splunk.",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "white" },
    { media: "(prefers-color-scheme: dark)", color: "black" },
  ],
};

const navLinks = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/agents", label: "Agents" },
  { href: "/sessions", label: "Sessions" },
  { href: "/schedules", label: "Schedules" },
  { href: "/tools", label: "Tools" },
  { href: "/evaluations", label: "Evals" },
  { href: "/security", label: "Security" },
  { href: "/settings", label: "Settings" },
];

export default function RootLayout(props: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-background text-foreground min-h-screen font-sans antialiased">
        <ThemeProvider>
          <TRPCReactProvider>
            <div className="flex min-h-screen flex-col">
              <header className="bg-card/50 border-border sticky top-0 z-50 border-b backdrop-blur-sm">
                <div className="container mx-auto flex h-14 items-center justify-between px-4">
                  <div className="flex items-center gap-6">
                    <Link href="/" className="text-lg font-bold tracking-tight">
                      AgentScope
                    </Link>
                    <nav className="flex items-center gap-1">
                      {navLinks.map((link) =>
                        link.href === "/agents" ? (
                          <NavApprovalBadge key={link.href} />
                        ) : (
                          <Link
                            key={link.href}
                            href={link.href}
                            className="text-muted-foreground hover:text-foreground rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
                          >
                            {link.label}
                          </Link>
                        ),
                      )}
                    </nav>
                  </div>
                  <div className="flex items-center gap-2">
                    <OrgSwitcher />
                    <AuthSection />
                    <ThemeToggle />
                  </div>
                </div>
              </header>
              <main className="flex-1">{props.children}</main>
            </div>
          </TRPCReactProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
