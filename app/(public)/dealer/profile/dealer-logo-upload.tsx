"use client";

import { useRef, useState } from "react";
import { ImagePlus, Trash2, UploadCloud } from "lucide-react";
import { DealerLogo } from "@/components/dealers/dealer-logo";
import { Button } from "@/components/ui/button";
import { validateDealerLogoFile } from "@/lib/upload/dealer-logo";

interface DealerLogoUploadProps {
  dealerName: string;
  logoUrl: string | null;
  onLogoChange: (logoUrl: string | null) => void;
}

interface UploadResponse {
  data?: { logoUrl?: string };
  error?: string;
}

export function DealerLogoUpload({
  dealerName,
  logoUrl,
  onLogoChange,
}: DealerLogoUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const displayedLogoUrl = previewUrl ?? logoUrl;
  const isUploading = uploadProgress !== null;
  const isBusy = isUploading || isRemoving;

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setError(null);
    setSuccess(null);
    const validation = await validateDealerLogoFile(file);
    if ("error" in validation) {
      setError(validation.error);
      return;
    }

    const localPreviewUrl = URL.createObjectURL(file);
    setPreviewUrl(localPreviewUrl);
    setUploadProgress(0);

    try {
      const uploadedLogoUrl = await uploadDealerLogo(file, setUploadProgress);
      onLogoChange(uploadedLogoUrl);
      setSuccess("Logo updated.");
    } catch (uploadError) {
      setError(getErrorMessage(uploadError, "Could not upload your logo. Please try again."));
    } finally {
      URL.revokeObjectURL(localPreviewUrl);
      setPreviewUrl(null);
      setUploadProgress(null);
    }
  }

  async function handleRemove() {
    setError(null);
    setSuccess(null);
    setIsRemoving(true);

    try {
      const response = await fetch("/api/dealer-profile/logo", {
        method: "DELETE",
        headers: { Accept: "application/json" },
      });
      const payload = (await response.json().catch(() => null)) as UploadResponse | null;
      if (!response.ok) throw new Error(payload?.error ?? "Could not remove your logo.");

      onLogoChange(null);
      setSuccess("Logo removed.");
    } catch (removeError) {
      setError(getErrorMessage(removeError, "Could not remove your logo. Please try again."));
    } finally {
      setIsRemoving(false);
    }
  }

  return (
    <div className="flex w-full flex-col items-start gap-3 sm:w-auto sm:flex-row sm:items-center">
      <div className="relative">
        <input
          ref={inputRef}
          id="dealer-logo-upload"
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp,.png,.jpg,.jpeg,.gif,.webp"
          className="peer sr-only"
          aria-label="Upload dealer logo"
          aria-describedby="dealer-logo-guidance dealer-logo-error"
          disabled={isBusy}
          onChange={handleFileChange}
        />
        <label
          htmlFor="dealer-logo-upload"
          className="group flex h-28 w-28 cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl border border-dashed border-neon-blue-500/50 bg-canvas/60 text-center transition-colors hover:border-neon-blue-400 hover:bg-neon-blue-500/10 peer-focus-visible:ring-2 peer-focus-visible:ring-neon-blue-500 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-surface peer-disabled:cursor-not-allowed peer-disabled:opacity-60"
        >
          {displayedLogoUrl ? (
            <>
              <DealerLogo
                logoUrl={displayedLogoUrl}
                dealerName={dealerName}
                className="h-full w-full rounded-none"
              />
              <span className="absolute inset-x-1 bottom-1 rounded bg-black/75 px-1.5 py-1 text-[10px] font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                Change logo
              </span>
            </>
          ) : (
            <>
              <ImagePlus className="mb-2 h-5 w-5 text-neon-blue-400" aria-hidden="true" />
              <span className="px-2 text-xs font-medium leading-4 text-text-primary">
                Click here to upload your logo*
              </span>
            </>
          )}
        </label>
      </div>

      <div className="min-w-0 space-y-1">
        {logoUrl ? (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={isBusy}
              onClick={() => inputRef.current?.click()}
              leftIcon={<UploadCloud className="h-3.5 w-3.5" />}
            >
              Change logo
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={isBusy}
              onClick={handleRemove}
              leftIcon={<Trash2 className="h-3.5 w-3.5" />}
            >
              Remove logo
            </Button>
          </div>
        ) : null}
        {isUploading ? (
          <p className="text-xs font-medium text-neon-blue-400" aria-live="polite">
            Uploading logo{uploadProgress > 0 ? `: ${uploadProgress}%` : "..."}
          </p>
        ) : null}
        {isRemoving ? (
          <p className="text-xs font-medium text-neon-blue-400" aria-live="polite">
            Removing logo...
          </p>
        ) : null}
        {error ? (
          <p id="dealer-logo-error" role="alert" className="text-xs text-text-error">
            {error}
          </p>
        ) : (
          <span id="dealer-logo-error" className="sr-only" />
        )}
        {success ? (
          <p role="status" className="text-xs text-neon-blue-400">
            {success}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function uploadDealerLogo(
  file: File,
  onProgress: (progress: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const formData = new FormData();
    formData.append("logo", file);

    request.open("POST", "/api/dealer-profile/logo");
    request.setRequestHeader("Accept", "application/json");
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    });
    request.addEventListener("load", () => {
      const payload = parseUploadResponse(request.responseText);
      if (request.status < 200 || request.status >= 300 || !payload?.data?.logoUrl) {
        reject(new Error(payload?.error ?? "Could not upload your logo."));
        return;
      }
      resolve(payload.data.logoUrl);
    });
    request.addEventListener("error", () => reject(new Error("Could not upload your logo.")));
    request.send(formData);
  });
}

function parseUploadResponse(value: string): UploadResponse | null {
  try {
    return JSON.parse(value) as UploadResponse;
  } catch {
    return null;
  }
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
