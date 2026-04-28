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

export default async function MagicLinkSentPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { email } = await searchParams;
  const target = Array.isArray(email) ? email[0] : email;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-6 p-4">
      <BrandLogo height={36} />
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Check your inbox</CardTitle>
          <CardDescription>
            {target ? (
              <>
                We sent a sign-in link to <strong>{target}</strong>. The link
                expires in 15 minutes.
              </>
            ) : (
              <>We sent you a sign-in link. It expires in 15 minutes.</>
            )}
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
