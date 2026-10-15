"use client";

import { useMemo, type Dispatch, type SetStateAction } from "react";
import type { UploadedImage } from "@/components/marketplace/image-upload";
import type { VehicleCatalogueSelection } from "./vehicle-catalogue-fields";
import { useUnsavedListingDraft } from "./listing-draft-photos";
import { formPhotoToDraftPhoto, type GuidedDraftStep, type UnsavedDraftSnapshot } from "./listing-unsaved-draft";

type State<T> = readonly [T, Dispatch<SetStateAction<T>>];

export function useCreateListingLocalDraft(input: {
  enabled: boolean; userId: string; mode: "private" | "dealer";
  categories: Array<{ id: string; attributes: Array<{ id: string }> }>;
  regions: Array<{ id: string }>;
  category: State<string>; title: State<string>; description: State<string>;
  price: State<string>; region: State<string>; registration: State<string>;
  attributes: State<Record<string, string>>; selection: State<VehicleCatalogueSelection>;
  photos: State<UploadedImage[]>; step: State<GuidedDraftStep>;
  onReset: () => void;
}) {
  const draftCatalog = useMemo(() => ({
    categories: input.categories.map((category) => ({ id: category.id, attributeIds: category.attributes.map((attribute) => attribute.id) })),
    regionIds: input.regions.map((region) => region.id),
  }), [input.categories, input.regions]);
  const unsavedSnapshot: UnsavedDraftSnapshot = {
    categoryId: input.category[0], title: input.title[0], description: input.description[0],
    price: input.price[0], regionId: input.region[0], attributes: input.attributes[0],
    registrationInput: input.registration[0], catalogueSelection: input.selection[0],
    photos: input.photos[0].map(formPhotoToDraftPhoto), currentStep: input.step[0],
  };
  const localDraft = useUnsavedListingDraft({
    enabled: input.enabled, userId: input.userId, mode: input.mode,
    catalog: draftCatalog, snapshot: unsavedSnapshot,
    applyDraft: (draft) => {
      input.category[1](draft.categoryId); input.title[1](draft.title);
      input.description[1](draft.description); input.price[1](draft.price);
      input.region[1](draft.regionId); input.attributes[1](draft.attributes);
      input.registration[1](draft.registrationInput); input.selection[1](draft.catalogueSelection);
      input.photos[1](draft.photos.map(({ listingImageId, ...photo }) => ({ ...photo, id: listingImageId })));
      input.step[1](draft.currentStep);
    },
    resetFields: () => {
      input.category[1](""); input.title[1](""); input.description[1](""); input.price[1]("");
      input.region[1](""); input.attributes[1]({}); input.registration[1]("");
      input.selection[1]({ makeMode: "manual", modelMode: "manual" });
      input.photos[1]([]); input.step[1](1); input.onReset();
    },
  });
  return { localDraft, draftCatalog, unsavedSnapshot };
}
