export interface CategoryLandingCopy {
  title: string;
  heading: string;
  description: string;
  intro: string;
}

const KNOWN_CATEGORY_COPY: Record<string, CategoryLandingCopy> = {
  car: {
    title: "Cars for sale",
    heading: "Cars for sale",
    description:
      "Browse cars advertised on iTrader.im by dealers and private sellers. A vehicle may be located in the Isle of Man or the United Kingdom.",
    intro:
      "These are cars currently advertised on iTrader.im. The location shown on each listing is the place named by the seller and may be in the Isle of Man or the United Kingdom.",
  },
  van: {
    title: "Vans for sale",
    heading: "Vans for sale",
    description:
      "Browse vans advertised on iTrader.im by dealers and private sellers. A vehicle may be located in the Isle of Man or the United Kingdom.",
    intro:
      "These are vans currently advertised on iTrader.im. The location shown on each listing is the place named by the seller and may be in the Isle of Man or the United Kingdom.",
  },
  motorbike: {
    title: "Motorbikes for sale",
    heading: "Motorbikes for sale",
    description:
      "Browse motorbikes advertised on iTrader.im by dealers and private sellers. A vehicle may be located in the Isle of Man or the United Kingdom.",
    intro:
      "These are motorbikes currently advertised on iTrader.im. The location shown on each listing is the place named by the seller and may be in the Isle of Man or the United Kingdom.",
  },
  motorhome: {
    title: "Motorhomes for sale",
    heading: "Motorhomes for sale",
    description:
      "Browse motorhomes advertised on iTrader.im by dealers and private sellers. A vehicle may be located in the Isle of Man or the United Kingdom.",
    intro:
      "These are motorhomes currently advertised on iTrader.im. The location shown on each listing is the place named by the seller and may be in the Isle of Man or the United Kingdom.",
  },
};

export function categoryLandingCopy(
  slug: string,
  name?: string | null,
): CategoryLandingCopy | null {
  const known = KNOWN_CATEGORY_COPY[slug];
  if (known) return known;
  const label = name?.trim();
  if (!label) return null;
  return {
    title: `${label} for sale`,
    heading: `${label} for sale`,
    description: `Browse ${label} advertised on iTrader.im. A vehicle may be located in the Isle of Man or the United Kingdom.`,
    intro: `These are ${label} listings currently advertised on iTrader.im.`,
  };
}
