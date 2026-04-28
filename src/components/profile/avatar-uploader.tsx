"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Camera, Loader2, Trash2 } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc/client";

export function AvatarUploader({
  initialUrl,
  initials,
}: {
  initialUrl: string | null;
  initials: string;
}) {
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [url, setUrl] = React.useState<string | null>(initialUrl);
  const [uploading, setUploading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const setAvatar = trpc.profile.setAvatar.useMutation();
  const removeAvatar = trpc.profile.removeAvatar.useMutation();
  const utils = trpc.useUtils();

  async function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const body = new FormData();
      body.set("file", file);
      const res = await fetch("/api/upload/avatar", { method: "POST", body });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error ?? "Upload failed");
      }
      const { url: newUrl } = (await res.json()) as { url: string };
      await setAvatar.mutateAsync({ url: newUrl });
      setUrl(newUrl);
      await utils.profile.me.invalidate();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function onRemove() {
    setError(null);
    try {
      await removeAvatar.mutateAsync();
      setUrl(null);
      await utils.profile.me.invalidate();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't remove photo");
    }
  }

  return (
    <div className="flex items-center gap-5">
      <Avatar className="h-20 w-20 ring-2 ring-border">
        {url && <AvatarImage src={url} alt="Profile photo" />}
        <AvatarFallback className="bg-muted text-lg font-medium">
          {initials}
        </AvatarFallback>
      </Avatar>
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Camera className="mr-2 h-4 w-4" />
            )}
            {url ? "Replace photo" : "Upload photo"}
          </Button>
          {url && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onRemove}
              disabled={removeAvatar.isPending}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Remove
            </Button>
          )}
        </div>
        <p className="text-caption text-muted-foreground">
          PNG, JPEG, or WEBP. Max 4&nbsp;MB. Square images work best.
        </p>
        {error && <p className="text-caption text-destructive">{error}</p>}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={onFileChosen}
      />
    </div>
  );
}
