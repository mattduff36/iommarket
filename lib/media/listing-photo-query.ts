import { z } from "zod";
import { isListingPhotoDeliveryWidth } from "@/lib/images/delivery-widths";

export const listingPhotoDeliveryQuerySchema = z.object({
  imageId: z.string().min(1).max(80),
  source: z.enum(["listing", "revision", "upload"]).default("listing"),
  mode: z.enum(["fill", "fit", "blur", "social"]),
  frame: z.enum(["card", "gallery", "thumb", "admin", "preview", "social"]),
  w: z.coerce.number().int().refine(isListingPhotoDeliveryWidth, "Unsupported image width."),
});
