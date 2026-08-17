"use client";

import { useRouter } from "next/navigation";

export function useRefreshPage(): () => void {
  const router = useRouter();
  return () => {
    router.refresh();
  };
}
