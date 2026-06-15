"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import type { Session } from "@agentscope/auth";
import { Button } from "@agentscope/ui/button";
import { Input } from "@agentscope/ui/input";
import { Label } from "@agentscope/ui/label";

import { authClient } from "~/auth/client";

export function AuthShowcase({
  session: initialSession,
  compact = false,
}: {
  session: Session | null;
  compact?: boolean;
}) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(initialSession);
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Sync session from prop after server re-render (e.g. after sign-in)
  useEffect(() => {
    setSession(initialSession);
  }, [initialSession]);

  // Close popover on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Logged in — compact or full
  if (session) {
    if (compact) {
      return (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{session.user.name}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              await authClient.signOut();
              setSession(null);
              router.refresh();
            }}
          >
            Sign out
          </Button>
        </div>
      );
    }

    return (
      <div className="flex flex-col items-center justify-center gap-4">
        <p className="text-center text-2xl">
          <span>Logged in as {session.user.name}</span>
        </p>
        <Button
          size="lg"
          onClick={async () => {
            await authClient.signOut();
            setSession(null);
            router.refresh();
          }}
        >
          Sign out
        </Button>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (mode === "signup") {
      const { data: _data, error: signUpError } = await authClient.signUp.email(
        {
          email,
          password,
          name,
        },
      );

      if (signUpError) {
        setError(signUpError.message ?? "Sign up failed");
        return;
      }

      setOpen(false);
      router.refresh();
    } else {
      const { data: _data, error: signInError } = await authClient.signIn.email(
        {
          email,
          password,
        },
      );

      if (signInError) {
        setError(signInError.message ?? "Sign in failed");
        return;
      }

      setOpen(false);
      router.refresh();
    }
  }

  // Compact mode: button + popover
  if (compact) {
    return (
      <div className="relative" ref={popoverRef}>
        <Button variant="default" size="sm" onClick={() => setOpen(!open)}>
          Sign In
        </Button>
        {open && (
          <div className="bg-popover border-border absolute top-full right-0 z-50 mt-2 w-72 rounded-lg border p-4 shadow-lg">
            <div className="mb-3 flex gap-1">
              <Button
                variant={mode === "login" ? "default" : "ghost"}
                size="sm"
                className="flex-1"
                onClick={() => {
                  setMode("login");
                  setError(null);
                }}
              >
                Sign In
              </Button>
              <Button
                variant={mode === "signup" ? "default" : "ghost"}
                size="sm"
                className="flex-1"
                onClick={() => {
                  setMode("signup");
                  setError(null);
                }}
              >
                Sign Up
              </Button>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
              {mode === "signup" && (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="compact-name">Name</Label>
                  <Input
                    id="compact-name"
                    type="text"
                    placeholder="Your name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="compact-email">Email</Label>
                <Input
                  id="compact-email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="compact-password">Password</Label>
                <Input
                  id="compact-password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                />
              </div>

              {error && <p className="text-destructive text-sm">{error}</p>}

              <Button type="submit" size="sm" className="w-full">
                {mode === "signup" ? "Create Account" : "Sign In"}
              </Button>
            </form>
          </div>
        )}
      </div>
    );
  }

  // Full (non-compact) mode — standalone page/form
  return (
    <div className="flex w-full max-w-sm flex-col gap-6">
      <div className="flex gap-2">
        <Button
          variant={mode === "login" ? "default" : "outline"}
          className="flex-1"
          onClick={() => {
            setMode("login");
            setError(null);
          }}
        >
          Sign In
        </Button>
        <Button
          variant={mode === "signup" ? "default" : "outline"}
          className="flex-1"
          onClick={() => {
            setMode("signup");
            setError(null);
          }}
        >
          Sign Up
        </Button>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {mode === "signup" && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              type="text"
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
        )}

        <div className="flex flex-col gap-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
        </div>

        {error && <p className="text-destructive text-sm">{error}</p>}

        <Button type="submit" size="lg" className="w-full">
          {mode === "signup" ? "Create Account" : "Sign In"}
        </Button>
      </form>
    </div>
  );
}
