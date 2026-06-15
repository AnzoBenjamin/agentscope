"use client";

import { Component } from "react";
import Link from "next/link";

import { Button } from "@agentscope/ui/button";

export class AuthErrorBoundary extends Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="container mx-auto px-4 py-16">
          <div className="mx-auto max-w-md text-center">
            <h1 className="text-3xl font-bold tracking-tight">
              Sign In Required
            </h1>
            <p className="text-muted-foreground mt-4">
              The dashboard requires authentication. Sign in or create a free
              account to access your AI workforce analytics.
            </p>
            <div className="mt-8">
              <Button asChild>
                <Link href="/">Back to Home</Link>
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
