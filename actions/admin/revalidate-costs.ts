import { revalidatePath } from "next/cache";

export function revalidateCostPages(requestId?: string): void {
  revalidatePath("/admin/costs");
  if (requestId) {
    revalidatePath(`/admin/costs/confirm/${requestId}`);
  }
}
