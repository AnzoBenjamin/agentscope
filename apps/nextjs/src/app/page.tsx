import Link from "next/link";

import { Button } from "@agentscope/ui/button";

export default function LandingPage() {
  return (
    <div className="flex flex-col">
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="from-primary/5 absolute inset-0 bg-gradient-to-br via-transparent to-emerald-500/5" />
        <div className="relative container mx-auto px-4 pt-24 pb-20 sm:pt-32">
          <div className="mx-auto max-w-3xl text-center">
            <div className="border-border bg-card text-muted-foreground mb-6 inline-flex items-center rounded-full border px-4 py-1.5 text-sm">
              <span className="mr-2 inline-block size-2 rounded-full bg-emerald-400" />
              Powered by Splunk Observability
            </div>
            <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">
              The OS for{" "}
              <span className="from-primary bg-gradient-to-r to-emerald-400 bg-clip-text text-transparent">
                AI Employees
              </span>
            </h1>
            <p className="text-muted-foreground mt-6 text-lg sm:text-xl">
              Deploy, manage, monitor, and audit AI agents at scale. AgentScope
              gives you complete observability into your AI workforce — from
              token costs to anomaly detection, all backed by Splunk.
            </p>
            <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
              <Button size="lg" asChild>
                <Link href="/dashboard">Go to Dashboard</Link>
              </Button>
              <Button variant="outline" size="lg" asChild>
                <Link href="/agents">Explore Agents</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="border-border bg-card/30 border-t py-24">
        <div className="container mx-auto px-4">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight">
              Everything you need to run AI at scale
            </h2>
            <p className="text-muted-foreground mt-4">
              From deployment to observability, AgentScope has you covered.
            </p>
          </div>
          <div className="mt-16 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="group border-border bg-card hover:border-primary/30 rounded-xl border p-6 transition-colors"
              >
                <div className="bg-primary/10 text-primary mb-4 inline-flex size-10 items-center justify-center rounded-lg">
                  {feature.icon}
                </div>
                <h3 className="mb-2 font-semibold">{feature.title}</h3>
                <p className="text-muted-foreground text-sm">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Stats — these are product design targets, not live metrics.
          They are intentionally hard-coded for the public marketing page
          so unauthenticated visitors can scan what AgentScope is aiming
          for. Live numbers live in the authenticated dashboard. */}
      <section className="border-border border-t py-24">
        <div className="container mx-auto px-4">
          <p className="text-muted-foreground mb-8 text-center text-xs uppercase tracking-wider">
            Design targets
          </p>
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {stats.map((stat) => (
              <div key={stat.label} className="text-center">
                <p className="text-3xl font-bold">{stat.value}</p>
                <p className="text-muted-foreground mt-1 text-sm">
                  {stat.label}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-border border-t py-24">
        <div className="container mx-auto px-4 text-center">
          <h2 className="text-3xl font-bold tracking-tight">
            Ready to deploy your first AI employee?
          </h2>
          <p className="text-muted-foreground mt-4">
            Sign in to access the full dashboard and start managing your agents.
          </p>
          <div className="mt-8">
            <Button size="lg" asChild>
              <Link href="/dashboard">Get Started</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-border border-t py-8">
        <div className="container mx-auto flex flex-col items-center justify-between gap-4 px-4 sm:flex-row">
          <p className="text-muted-foreground text-sm">
            AgentScope — The OS for AI Employees
          </p>
          <p className="text-muted-foreground text-sm">
            Powered by Splunk · OpenTelemetry · Better Auth
          </p>
        </div>
      </footer>
    </div>
  );
}

const features = [
  {
    title: "Agent Deployment",
    description:
      "Deploy AI agents with one click. Support for OpenAI, Anthropic, Google, and any Vercel AI SDK provider.",
    icon: <RocketIcon />,
  },
  {
    title: "Real-Time Observability",
    description:
      "Full telemetry pipeline with Splunk HEC. Track every LLM call, tool use, token spend, and error in real time.",
    icon: <ChartIcon />,
  },
  {
    title: "Anomaly Detection",
    description:
      "ML-powered anomaly detection flags hallucinations, cost spikes, and failure rate escalations before they impact users.",
    icon: <ShieldIcon />,
  },
  {
    title: "Cost Tracking",
    description:
      "Per-agent, per-session, per-token cost tracking. Know exactly what your AI workforce costs down to the cent.",
    icon: <DollarIcon />,
  },
  {
    title: "Session Replay",
    description:
      "Full audit trail of every agent session. Replay tool calls, LLM responses, and decisions for compliance and debugging.",
    icon: <ReplayIcon />,
  },
  {
    title: "Role-Based Access",
    description:
      "Fine-grained RBAC with Owner, Admin, Manager, Member, and Viewer roles. Control who can deploy, view, or manage agents.",
    icon: <LockIcon />,
  },
];

const stats = [
  { value: "100%", label: "Observability Coverage" },
  { value: "< 5ms", label: "Event Latency" },
  { value: "5", label: "Role Levels" },
  { value: "Splunk", label: "Enterprise Backend" },
];

function RocketIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-5"
    >
      <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
      <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
      <path d="M9 12H4l.5-2.5L9 8l3 4Z" />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-5"
    >
      <path d="M3 3v18h18" />
      <path d="m19 9-5 5-4-4-3 3" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-5"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function DollarIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-5"
    >
      <line x1="12" x2="12" y1="2" y2="22" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  );
}

function ReplayIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-5"
    >
      <polyline points="1 4 1 10 7 10" />
      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-5"
    >
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}
