import { AccountArea } from "@/components/account/account-area";

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return <AccountArea>{children}</AccountArea>;
}
