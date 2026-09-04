const TOWNS = [
  "Onchan",
  "Douglas",
  "Peel",
  "Ramsey",
  "Port Erin",
  "Castletown",
  "Laxey",
  "Kirk Michael",
  "Ballasalla",
  "Port St Mary",
  "Jurby",
  "Andreas",
] as const;

const PRIVATE_REASONS = [
  "Selling as I've gone for a van for work.",
  "Selling as the kids need more space now.",
  "Selling as I've moved closer to town.",
  "Selling as I've bought something smaller.",
  "Selling as I've no time to use it.",
  "Selling as I'm heading off-island for a bit.",
  "Selling as I've gone back to a bike.",
  "Selling as we only need one car now.",
] as const;

const PRIVATE_EXTRAS = [
  "2 owners, FSH, MOT till March.",
  "One owner from new, service book stamped.",
  "Recent tyres and a fresh service.",
  "MOT till September, no advisories last time.",
  "Winter tyres in the shed if you want them.",
  "Two keys, spare never used.",
  "Just had a new battery and front pads.",
  "Ideal first car for the island.",
] as const;

const DEALER_EXTRAS = [
  "Just taken in part-ex. Full history, two keys, ready to go.",
  "Serviced in our workshop last week. Finance and part-ex welcome.",
  "Clean example, island car, no stories.",
  "Ready to view on the forecourt. Warranty available.",
  "HPI clear, two keys, drives as it should.",
  "Recently inspected and priced to move.",
] as const;

const TITLE_HOOKS = [
  "2 owners, FSH",
  "long MOT",
  "low miles",
  "one owner",
  "just serviced",
  "tidy example",
  "island car",
  "ready to go",
] as const;

export function listingTown(index: number) {
  return TOWNS[index % TOWNS.length];
}

export function listingTitle(input: {
  year: string;
  make: string;
  model: string;
  index: number;
}) {
  const hook = TITLE_HOOKS[input.index % TITLE_HOOKS.length];
  const shortModel = input.model.split(" ").slice(0, 3).join(" ");
  return `${input.year} ${input.make} ${shortModel} — ${hook}`;
}

export function privateDescription(input: {
  make: string;
  model: string;
  year: string;
  mileage: string;
  town: string;
  index: number;
}) {
  const reason = PRIVATE_REASONS[input.index % PRIVATE_REASONS.length];
  const extra = PRIVATE_EXTRAS[input.index % PRIVATE_EXTRAS.length];
  const viewing =
    input.index % 3 === 0
      ? `Viewings in ${input.town} evenings/weekends. No timewasters.`
      : input.index % 3 === 1
        ? `Can view in ${input.town} after work. Cash or bank transfer.`
        : `Happy to meet in ${input.town}. Won't export, island sale only.`;
  return [
    `${input.year} ${input.make} ${input.model}, ${input.mileage} miles.`,
    reason,
    extra,
    viewing,
  ].join(" ");
}

export function dealerDescription(input: {
  make: string;
  model: string;
  year: string;
  mileage: string;
  town: string;
  dealerName: string;
  index: number;
}) {
  const extra = DEALER_EXTRAS[input.index % DEALER_EXTRAS.length];
  return [
    `${input.year} ${input.make} ${input.model} with ${input.mileage} miles.`,
    extra,
    `In stock at ${input.dealerName} in ${input.town}.`,
    input.index % 4 === 0
      ? "Can help with Steam Packet if you're coming over from the UK."
      : "Come and have a look, no pressure.",
  ].join(" ");
}

export function reviewComment(input: {
  dealerName: string;
  rating: number;
  index: number;
}) {
  if (input.rating >= 5) {
    return `Bought a car from ${input.dealerName} last month. Straight talking, no messing about, paperwork was ready.`;
  }
  if (input.rating === 4) {
    return `Straightforward viewing at ${input.dealerName}. Vehicle matched the advert and they held it overnight for me.`;
  }
  if (input.rating === 3) {
    return `Alright experience at ${input.dealerName}. Car was fine, just took a while to get a callback.`;
  }
  return `Not for me in the end. Listing was ok, communication was slow.`;
}

export const BLOCKED_SAMPLE_NAMES = ["Morris motors", "Ocean Motor Village"] as const;
