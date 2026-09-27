import { Badge } from "@/components/ui/badge";

interface UserAccountStatusBadgeProps {
  deletedAt: Date | string | null;
  disabledAt: Date | string | null;
}

export function UserAccountStatusBadge({
  deletedAt,
  disabledAt,
}: UserAccountStatusBadgeProps) {
  if (deletedAt) {
    return <Badge variant="error">Deleted</Badge>;
  }

  if (disabledAt) {
    return <Badge variant="error">Disabled</Badge>;
  }

  return null;
}
