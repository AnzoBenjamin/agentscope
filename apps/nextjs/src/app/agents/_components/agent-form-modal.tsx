"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";

import { Button } from "@agentscope/ui/button";
import { Input } from "@agentscope/ui/input";
import { toast } from "@agentscope/ui/toast";

import { useTRPC } from "~/trpc/react";

interface AgentLike {
  id: string;
  name: string;
  description: string | null;
  type: string;
  modelProvider: string;
  modelName: string;
  baseUrl: string | null;
  costPer1kTokens: number | null;
  systemPrompt: string | null;
  requiresApproval: boolean | null;
  hasApiKey?: boolean | null;
  status: string;
}

interface AgentFormModalProps {
  open: boolean;
  onClose: () => void;
  /** Pass an existing agent to enter edit mode, or null to create. */
  agent: AgentLike | null;
  onSaved: () => void;
}

const AGENT_TYPES = [
  "Research",
  "Reliability",
  "CostAnalyst",
  "Security",
  "Custom",
] as const;

type AgentType = (typeof AGENT_TYPES)[number];

const PRESET_PROVIDERS = [
  { value: "OpenAI", label: "OpenAI", needsBaseUrl: false },
  { value: "Anthropic", label: "Anthropic", needsBaseUrl: false },
  { value: "Gemini", label: "Google Gemini", needsBaseUrl: false },
  { value: "OpenAICompatible", label: "Custom (OpenAI-compatible)", needsBaseUrl: true },
] as const;

type PresetProvider = (typeof PRESET_PROVIDERS)[number]["value"];

const PRESET_MODELS: Record<string, string[]> = {
  OpenAI: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini", "o3-mini"],
  Anthropic: [
    "claude-sonnet-4-20250514",
    "claude-opus-4-20250514",
    "claude-3-5-haiku-latest",
  ],
  Gemini: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash"],
  OpenAICompatible: [],
};

function resolveProviderPreset(agent: AgentLike | null): PresetProvider {
  if (!agent) return "OpenAI";
  const matchesPreset = PRESET_PROVIDERS.find(
    (p) =>
      p.value === agent.modelProvider ||
      (p.value === "OpenAICompatible" && agent.baseUrl !== null),
  );
  return matchesPreset ? matchesPreset.value : "OpenAICompatible";
}

function resolveType(agent: AgentLike | null): AgentType {
  if (!agent) return "Research";
  return (AGENT_TYPES as readonly string[]).includes(agent.type)
    ? (agent.type as AgentType)
    : "Custom";
}

