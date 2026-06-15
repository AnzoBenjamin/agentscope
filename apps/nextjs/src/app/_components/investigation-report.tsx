"use client";

import { useState } from "react";

import { cn } from "@agentscope/ui";

import { Markdown } from "~/app/_components/markdown";
import {
  CheckCircleIcon,
  ChevronDownIcon,
  CodeIcon,
  CopyIcon,
  CheckCheckIcon,
  LightbulbIcon,
  RiskBadge,
  ShieldCheckIcon,
} from "~/app/_components/icons";

export interface InvestigationReportData {
  status: string;
  usedSplunkMcp: boolean;
  query: string;
  summary: string;
  findings: string[];
  riskLevel: string;
}

export function InvestigationReport({
  data,
  className,
  showHeader = true,
}: {
  data: InvestigationReportData;
  className?: string;
  showHeader?: boolean;
}) {
  const [queryOpen, setQueryOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const findings = data.findings;
  const hasSummary = data.summary && data.summary.trim().length > 0;
  const hasQuery = data.query && data.query.trim().length > 0;

  return (
    <div
      className={cn(
        "bg-card border-border overflow-hidden rounded-xl border shadow-sm",
        className,
      )}
    >
      {showHeader && (
        <div className="border-border flex flex-col gap-3 border-b p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-lg">
              <ShieldCheckIcon className="size-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold tracking-tight">
                Splunk MCP Investigation
              </h2>
              <p className="text-muted-foreground mt-0.5 text-xs">
                {data.usedSplunkMcp
                  ? "Produced from a live Splunk MCP query"
                  : "Investigator response"}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {data.status && (
              <span className="bg-muted text-muted-foreground inline-flex items-center rounded-full border border-border px-2.5 py-1 text-xs font-medium capitalize">
                {data.status}
              </span>
            )}
            <RiskBadge level={data.riskLevel} />
          </div>
        </div>
      )}

      {hasSummary && (
        <div className="border-border/60 border-b p-5">
          <div className="text-muted-foreground mb-2 flex items-center gap-1.5 text-[11px] font-medium tracking-wider uppercase">
            <LightbulbIcon className="size-3.5" />
            Summary
          </div>
          <div className="bg-muted/40 rounded-lg border border-border/60 p-4">
            <Markdown source={data.summary} />
          </div>
        </div>
      )}

      {findings.length > 0 && (
        <div className="border-border/60 border-b p-5">
          <div className="text-muted-foreground mb-3 flex items-center gap-1.5 text-[11px] font-medium tracking-wider uppercase">
            <CheckCircleIcon className="size-3.5" />
            Findings
            <span className="bg-muted text-muted-foreground ml-1 inline-flex items-center rounded-full border border-border px-1.5 py-0.5 text-[10px] font-semibold">
              {findings.length}
            </span>
          </div>
          <ul className="space-y-2">
            {findings.map((finding, idx) => (
              <li
                key={`${idx}-${finding.slice(0, 32)}`}
                className="flex items-start gap-3 rounded-lg border border-border/60 bg-background/50 p-3 text-sm leading-relaxed"
              >
                <span className="bg-primary/10 text-primary mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold">
                  {idx + 1}
                </span>
                <span className="text-foreground/90 flex-1">{finding}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {hasQuery && (
        <div className="p-5">
          <button
            type="button"
            onClick={() => setQueryOpen((open) => !open)}
            className="hover:bg-muted/60 text-muted-foreground hover:text-foreground -mx-1 inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 text-xs font-medium transition-colors"
            aria-expanded={queryOpen}
          >
            <CodeIcon className="size-3.5" />
            {queryOpen ? "Hide SPL query" : "Show SPL query"}
            <ChevronDownIcon
              className={cn(
                "size-3.5 transition-transform",
                queryOpen && "rotate-180",
              )}
            />
          </button>
          {queryOpen && (
            <div className="mt-3 overflow-hidden rounded-lg border border-border bg-zinc-950/[0.04] dark:bg-zinc-50/[0.04]">
              <div className="border-border bg-muted/40 flex items-center justify-between border-b px-3 py-1.5">
                <div className="text-muted-foreground flex items-center gap-1.5 text-[10px] font-medium tracking-wider uppercase">
                  <CodeIcon className="size-3" />
                  SPL
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(data.query);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    } catch {
                      // Clipboard unavailable — silently ignore.
                    }
                  }}
                  className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider transition-colors"
                  aria-label="Copy SPL query"
                >
                  {copied ? (
                    <>
                      <CheckCheckIcon className="size-3" /> Copied
                    </>
                  ) : (
                    <>
                      <CopyIcon className="size-3" /> Copy
                    </>
                  )}
                </button>
              </div>
              <pre className="m-0 max-h-72 overflow-x-auto p-3 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap">
                <code>{data.query}</code>
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
