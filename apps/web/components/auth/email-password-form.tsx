"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth/client";
import { sanitizeInternalRedirect } from "@/lib/redirect-safety";

type Mode = "sign-in" | "sign-up";

/** Derive a default username from an email local part for the sign-up form. */
function defaultUsernameFromEmail(email: string): string {
  const local = email.split("@", 1)[0] ?? "";
  return local
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "");
}

export function EmailPasswordForm({ callbackUrl }: { callbackUrl?: string }) {
  const router = useRouter();
  const redirectPath = sanitizeInternalRedirect(callbackUrl, "/sessions");

  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [usernameEdited, setUsernameEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const isSignUp = mode === "sign-up";

  function handleEmailChange(value: string) {
    setEmail(value);
    if (isSignUp && !usernameEdited) {
      setUsername(defaultUsernameFromEmail(value));
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (isLoading) {
      return;
    }

    setError(null);
    setIsLoading(true);

    const result = isSignUp
      ? await authClient.signUp.email({
          email,
          password,
          name: username,
          username,
        })
      : await authClient.signIn.email({ email, password });

    if (result.error) {
      setError(result.error.message ?? "Something went wrong. Try again.");
      setIsLoading(false);
      return;
    }

    router.push(redirectPath);
    router.refresh();
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => handleEmailChange(e.target.value)}
          placeholder="you@example.com"
        />
      </div>

      {isSignUp && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="username">Username</Label>
          <Input
            id="username"
            type="text"
            autoComplete="username"
            required
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
              setUsernameEdited(true);
            }}
            placeholder="username"
          />
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          autoComplete={isSignUp ? "new-password" : "current-password"}
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="At least 8 characters"
        />
      </div>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <Button type="submit" disabled={isLoading} className="mt-1 gap-2">
        {isLoading && <Loader2 className="size-4 animate-spin" />}
        {isSignUp ? "Create account" : "Sign in"}
      </Button>

      <button
        type="button"
        className="text-sm text-muted-foreground hover:text-foreground"
        onClick={() => {
          setMode(isSignUp ? "sign-in" : "sign-up");
          setError(null);
        }}
      >
        {isSignUp
          ? "Already have an account? Sign in"
          : "Need an account? Create one"}
      </button>
    </form>
  );
}
