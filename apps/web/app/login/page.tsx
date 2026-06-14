import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { EmailPasswordForm } from "@/components/auth/email-password-form";
import { sanitizeInternalRedirect } from "@/lib/redirect-safety";
import { getServerSession } from "@/lib/session/get-server-session";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your Open Agents workspace.",
};

interface LoginPageProps {
  searchParams: Promise<{ next?: string | string[] }>;
}

function getSingleSearchParam(
  value: string | string[] | undefined,
): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const callbackUrl = sanitizeInternalRedirect(
    getSingleSearchParam((await searchParams).next),
    "/sessions",
  );

  const session = await getServerSession();
  if (session?.user) {
    redirect(callbackUrl);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-white">
            Open Agents
          </h1>
          <p className="mt-2 text-sm text-zinc-400">
            Sign in with email and password.
          </p>
        </div>

        <EmailPasswordForm callbackUrl={callbackUrl} />

        <p className="mt-6 text-center text-xs text-zinc-500">
          <Link className="hover:text-zinc-300" href="/">
            Back to home
          </Link>
        </p>
      </div>
    </div>
  );
}
