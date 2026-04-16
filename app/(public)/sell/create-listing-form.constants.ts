import { Bike, BusFront, Car, Truck, type LucideIcon } from "lucide-react";

export interface CategoryTileMeta {
  icon: LucideIcon;
  idleIconClass: string;
  selectedClass: string;
}

export const DEFAULT_CATEGORY_TILE_ICON: LucideIcon = Car;

export const CATEGORY_TILE_META: Record<string, CategoryTileMeta> = {
  car: {
    icon: Car,
    idleIconClass: "text-neon-red-400",
    selectedClass:
      "border-neon-red-400 bg-neon-red-500/15 text-white ring-2 ring-neon-red-500/70 shadow-glow-red",
  },
  van: {
    icon: Truck,
    idleIconClass: "text-neon-blue-400",
    selectedClass:
      "border-neon-blue-400 bg-neon-blue-500/15 text-white ring-2 ring-neon-blue-500/70 shadow-glow-blue",
  },
  motorbike: {
    icon: Bike,
    idleIconClass: "text-premium-gold-400",
    selectedClass:
      "border-premium-gold-400 bg-premium-gold-500/20 text-white ring-2 ring-premium-gold-400/60 shadow-glow-gold",
  },
  motorhome: {
    icon: BusFront,
    idleIconClass: "text-violet-300",
    selectedClass:
      "border-violet-400 bg-violet-500/15 text-white ring-2 ring-violet-400/70 shadow-[0_0_18px_rgba(167,139,250,0.35)]",
  },
};
