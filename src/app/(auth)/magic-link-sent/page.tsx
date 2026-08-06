import { Suspense } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { BrandLogo } from "@/components/shared/brand-logo";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type SearchParams = { email?: string | string[] };

// Sync page + async child behind Suspense: only the "sent to <email>" line
// depends on searchParams, so the rest of the card stays prerenderable and
// prefetch/navigation validation never sees an unfenced runtime read.
export default function MagicLinkSentPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-6 p-4">
      <BrandLogo height={36} />
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Check your inbox</CardTitle>
          <CardDescription>
            <Suspense fallback={<GenericSentLine />}>
              <SentLine searchParams={searchParams} />
            </Suspense>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            Click the button in the email to sign in. If you don&apos;t see it
            after a minute or two, check your spam folder.
          </p>
          <p>
            If you don&apos;t receive the email, the address may not have an
            account yet — you&apos;ll need to register first.
          </p>
        </CardContent>
        <CardFooter className="flex flex-col gap-2">
          <Button asChild variant="secondary" className="w-full">
            <Link href="/login">Back to sign in</Link>
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

function GenericSentLine() {
  return <>We sent you a sign-in link. It expires in 15 minutes.</>;
}

async function SentLine({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { email } = await searchParams;
  const target = Array.isArray(email) ? email[0] : email;
  if (!target) return <GenericSentLine />;
  return (
    <>
      We sent a sign-in link to <strong>{target}</strong>. The link expires in
      15 minutes.
    </>
  );
}
