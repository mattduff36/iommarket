"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";

export function useRefreshPage(): () => void {
  const router = useRouter();
  return useCallback(() => {
    router.refresh();
  }, [router]);
}
