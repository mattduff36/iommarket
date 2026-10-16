import { Suspense } from "react";
import { PageSkeleton } from "@/components/navigation/page-skeletons";
import { AccountArea } from "@/components/account/account-area";

export default function DealerLayout({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<PageSkeleton kind="table" />}><AccountArea>{children}</AccountArea></Suspense>;
}
