export type PhotoKind = "hatch" | "saloon" | "suv" | "estate" | "coupe" | "van" | "bike" | "motorhome";

const HATCH = [
  "https://images.unsplash.com/photo-1549317661-bd32c8ce0db2?w=1200&h=800&fit=crop",
  "https://images.unsplash.com/photo-1551830820-330a71b99659?w=1200&h=800&fit=crop",
  "https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=1200&h=800&fit=crop",
  "https://images.unsplash.com/photo-1542362567-b07e54358753?w=1200&h=800&fit=crop",
  "https://images.unsplash.com/photo-1494976388531-d1058494cdd8?w=1200&h=800&fit=crop",
  "https://images.unsplash.com/photo-1552519507-da3b142c6e3d?w=1200&h=800&fit=crop",
  "https://images.unsplash.com/photo-1489824904134-891ab64532f1?w=1200&h=800&fit=crop",
  "https://images.unsplash.com/photo-1502877338535-766e1452684d?w=1200&h=800&fit=crop",
] as const;

const SALOON = [
  "https://images.unsplash.com/photo-1555215695-3004980ad54e?w=1200&h=800&fit=crop",
  "https://images.unsplash.com/photo-1618843479313-40f8afb4b4d8?w=1200&h=800&fit=crop",
  "https://images.unsplash.com/photo-1606664515524-ed2f786a0bd6?w=1200&h=800&fit=crop",
  "https://images.unsplash.com/photo-1617531653332-bd46c24f2068?w=1200&h=800&fit=crop",
  "https://images.unsplash.com/photo-1619767886558-efdc259cde1a?w=1200&h=800&fit=crop",
  "https://images.unsplash.com/photo-1605559424843-9e4c228bf1c2?w=1200&h=800&fit=crop",
] as const;

const SUV = [
  "https://images.unsplash.com/photo-1519641471654-76ce0107ad1b?w=1200&h=800&fit=crop",
  "https://images.unsplash.com/photo-1533473359331-0135ef1b58bf?w=1200&h=800&fit=crop",
  "https://images.unsplash.com/photo-1544636331-e26879cd4d9b?w=1200&h=800&fit=crop",
  "https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7?w=1200&h=800&fit=crop",
  "https://images.unsplash.com/photo-1549399542-7e3f8b79c341?w=1200&h=800&fit=crop",
  "https://images.unsplash.com/photo-1511919884226-fd3cad34687c?w=1200&h=800&fit=crop",
  "https://images.unsplash.com/photo-1541899481282-d53bffe3c35d?w=1200&h=800&fit=crop",
] as const;

const ESTATE = [
  "https://images.unsplash.com/photo-1449965408869-eaa3f722e40d?w=1200&h=800&fit=crop",
  "https://images.unsplash.com/photo-1486006920555-c77dcf18193c?w=1200&h=800&fit=crop",
  "https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?w=1200&h=800&fit=crop",
] as const;

const COUPE = [
  "https://images.unsplash.com/photo-1583267746897-2cf415887172?w=1200&h=800&fit=crop",
  "https://images.unsplash.com/photo-1614165935095-0d8d0c0d0d0d?w=1200&h=800&fit=crop",
  "https://images.unsplash.com/photo-1525609004556-c46c7d6cf023?w=1200&h=800&fit=crop",
] as const;

const VAN = [
  "https://images.unsplash.com/photo-1527786356703-4b4e0231a810?w=1200&h=800&fit=crop",
  "https://images.unsplash.com/photo-1558618666-fcd25c85f82e?w=1200&h=800&fit=crop",
  "https://images.unsplash.com/photo-1563720223185-11003d516935?w=1200&h=800&fit=crop",
  "https://images.unsplash.com/photo-1544620341-11cb2cd7c323?w=1200&h=800&fit=crop",
  "https://images.unsplash.com/photo-1519003722824-194d4455a60c?w=1200&h=800&fit=crop",
] as const;

const BIKE = [
  "https://images.unsplash.com/photo-1558981806-ec527fa84c39?w=1200&h=800&fit=crop",
  "https://images.unsplash.com/photo-1609630875171-b1321377ee65?w=1200&h=800&fit=crop",
  "https://images.unsplash.com/photo-1568772585407-9361f9bf3a87?w=1200&h=800&fit=crop",
  "https://images.unsplash.com/photo-1558981403-c5f9899a28bc?w=1200&h=800&fit=crop",
  "https://images.unsplash.com/photo-1558981359-219d6364c9c8?w=1200&h=800&fit=crop",
] as const;

const MOTORHOME = [
  "https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=1200&h=800&fit=crop",
  "https://images.unsplash.com/photo-1523987355523-c7b5b0dd90a7?w=1200&h=800&fit=crop",
  "https://images.unsplash.com/photo-1527786356703-4b4e0231a810?w=1200&h=800&fit=crop",
] as const;

const POOLS: Record<PhotoKind, readonly string[]> = {
  hatch: HATCH,
  saloon: SALOON,
  suv: SUV,
  estate: ESTATE,
  coupe: COUPE,
  van: VAN,
  bike: BIKE,
  motorhome: MOTORHOME,
};

export function photoKindFor(input: {
  category: "car" | "van" | "motorbike" | "motorhome";
  bodyType?: string;
}): PhotoKind {
  if (input.category === "van") return "van";
  if (input.category === "motorbike") return "bike";
  if (input.category === "motorhome") return "motorhome";
  const body = input.bodyType?.toLowerCase() ?? "";
  if (body.includes("suv") || body.includes("pickup")) return "suv";
  if (body.includes("estate")) return "estate";
  if (body.includes("coupe") || body.includes("convertible")) return "coupe";
  if (body.includes("saloon")) return "saloon";
  return "hatch";
}

export function listingImageUrls(input: {
  kind: PhotoKind;
  index: number;
  count: number;
}): string[] {
  const pool = POOLS[input.kind];
  return Array.from({ length: input.count }, (_, offset) => {
    return pool[(input.index * 3 + offset) % pool.length];
  });
}

export function assertPhotoKindMatch(kind: PhotoKind, urls: string[]) {
  const pool = new Set(POOLS[kind]);
  if (urls.some((url) => !pool.has(url))) {
    throw new Error(`Photo URL is not in the ${kind} pool.`);
  }
}
