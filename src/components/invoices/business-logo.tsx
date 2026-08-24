"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

// Keyed by `path` from the parent so it remounts (and re-fetches a fresh
// signed URL) cleanly whenever the logo changes, rather than needing an
// effect that resets state on every path change.
export function LogoImage({
  path,
  className,
}: {
  path: string;
  className?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    supabase.storage
      .from("logos")
      .createSignedUrl(path, 60 * 60)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (!error && data) setUrl(data.signedUrl);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (!url) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="Business logo" className={className} />;
}

export function BusinessLogoUpload({
  logoPath,
  onLogoChange,
}: {
  logoPath: string | null;
  onLogoChange: (path: string | null) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("logo", file);
      const res = await fetch("/api/profile/logo", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to upload logo");

      onLogoChange(data.logo_url);
      toast.success("Logo updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleRemove() {
    setRemoving(true);
    try {
      const res = await fetch("/api/profile/logo", { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to remove logo");
      }
      onLogoChange(null);
      toast.success("Logo removed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border p-3">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />
      <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted/30">
        {logoPath ? (
          <LogoImage
            key={logoPath}
            path={logoPath}
            className="h-full w-full object-contain"
          />
        ) : (
          <ImagePlus className="h-5 w-5 text-muted-foreground" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Business logo</p>
        <p className="text-xs text-muted-foreground">
          Shown on every invoice and estimate you create.
        </p>
      </div>
      <div className="flex shrink-0 gap-1">
        <Button
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          {uploading && <Loader2 className="h-4 w-4 animate-spin" />}
          {logoPath ? "Change" : "Upload"}
        </Button>
        {logoPath && (
          <Button
            variant="ghost"
            size="icon"
            onClick={handleRemove}
            disabled={removing}
            title="Remove logo"
          >
            {removing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <X className="h-4 w-4" />
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
