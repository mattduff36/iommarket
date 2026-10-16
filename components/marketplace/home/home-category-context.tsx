"use client";

import * as React from "react";

export const HOME_CATEGORY_TABS = [
  { slug: "car", label: "Cars" },
  { slug: "van", label: "Vans" },
  { slug: "motorbike", label: "Motorbikes" },
  { slug: "motorhome", label: "Motorhomes" },
] as const;

export type HomeCategorySlug = (typeof HOME_CATEGORY_TABS)[number]["slug"];

interface HomeCategoryContextValue {
  category: HomeCategorySlug;
  setCategory: (category: HomeCategorySlug) => void;
}

const HomeCategoryContext = React.createContext<HomeCategoryContextValue | null>(null);

export function HomeCategoryProvider({ children }: { children: React.ReactNode }) {
  const [category, setCategory] = React.useState<HomeCategorySlug>("car");
  const value = React.useMemo(() => ({ category, setCategory }), [category]);

  return <HomeCategoryContext.Provider value={value}>{children}</HomeCategoryContext.Provider>;
}

export function useHomeCategory(): HomeCategoryContextValue | null {
  return React.useContext(HomeCategoryContext);
}