export function AgentFormModal({
  open,
  onClose,
  agent,
  onSaved,
}: AgentFormModalProps) {
  if (!open) return null;
  // Keying the form on (agent?.id ?? "new") remounts it whenever a different
  // agent is opened, so each form starts with a fresh useState initializer
  // driven by the incoming agent prop. This avoids the set-state-in-effect
  // anti-pattern.
  return (
    <AgentForm
      key={agent?.id ?? "new"}
      agent={agent}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}

interface AgentFormProps {
  agent: AgentLike | null;
  onClose: () => void;
  onSaved: () => void;
}

function AgentForm({ agent, onClose, onSaved }: AgentFormProps) {
  const trpc = useTRPC();
  const isEdit = agent !== null;

  const [name, setName] = useState(agent?.name ?? "");
  const [description, setDescription] = useState(agent?.description ?? "");
  const [type, setType] = useState<AgentType>(resolveType(agent));
  const [providerPreset, setProviderPreset] = useState<PresetProvider>(
    resolveProviderPreset(agent),
  );
  const [modelName, setModelName] = useState(agent?.modelName ?? "gpt-4o");
  const [baseUrl, setBaseUrl] = useState(agent?.baseUrl ?? "");
  const [apiKey, setApiKey] = useState("");
  const [clearApiKey, setClearApiKey] = useState(false);
  const [costPer1kTokens, setCostPer1kTokens] = useState(
    typeof agent?.costPer1kTokens === "number"
      ? String(agent.costPer1kTokens)
      : "0.03",
  );
  const [systemPrompt, setSystemPrompt] = useState(agent?.systemPrompt ?? "");
  const [requiresApproval, setRequiresApproval] = useState(
    agent?.requiresApproval ?? false,
  );
  const [status, setStatus] = useState(agent?.status ?? "Active");

  const createAgent = useMutation(
    trpc.agent.create.mutationOptions({
      onSuccess: () => {
        toast.success("Agent created.");
        onSaved();
        onClose();
      },
      onError: (err) => {
        toast.error(err.message);
      },
    }),
  );

  const updateAgent = useMutation(
    trpc.agent.update.mutationOptions({
      onSuccess: () => {
        toast.success("Agent updated.");
        onSaved();
        onClose();
      },
      onError: (err) => {
        toast.error(err.message);
      },
    }),
  );

  const submitting = createAgent.isPending || updateAgent.isPending;

  const presetModels = PRESET_MODELS[providerPreset] ?? [];
  const providerNeedsBaseUrl =
    PRESET_PROVIDERS.find((p) => p.value === providerPreset)?.needsBaseUrl ??
    false;
  const resolvedModelProvider = providerPreset;

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim()) {
      toast.error("Name is required.");
      return;
    }
    if (providerNeedsBaseUrl && !baseUrl.trim()) {
      toast.error("A base URL is required for custom providers.");
      return;
    }
    const cost = Number.parseFloat(costPer1kTokens);
    if (Number.isNaN(cost) || cost < 0) {
      toast.error("Cost per 1k tokens must be a non-negative number.");
      return;
    }

    if (isEdit) {
      const updateInput: {
        id: string;
        name: string;
        description?: string;
        type: AgentType;
        modelProvider: PresetProvider;
        modelName: string;
        systemPrompt?: string;
        requiresApproval: boolean;
        status: string;
        costPer1kTokens: number;
        baseUrl?: string | null;
        apiKey?: string;
        clearApiKey?: boolean;
      } = {
        id: agent.id,
        name: name.trim(),
        description: description.trim() || undefined,
        type,
        modelProvider: resolvedModelProvider,
        modelName: modelName.trim(),
        systemPrompt: systemPrompt.trim() || undefined,
        requiresApproval,
        status,
        costPer1kTokens: cost,
      };
      if (providerNeedsBaseUrl) {
        updateInput.baseUrl = baseUrl.trim() || null;
      } else {
        updateInput.baseUrl = null;
      }
      if (clearApiKey) {
        updateInput.clearApiKey = true;
      } else if (apiKey.trim()) {
        updateInput.apiKey = apiKey.trim();
      }
      updateAgent.mutate(updateInput);
      return;
    }

    const createInput: {
      name: string;
      description?: string;
      type: AgentType;
      modelProvider: PresetProvider;
      modelName: string;
      systemPrompt?: string;
      requiresApproval: boolean;
      costPer1kTokens: number;
      baseUrl?: string;
      apiKey?: string;
    } = {
      name: name.trim(),
      description: description.trim() || undefined,
      type,
      modelProvider: resolvedModelProvider,
      modelName: modelName.trim(),
      systemPrompt: systemPrompt.trim() || undefined,
      requiresApproval,
      costPer1kTokens: cost,
    };
    if (providerNeedsBaseUrl && baseUrl.trim()) {
      createInput.baseUrl = baseUrl.trim();
    }
    if (apiKey.trim()) {
      createInput.apiKey = apiKey.trim();
    }
    createAgent.mutate(createInput);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? "Edit agent" : "Create agent"}
        className="bg-card border-border max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border shadow-2xl"
      >
        <form onSubmit={handleSubmit} className="space-y-5 p-6">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-xl font-semibold">
                {isEdit ? "Edit agent" : "Create agent"}
              </h2>
              <p className="text-muted-foreground mt-1 text-sm">
                {isEdit
                  ? "Update this AI employee. Provider changes create a new version."
                  : "Deploy a new AI employee. Use a custom OpenAI-compatible base URL to route through TokenRouter, OpenRouter, or self-hosted gateways."}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground -mr-2 -mt-1 rounded-md p-2 text-sm"
              aria-label="Close"
            >
              ✕
            </button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" required>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Research Agent"
                maxLength={256}
                required
              />
            </Field>
            <Field label="Type">
              <select
                value={type}
                onChange={(e) => setType(e.target.value as AgentType)}
                className="bg-background border-border h-10 w-full rounded-md border px-3 text-sm"
              >
                {AGENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Description" hint="Shown in the dashboard agent card.">
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this agent do?"
              maxLength={1024}
            />
          </Field>

          <div className="border-border/60 space-y-4 rounded-lg border p-4">
            <div>
              <h3 className="text-sm font-semibold">Model Provider</h3>
              <p className="text-muted-foreground mt-1 text-xs">
                Pick a managed provider, or use Custom to point at any
                OpenAI-compatible endpoint (TokenRouter, OpenRouter, LiteLLM,
                Ollama, vLLM, etc.).
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Provider">
                <select
                  value={providerPreset}
                  onChange={(e) => {
                    const next = e.target.value as PresetProvider;
                    setProviderPreset(next);
                    const defaults = PRESET_MODELS[next] ?? [];
                    const firstDefault = defaults[0];
                    if (firstDefault) {
                      setModelName(firstDefault);
                    }
                    if (next !== "OpenAICompatible") {
                      setBaseUrl("");
                    }
                  }}
                  className="bg-background border-border h-10 w-full rounded-md border px-3 text-sm"
                >
                  {PRESET_PROVIDERS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label="Model"
                hint={
                  providerPreset === "OpenAICompatible"
                    ? "Enter any model ID exposed by the gateway."
                    : "Pick a preset or type a custom model name."
                }
              >
                {providerPreset !== "OpenAICompatible" &&
                presetModels.length > 0 ? (
                  <div className="flex gap-2">
                    <select
                      value={
                        presetModels.includes(modelName) ? modelName : "__custom"
                      }
                      onChange={(e) => {
                        if (e.target.value !== "__custom") {
                          setModelName(e.target.value);
                        }
                      }}
                      className="bg-background border-border h-10 w-full rounded-md border px-3 text-sm"
                    >
                      {presetModels.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                      <option value="__custom">Custom...</option>
                    </select>
                    {!presetModels.includes(modelName) && (
                      <Input
                        value={modelName}
                        onChange={(e) => setModelName(e.target.value)}
                        placeholder="model-id"
                      />
                    )}
                  </div>
                ) : (
                  <Input
                    value={modelName}
                    onChange={(e) => setModelName(e.target.value)}
                    placeholder={
                      providerPreset === "OpenAICompatible"
                        ? "anthropic/claude-opus-4.6"
                        : "model-id"
                    }
                  />
                )}
              </Field>
            </div>

            {providerNeedsBaseUrl && (
              <>
                <Field
                  label="API Base URL"
                  required
                  hint="The OpenAI-compatible endpoint exposed by your gateway."
                >
                  <Input
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder="https://api.tokenrouter.com/v1"
                    type="url"
                  />
                </Field>
                <Field
                  label="API Key"
                  hint={
                    isEdit && agent.hasApiKey && !clearApiKey
                      ? "A key is already configured. Leave blank to keep it, or set a new value to replace it."
                      : "Stored AES-256-GCM encrypted. Never logged."
                  }
                >
                  <Input
                    value={apiKey}
                    onChange={(e) => {
                      setApiKey(e.target.value);
                      if (e.target.value.length > 0) setClearApiKey(false);
                    }}
                    placeholder="sk-..."
                    type="password"
                    autoComplete="off"
                  />
                </Field>
                {isEdit && agent.hasApiKey && (
                  <label className="text-muted-foreground flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={clearApiKey}
                      onChange={(e) => {
                        setClearApiKey(e.target.checked);
                        if (e.target.checked) setApiKey("");
                      }}
                    />
                    Remove the stored API key
                  </label>
                )}
              </>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Cost per 1k tokens (USD)"
              hint="Used for cost ledger attribution. Custom providers should set this explicitly."
            >
              <Input
                value={costPer1kTokens}
                onChange={(e) => setCostPer1kTokens(e.target.value)}
                type="number"
                min="0"
                step="0.001"
              />
            </Field>
            <Field label="Status">
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="bg-background border-border h-10 w-full rounded-md border px-3 text-sm"
              >
                <option value="Active">Active</option>
                <option value="Paused">Paused</option>
                <option value="Disabled">Disabled</option>
              </select>
            </Field>
          </div>

          <Field
            label="System Prompt"
            hint="Guides the agent's behavior. Leave blank for the default."
          >
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={4}
              maxLength={10_000}
              className="bg-background border-border w-full rounded-md border p-3 text-sm"
            />
          </Field>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={requiresApproval}
              onChange={(e) => setRequiresApproval(e.target.checked)}
            />
            Require human approval before each run
          </label>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting
                ? isEdit
                  ? "Saving..."
                  : "Creating..."
                : isEdit
                  ? "Save changes"
                  : "Create agent"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">
        {label}
        {required && <span className="text-destructive ml-1">*</span>}
      </span>
      {children}
      {hint && <span className="text-muted-foreground block text-xs">{hint}</span>}
    </label>
  );
}
