"use client";

import { useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { Button } from "@agentscope/ui/button";
import { Input } from "@agentscope/ui/input";
import { toast } from "@agentscope/ui/toast";

import { useTRPC } from "~/trpc/react";

// Server-side enum is `z.enum(IDENTITY_PROVIDER_TYPES) = ["SAML", "OIDC"]`.
// Any other value would be rejected at validation time. Keep this in sync
// with packages/db/src/schema.ts.
const IDP_TYPES = ["SAML", "OIDC"] as const;
type IdpType = (typeof IDP_TYPES)[number];

interface IdpForm {
  id?: string;
  type: IdpType;
  name: string;
  issuer: string;
  ssoUrl: string;
  clientId: string;
  enabled: boolean;
}

const blankIdp: IdpForm = {
  type: "SAML",
  name: "",
  issuer: "",
  ssoUrl: "",
  clientId: "",
  enabled: false,
};

export function SecurityContent() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { data: policy } = useQuery(trpc.security.policy.queryOptions());
  const { data: apiKeys = [] } = useQuery(
    trpc.security.apiKeys.queryOptions(),
  );
  const { data: scimTokens = [] } = useQuery(
    trpc.security.scimTokens.queryOptions(),
  );
  const { data: idps = [] } = useQuery(
    trpc.security.identityProviders.queryOptions(),
  );

  // API key creation returns the plaintext secret once. We display it in a
  // dialog so the user can copy it before dismissing. After dismissal the
  // secret is gone forever.
  const [apiKeySecret, setApiKeySecret] = useState<string | null>(null);
  const [apiKeyName, setApiKeyName] = useState("");
  const [apiKeyScopes, setApiKeyScopes] = useState("");
  const [creatingApiKey, setCreatingApiKey] = useState(false);

  const [scimSecret, setScimSecret] = useState<string | null>(null);
  const [creatingScim, setCreatingScim] = useState(false);

  const [idpForm, setIdpForm] = useState<IdpForm>(blankIdp);
  const [idpEditing, setIdpEditing] = useState(false);
  const [idpTesting, setIdpTesting] = useState(false);

  // Policy form mirrors the loaded policy. We commit on Save.
  const [policyForm, setPolicyForm] = useState<{
    apiKeysEnabled: boolean;
    ssoRequired: boolean;
    scimRequired: boolean;
    defaultRateLimitPerMinute: string;
    allowedEmailDomains: string;
    sessionTtlMinutes: string;
  } | null>(null);

  if (policy && policyForm === null) {
    // `allowedEmailDomains` is stored as `jsonb` in the schema, so drizzle
    // returns `unknown`. The server only writes string arrays, so we
    // narrow at the consumption point.
    const domains = Array.isArray(policy.allowedEmailDomains)
      ? (policy.allowedEmailDomains as string[])
      : [];
    setPolicyForm({
      apiKeysEnabled: policy.apiKeysEnabled,
      ssoRequired: policy.ssoRequired,
      scimRequired: policy.scimRequired,
      defaultRateLimitPerMinute: String(policy.defaultRateLimitPerMinute),
      allowedEmailDomains: domains.join(", "),
      sessionTtlMinutes: String(policy.sessionTtlMinutes),
    });
  }

  const updatePolicy = useMutation(
    trpc.security.updatePolicy.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries(trpc.security.pathFilter());
        toast.success("Security policy updated");
      },
      onError: (e) => toast.error(e.message),
    }),
  );

  const createApiKey = useMutation(
    trpc.security.createApiKey.mutationOptions({
      onSuccess: (data) => {
        setApiKeySecret(data.secret);
        setApiKeyName("");
        setCreatingApiKey(false);
        void queryClient.invalidateQueries(trpc.security.pathFilter());
      },
      onError: (e) => toast.error(e.message),
    }),
  );

  const revokeApiKey = useMutation(
    trpc.security.revokeApiKey.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries(trpc.security.pathFilter());
        toast.success("API key revoked");
      },
      onError: (e) => toast.error(e.message),
    }),
  );

  const createScim = useMutation(
    trpc.security.createScimToken.mutationOptions({
      onSuccess: (data) => {
        setScimSecret(data.secret);
        setCreatingScim(false);
        void queryClient.invalidateQueries(trpc.security.pathFilter());
      },
      onError: (e) => toast.error(e.message),
    }),
  );

  const revokeScim = useMutation(
    trpc.security.revokeScimToken.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries(trpc.security.pathFilter());
        toast.success("SCIM token revoked");
      },
      onError: (e) => toast.error(e.message),
    }),
  );

  const upsertIdp = useMutation(
    trpc.security.upsertIdentityProvider.mutationOptions({
      onSuccess: async () => {
        setIdpEditing(false);
        setIdpForm(blankIdp);
        await queryClient.invalidateQueries(trpc.security.pathFilter());
        toast.success("Identity provider saved");
      },
      onError: (e) => toast.error(e.message),
    }),
  );

  return (
    <div className="container mx-auto space-y-8 px-4 py-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Security</h1>
        <p className="text-muted-foreground mt-1">
          Authentication, API access, SCIM provisioning, and SSO identity
          providers.
        </p>
      </div>

      {/* Security Policy */}
      <section className="bg-card border-border rounded-xl border p-6">
        <h2 className="text-lg font-semibold">Security Policy</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Controls API key issuance, SSO/SCIM enforcement, session TTL, and
          rate limits.
        </p>
        {policyForm && (
          <form
            className="mt-5 grid gap-4 md:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              updatePolicy.mutate({
                apiKeysEnabled: policyForm.apiKeysEnabled,
                ssoRequired: policyForm.ssoRequired,
                scimRequired: policyForm.scimRequired,
                defaultRateLimitPerMinute: Number.parseInt(
                  policyForm.defaultRateLimitPerMinute,
                  10,
                ),
                allowedEmailDomains: policyForm.allowedEmailDomains
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
                sessionTtlMinutes: Number.parseInt(
                  policyForm.sessionTtlMinutes,
                  10,
                ),
              });
            }}
          >
            <ToggleRow
              label="API keys enabled"
              value={policyForm.apiKeysEnabled}
              onChange={(v) =>
                setPolicyForm({ ...policyForm, apiKeysEnabled: v })
              }
            />
            <ToggleRow
              label="SSO required"
              value={policyForm.ssoRequired}
              onChange={(v) =>
                setPolicyForm({ ...policyForm, ssoRequired: v })
              }
            />
            <ToggleRow
              label="SCIM required"
              value={policyForm.scimRequired}
              onChange={(v) =>
                setPolicyForm({ ...policyForm, scimRequired: v })
              }
            />
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">
                Default rate limit (req/min)
              </span>
              <Input
                type="number"
                min={10}
                max={10000}
                value={policyForm.defaultRateLimitPerMinute}
                onChange={(e) =>
                  setPolicyForm({
                    ...policyForm,
                    defaultRateLimitPerMinute: e.target.value,
                  })
                }
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">
                Session TTL (minutes)
              </span>
              <Input
                type="number"
                min={15}
                max={43200}
                value={policyForm.sessionTtlMinutes}
                onChange={(e) =>
                  setPolicyForm({
                    ...policyForm,
                    sessionTtlMinutes: e.target.value,
                  })
                }
              />
            </label>
            <label className="md:col-span-2 block space-y-1.5">
              <span className="text-sm font-medium">
                Allowed email domains (comma-separated)
              </span>
              <Input
                value={policyForm.allowedEmailDomains}
                onChange={(e) =>
                  setPolicyForm({
                    ...policyForm,
                    allowedEmailDomains: e.target.value,
                  })
                }
                placeholder="example.com, partner.com"
              />
            </label>
            <div className="md:col-span-2 flex justify-end">
              <Button type="submit" disabled={updatePolicy.isPending}>
                {updatePolicy.isPending ? "Saving..." : "Save policy"}
              </Button>
            </div>
          </form>
        )}
      </section>

      {/* API Keys */}
      <section className="bg-card border-border rounded-xl border p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">API Keys</h2>
          <Button
            variant="outline"
            size="sm"
            disabled={!policy?.apiKeysEnabled}
            onClick={() => setCreatingApiKey(!creatingApiKey)}
          >
            {creatingApiKey ? "Cancel" : "+ New key"}
          </Button>
        </div>
        {!policy?.apiKeysEnabled && (
          <p className="text-muted-foreground mt-2 text-xs">
            API keys are disabled by policy. Enable them above to create a
            new key.
          </p>
        )}
        {creatingApiKey && (
          <>
            <form
              className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end"
              onSubmit={(e) => {
                e.preventDefault();
                if (!apiKeyName.trim()) return;
                const scopes = apiKeyScopes
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean);
                createApiKey.mutate({
                  name: apiKeyName.trim(),
                  scopes,
                });
              }}
            >
              <label className="flex-1 space-y-1.5">
                <span className="text-sm font-medium">Key name</span>
                <Input
                  value={apiKeyName}
                  onChange={(e) => setApiKeyName(e.target.value)}
                  placeholder="CI runner"
                  maxLength={256}
                  required
                />
              </label>
              <label className="flex-1 space-y-1.5">
                <span className="text-sm font-medium">
                  Scopes (comma-separated, optional)
                </span>
                <Input
                  value={apiKeyScopes}
                  onChange={(e) => setApiKeyScopes(e.target.value)}
                  placeholder="agent:read, agent:enqueue, alert:read"
                  maxLength={1000}
                />
              </label>
              <Button type="submit" disabled={createApiKey.isPending}>
                {createApiKey.isPending ? "Creating..." : "Create"}
              </Button>
            </form>
            <p className="text-muted-foreground mt-2 text-xs">
              Scopes limit what this key can do. Leave empty for a full-access
              key. Common scopes:{" "}
              <code className="text-xs">agent:read</code>,{" "}
              <code className="text-xs">agent:enqueue</code>,{" "}
              <code className="text-xs">alert:read</code>,{" "}
              <code className="text-xs">export:read</code>. The server
              enforces scopes on every request — the key is useless without
              the right ones.
            </p>
          </>
        )}
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[480px] text-left text-sm">
            <thead className="text-muted-foreground border-border border-b text-xs">
              <tr>
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">Prefix</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Last used</th>
                <th className="py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {apiKeys.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="text-muted-foreground py-6 text-center"
                  >
                    No API keys yet.
                  </td>
                </tr>
              ) : (
                apiKeys.map((k) => (
                  <tr key={k.id} className="border-border/60 border-b">
                    <td className="py-3 pr-4 font-medium">{k.name}</td>
                    <td className="text-muted-foreground py-3 pr-4 font-mono text-xs">
                      {k.prefix}…
                    </td>
                    <td className="py-3 pr-4">{k.status}</td>
                    <td className="text-muted-foreground py-3 pr-4">
                      {k.lastUsedAt
                        ? new Date(k.lastUsedAt).toLocaleDateString()
                        : "Never"}
                    </td>
                    <td className="py-3">
                      {k.status === "Active" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() =>
                            revokeApiKey.mutate({ id: k.id })
                          }
                        >
                          Revoke
                        </Button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* SCIM Tokens */}
      <section className="bg-card border-border rounded-xl border p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">SCIM Provisioning Tokens</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCreatingScim(!creatingScim)}
          >
            {creatingScim ? "Cancel" : "+ New token"}
          </Button>
        </div>
        <p className="text-muted-foreground mt-1 text-sm">
          Use these to provision users/groups from your IdP via SCIM v2.
        </p>
        {creatingScim && (
          <form
            className="mt-4 flex justify-end"
            onSubmit={(e) => {
              e.preventDefault();
              createScim.mutate(undefined);
            }}
          >
            <Button type="submit" disabled={createScim.isPending}>
              {createScim.isPending ? "Creating..." : "Generate token"}
            </Button>
          </form>
        )}
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[420px] text-left text-sm">
            <thead className="text-muted-foreground border-border border-b text-xs">
              <tr>
                <th className="py-2 pr-4">Prefix</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Last used</th>
                <th className="py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {scimTokens.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="text-muted-foreground py-6 text-center"
                  >
                    No SCIM tokens yet.
                  </td>
                </tr>
              ) : (
                scimTokens.map((t) => (
                  <tr key={t.id} className="border-border/60 border-b">
                    <td className="text-muted-foreground py-3 pr-4 font-mono text-xs">
                      {t.prefix}…
                    </td>
                    <td className="py-3 pr-4">{t.status}</td>
                    <td className="text-muted-foreground py-3 pr-4">
                      {t.lastUsedAt
                        ? new Date(t.lastUsedAt).toLocaleDateString()
                        : "Never"}
                    </td>
                    <td className="py-3">
                      {t.status === "Active" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => revokeScim.mutate({ id: t.id })}
                        >
                          Revoke
                        </Button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Identity Providers */}
      <section className="bg-card border-border rounded-xl border p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Identity Providers</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setIdpForm(blankIdp);
              setIdpEditing(!idpEditing);
            }}
          >
            {idpEditing ? "Cancel" : "+ New IdP"}
          </Button>
        </div>
        {idpEditing && (
          <form
            className="mt-4 grid gap-4 md:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              upsertIdp.mutate({
                id: idpForm.id,
                type: idpForm.type,
                name: idpForm.name,
                issuer: idpForm.issuer,
                ssoUrl: idpForm.ssoUrl || undefined,
                clientId: idpForm.clientId || undefined,
                enabled: idpForm.enabled,
              });
            }}
          >
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">Type</span>
              <select
                value={idpForm.type}
                onChange={(e) =>
                  setIdpForm({
                    ...idpForm,
                    type: e.target.value as IdpType,
                  })
                }
                className="bg-background border-border h-10 w-full rounded-md border px-3 text-sm"
              >
                {IDP_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">Display name</span>
              <Input
                value={idpForm.name}
                onChange={(e) =>
                  setIdpForm({ ...idpForm, name: e.target.value })
                }
                maxLength={256}
                required
              />
            </label>
            <label className="md:col-span-2 block space-y-1.5">
              <span className="text-sm font-medium">Issuer URL</span>
              <Input
                value={idpForm.issuer}
                onChange={(e) =>
                  setIdpForm({ ...idpForm, issuer: e.target.value })
                }
                required
                placeholder="https://idp.example.com"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">SSO URL (optional)</span>
              <Input
                value={idpForm.ssoUrl}
                onChange={(e) =>
                  setIdpForm({ ...idpForm, ssoUrl: e.target.value })
                }
                placeholder="https://idp.example.com/sso"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">Client ID (optional)</span>
              <Input
                value={idpForm.clientId}
                onChange={(e) =>
                  setIdpForm({ ...idpForm, clientId: e.target.value })
                }
              />
            </label>
            <label className="md:col-span-2 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={idpForm.enabled}
                onChange={(e) =>
                  setIdpForm({ ...idpForm, enabled: e.target.checked })
                }
              />
              Enabled
            </label>
            <div className="md:col-span-2 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={!idpForm.issuer || idpTesting}
                onClick={async () => {
                  setIdpTesting(true);
                  try {
                    // For OIDC, try the well-known config; for SAML, try
                    // the metadata endpoint at the issuer. We just need to
                    // confirm the URL is reachable and returns a 2xx/3xx
                    // (or a 4xx that indicates the endpoint exists).
                    const target =
                      idpForm.type === "OIDC"
                        ? `${idpForm.issuer.replace(/\/$/, "")}/.well-known/openid-configuration`
                        : idpForm.ssoUrl || idpForm.issuer;
                    const res = await fetch(target, {
                      method: "GET",
                      signal: AbortSignal.timeout(8000),
                    });
                    if (res.ok || (res.status >= 300 && res.status < 500)) {
                      toast.success(
                        `IdP reachable (HTTP ${res.status}) — verify the response matches your IdP docs.`,
                      );
                    } else {
                      toast.error(
                        `IdP returned HTTP ${res.status}. Check the URL and credentials.`,
                      );
                    }
                  } catch (err) {
                    toast.error(
                      `Test failed: ${err instanceof Error ? err.message : String(err)}`,
                    );
                  } finally {
                    setIdpTesting(false);
                  }
                }}
              >
                {idpTesting ? "Testing..." : "Test connection"}
              </Button>
              <Button type="submit" disabled={upsertIdp.isPending}>
                {upsertIdp.isPending ? "Saving..." : "Save IdP"}
              </Button>
            </div>
          </form>
        )}
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead className="text-muted-foreground border-border border-b text-xs">
              <tr>
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">Type</th>
                <th className="py-2 pr-4">Issuer</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {idps.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="text-muted-foreground py-6 text-center"
                  >
                    No identity providers configured.
                  </td>
                </tr>
              ) : (
                idps.map((idp) => (
                  <tr key={idp.id} className="border-border/60 border-b">
                    <td className="py-3 pr-4 font-medium">{idp.name}</td>
                    <td className="py-3 pr-4">{idp.type}</td>
                    <td className="text-muted-foreground py-3 pr-4 text-xs">
                      {idp.issuer}
                    </td>
                    <td className="py-3 pr-4">
                      {idp.enabled ? "Enabled" : "Disabled"}
                    </td>
                    <td className="py-3">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setIdpForm({
                            id: idp.id,
                            type: (IDP_TYPES as readonly string[]).includes(
                              idp.type,
                            )
                              ? (idp.type as IdpType)
                              : "SAML",
                            name: idp.name,
                            issuer: idp.issuer,
                            ssoUrl: idp.ssoUrl ?? "",
                            clientId: idp.clientId ?? "",
                            enabled: idp.enabled,
                          });
                          setIdpEditing(true);
                        }}
                      >
                        Edit
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {apiKeySecret && (
        <SecretDialog
          title="API key created"
          description="Copy this secret now — it will not be shown again."
          secret={apiKeySecret}
          onClose={() => setApiKeySecret(null)}
        />
      )}
      {scimSecret && (
        <SecretDialog
          title="SCIM token created"
          description="Copy this token now — it will not be shown again."
          secret={scimSecret}
          onClose={() => setScimSecret(null)}
        />
      )}
    </div>
  );
}

function ToggleRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
      <span className="text-sm font-medium">{label}</span>
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

function SecretDialog({
  title,
  description,
  secret,
  onClose,
}: {
  title: string;
  description: string;
  secret: string;
  onClose: () => void;
}) {
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
        aria-label={title}
        className="bg-card border-border w-full max-w-lg rounded-xl border p-6 shadow-2xl"
      >
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-muted-foreground mt-1 text-sm">{description}</p>
        <pre className="bg-muted mt-4 overflow-x-auto rounded-md p-3 text-xs">
          <code>{secret}</code>
        </pre>
        <div className="mt-4 flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(secret);
                toast.success("Copied to clipboard");
              } catch {
                toast.error("Copy failed");
              }
            }}
          >
            Copy
          </Button>
          <Button type="button" onClick={onClose}>
            I've saved it
          </Button>
        </div>
      </div>
    </div>
  );
}
