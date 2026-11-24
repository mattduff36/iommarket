import { useEffect, useRef, useState, type SyntheticEvent } from "react";

const RETRY_DELAYS_MS = [3000, 6000];

type PhotoAttempt = {
  status: "loading" | "ready" | "waiting" | "unavailable";
  retries: number;
  failedSource?: string;
};

const initialAttempt: PhotoAttempt = { status: "loading", retries: 0 };

export function usePhotoRetry({
  decorative,
  onPhotoLoad,
  onPhotoUnavailable,
}: {
  decorative: boolean;
  onPhotoLoad?: (src: string) => void;
  onPhotoUnavailable?: () => void;
}) {
  const [attempt, setAttempt] = useState(initialAttempt);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
  }, []);

  function onLoad({ currentTarget }: SyntheticEvent<HTMLImageElement>) {
    if (!currentTarget.naturalWidth || timer.current !== null) return;
    setAttempt(current => current.status === "ready" ? current : { ...current, status: "ready" });
    if (!decorative) onPhotoLoad?.(currentTarget.currentSrc || currentTarget.src);
  }

  function onError({ currentTarget }: SyntheticEvent<HTMLImageElement>) {
    if (timer.current !== null || attempt.status === "unavailable") return;
    const delay = RETRY_DELAYS_MS[attempt.retries];
    if (decorative || delay === undefined) {
      setAttempt({ ...attempt, status: "unavailable" });
      if (!decorative) onPhotoUnavailable?.();
      return;
    }
    const failedSource = currentTarget.currentSrc || currentTarget.src;
    setAttempt({ ...attempt, status: "waiting" });
    timer.current = setTimeout(() => {
      timer.current = null;
      setAttempt({ status: "loading", retries: attempt.retries + 1, failedSource });
    }, delay);
  }

  return {
    ...attempt,
    onLoad,
    onError,
    retry: () => setAttempt(initialAttempt),
    showImage: attempt.status === "loading" || attempt.status === "ready",
    showLoading: !decorative && (attempt.status === "loading" || attempt.status === "waiting"),
    showFallback: attempt.status === "waiting" || attempt.status === "unavailable"
      || (attempt.status === "loading" && attempt.retries > 0),
  };
}
