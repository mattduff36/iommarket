import { createHash } from "node:crypto";

type MigratedDealerLogo = { destinationPath: string; resourceType: "image" | "video" };

// Generated from the reviewed 7,677-asset migration map. Source URLs are hashed.
const MIGRATED_DEALER_LOGOS = new Map<string, MigratedDealerLogo>([
  [
    "09be71c9e0c8276f3dd28f762dd6c22b73c20aa8d574947c872d83cc15e56da9",
    {
      "destinationPath": "/iommarket-migration-sample/image/8445a0984af620754f4fed2570a4c891__v1790895691.png",
      "resourceType": "image"
    }
  ],
  [
    "9a2b66b6d01df69aa77bbc5c81619e3e4d4721bf71859a474223a47901631cff",
    {
      "destinationPath": "/iommarket-migration/image/cf78abb40e7676e100eb59b1ec5b1ef1__v1790896183.webp",
      "resourceType": "image"
    }
  ],
  [
    "a8fa7be3efc3dc6d039a19b0ddc1e538b112d958b0feec71aacbdbcbde99bdb5",
    {
      "destinationPath": "/iommarket-migration/image/b360420375a26ce8204627c00e433838__v1790896102.png",
      "resourceType": "image"
    }
  ],
  [
    "d20fe470e306976d235135fcc928b7e75f0a10a9913284a6d8445be6b6881849",
    {
      "destinationPath": "/iommarket-migration/image/51c3d24bae05ad9b8151efbac4cec0d5__v1790896386.png",
      "resourceType": "image"
    }
  ],
  [
    "dc9a742e1fc4b3273d0d93f74ca46782333646b828755b97e60e7c0df0bd7eb0",
    {
      "destinationPath": "/iommarket-migration/image/2b35954dba7a294b4e430eba88fd7c6e__v1790895682.webp",
      "resourceType": "image"
    }
  ],
  [
    "ee73f0db9cc45563a49122fe7cf509083ef7682442a6241ce4ca5f0a425447d1",
    {
      "destinationPath": "/iommarket-migration/image/7cf59a8eded4ca307bef5e0f0b15df95__v1790895687.jpg",
      "resourceType": "image"
    }
  ],
  [
    "f11ba13a11df3953b1a3438cabb836e12db8b1e55cdb8f2604207680dca8ea32",
    {
      "destinationPath": "/iommarket-migration/image/84e791494acfe117e4c5211e66af253a__v1790896220.jpg",
      "resourceType": "image"
    }
  ]
]);
export const MIGRATED_DEALER_LOGO_COUNT = MIGRATED_DEALER_LOGOS.size;

export function findMigratedDealerLogo(url: string): MigratedDealerLogo | null {
  const key = createHash("sha256").update(url).digest("hex");
  return MIGRATED_DEALER_LOGOS.get(key) ?? null;
}
