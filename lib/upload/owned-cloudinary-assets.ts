import { IMAGE_CONSTRAINTS } from "@/lib/images/constraints";

export interface OwnedCloudinaryAsset {
  publicId: string;
  assetId: string;
  version: string;
  cloudName: string;
  deliveryType: typeof IMAGE_CONSTRAINTS.deliveryType;
}

interface CloudinaryOwnershipPayload {
  public_id?: string;
  asset_id?: string;
  version?: string | number;
}

export function assertOwnedCloudinaryUpload(input: {
  payload: CloudinaryOwnershipPayload;
  expectedPublicId: string;
  expectedCloudName: string;
  allowedPrefix: string;
}): OwnedCloudinaryAsset {
  const { payload } = input;
  if (
    payload.public_id !== input.expectedPublicId ||
    !payload.asset_id ||
    payload.version == null ||
    !input.expectedPublicId.startsWith(input.allowedPrefix)
  ) {
    throw new Error("Cloudinary upload ownership could not be proven.");
  }
  return {
    publicId: payload.public_id,
    assetId: payload.asset_id,
    version: String(payload.version),
    cloudName: input.expectedCloudName,
    deliveryType: IMAGE_CONSTRAINTS.deliveryType,
  };
}

export function assertOwnedListingAsset(input: {
  asset: OwnedCloudinaryAsset;
  cloudName: string;
  allowedPrefix?: string;
}) {
  const prefix = input.allowedPrefix ?? `${IMAGE_CONSTRAINTS.folder}/`;
  if (
    input.asset.cloudName !== input.cloudName ||
    input.asset.deliveryType !== IMAGE_CONSTRAINTS.deliveryType ||
    !input.asset.publicId.startsWith(prefix) ||
    !input.asset.assetId ||
    !input.asset.version
  ) {
    throw new Error(`Refusing to delete an unowned Cloudinary asset: ${input.asset.publicId}`);
  }
}

export async function destroyOwnedCloudinaryAssets(input: {
  assets: OwnedCloudinaryAsset[];
  cloudName: string;
  allowedPrefix?: string;
  destroy: (asset: OwnedCloudinaryAsset) => Promise<void>;
}) {
  const unique = new Map(input.assets.map((asset) => [asset.publicId, asset]));
  for (const asset of unique.values()) {
    assertOwnedListingAsset({
      asset,
      cloudName: input.cloudName,
      allowedPrefix: input.allowedPrefix,
    });
  }
  for (const asset of unique.values()) {
    await input.destroy(asset);
  }
}
