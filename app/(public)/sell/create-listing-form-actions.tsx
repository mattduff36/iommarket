"use client";
import { Button } from "@/components/ui/button";
import { FormErrorSummary } from "@/components/ui/form-error-summary";
import type { OutcomeReview } from "@/lib/forms/outcome-uncertainty";
import { ListingPreviewButton } from "./listing-preview-button";
import type { DraftCatalog, UnsavedDraftSnapshot } from "./listing-unsaved-draft";

export function CreateListingActions({ step, error, outcomeReview, userId, mode, draftCatalog, unsavedSnapshot, photoBusy, isPending, recovering, prevStep, nextStep, editMode, isFreeForUser, onAddPhotos, canAddPhotos, addingPhotosBusy }: {
  step: number; error: string | null; outcomeReview: OutcomeReview | null;
  userId?: string; mode: "private" | "dealer"; draftCatalog: DraftCatalog;
  unsavedSnapshot: UnsavedDraftSnapshot; photoBusy: boolean; isPending: boolean;
  recovering: boolean; prevStep: () => void; nextStep: () => void;
  editMode?: string; isFreeForUser: boolean; onAddPhotos: () => void; canAddPhotos: boolean; addingPhotosBusy: boolean;
}) {
  return (
<>
                  {error ? <FormErrorSummary messages={[error]} /> : null}
                  {outcomeReview ? <a href={outcomeReview.href} className="text-text-trust underline">{outcomeReview.label}</a> : null}
                  <div className="flex flex-nowrap items-center gap-2 sm:gap-3">
                    {step > 1 ? (
                      <Button type="button" variant="ghost" className="h-12 shrink-0 border border-white/30 bg-white/5 px-2 text-xs text-text-primary sm:text-sm hover:bg-white/10 sm:px-6" onClick={prevStep}>
                        Back
                      </Button>
                    ) : null}
                    <div className="ml-auto flex min-w-0 items-center justify-end gap-2 sm:gap-3">
                    {step === 2 && canAddPhotos ? <Button type="button" variant="ghost"
                      className="h-12 min-w-0 whitespace-normal border border-white/30 bg-white/5 px-2 text-xs text-text-primary hover:bg-white/10 sm:px-6 sm:text-sm"
                      disabled={addingPhotosBusy || recovering} onClick={onAddPhotos}>Add photos</Button> : null}
                    {step === 4 && userId ? <ListingPreviewButton
                      scope={{ userId, mode, catalog: draftCatalog }} snapshot={unsavedSnapshot}
                      disabled={photoBusy || isPending}
                    /> : null}
                    {step < 4 ? (
                      <Button
                        type="button"
                        size="lg"
                        className="min-w-0 whitespace-normal px-3 text-xs leading-tight sm:px-8 sm:text-base"
                        onClick={nextStep}
                        disabled={(step === 2 && photoBusy) || recovering}
                      >
                        Continue
                      </Button>
                    ) : (
                      <Button
                        type="submit"
                        size="lg"
                        className="min-w-0 whitespace-normal px-3 text-xs leading-tight sm:px-8 sm:text-base"
                        loading={isPending}
                        disabled={isPending || photoBusy || Boolean(outcomeReview)}
                      >
                        {editMode === "revision"
                          ? "Submit changes for review"
                          : editMode === "resubmit"
                            ? "Resubmit for review"
                            : mode === "dealer" || isFreeForUser
                              ? "Submit Listing"
                              : "Continue to Checkout"}
                      </Button>
                    )}
                    </div>
                  </div>
                </>
  );
}
