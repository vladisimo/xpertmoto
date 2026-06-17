"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BrandLogo } from "@/components/shared/brand-logo";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

function VerifyEmailInner() {
  const token = useSearchParams().get("token") ?? "";
  const verify = trpc.auth.verifyEmail.useMutation();
  const resend = trpc.auth.resendVerification.useMutation();

  const [status, setStatus] = useState<"verifying" | "success" | "error">(
    token ? "verifying" : "error",
  );
  const [error, setError] = useState<string | null>(
    token ? null : "This link is missing its token.",
  );
  const [resendEmail, setResendEmail] = useState("");
  const [resent, setResent] = useState(false);
  const ran = useRef(false);

  useEffect(() => {
    // Single-use token: guard against React StrictMode's double effect, whose
    // second call would find the token already burned and flip success→error.
    if (!token || ran.current) return;
    ran.current = true;
    verify
      .mutateAsync({ token })
      .then(() => setStatus("success"))
      .catch((e) => {
        setStatus("error");
        setError(e instanceof Error ? e.message : "Verification failed");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (status === "verifying") {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Confirming your email…</CardTitle>
          <CardDescription>One moment while we verify your link.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (status === "success") {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Email confirmed</CardTitle>
          <CardDescription>
            Thanks — your email is verified. You can now book a hire.
          </CardDescription>
        </CardHeader>
        <CardFooter className="flex flex-col gap-2">
          <Button asChild className="w-full">
            <Link href="/dashboard">Continue to your account</Link>
          </Button>
          <Button asChild variant="secondary" className="w-full">
            <Link href="/booking">Start a booking</Link>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Link not valid</CardTitle>
        <CardDescription>
          {error ?? "This confirmation link is invalid or has expired."} Enter
          your email below and we&apos;ll send a fresh confirmation link.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {resent ? (
          <p className="text-sm text-muted-foreground">
            If that address has an unconfirmed account, a new confirmation link
            is on its way. Check your inbox (and spam).
          </p>
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await resend.mutateAsync({ email: resendEmail }).catch(() => undefined);
              setResent(true);
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="resend-email">Email</Label>
              <Input
                id="resend-email"
                type="email"
                autoComplete="email"
                required
                value={resendEmail}
                onChange={(e) => setResendEmail(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full" disabled={resend.isPending}>
              {resend.isPending ? "Sending…" : "Resend confirmation link"}
            </Button>
          </form>
        )}
      </CardContent>
      <CardFooter>
        <Button asChild variant="ghost" className="w-full">
          <Link href="/login">Back to sign in</Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

export default function VerifyEmailPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-6 p-4">
      <BrandLogo height={36} />
      <Suspense fallback={null}>
        <VerifyEmailInner />
      </Suspense>
    </div>
  );
}
