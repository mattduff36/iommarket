"use client";
import { Button } from "@/components/ui/button";
import { FormErrorSummary } from "@/components/ui/form-error-summary";
import type { OutcomeReview } from "@/lib/forms/outcome-uncertainty";
import { ListingPreviewButton } from "./listing-preview-button";
import type { DraftCatalog, UnsavedDraftSnapshot } from "./listing-unsaved-draft";

export function CreateListingActions({ step, error, outcomeReview, userId, mode, draftCatalog, unsavedSnapshot, photoBusy, isPending, recovering, prevStep, nextStep, editMode, isFreeForUser }: {
  step: number; error: string | null; outcomeReview: OutcomeReview | null;
  userId?: string; mode: "private" | "dealer"; draftCatalog: DraftCatalog;
  unsavedSnapshot: UnsavedDraftSnapshot; photoBusy: boolean; isPending: boolean;
  recovering: boolean; prevStep: () => void; nextStep: () => void;
  editMode?: string; isFreeForUser: boolean;
}) {
  return (
<>
                  {error ? <FormErrorSummary messages={[error]} /> : null}
                  {outcomeReview ? <a href={outcomeReview.href} className="text-text-trust underline">{outcomeReview.label}</a> : null}
                  {step === 4 && userId ? <ListingPreviewButton
                    scope={{ userId, mode, catalog: draftCatalog }} snapshot={unsavedSnapshot}
                    disabled={photoBusy || isPending}
                  /> : null}
                  <div className="flex items-center gap-3">
                    {step > 1 ? (
                      <Button type="button" variant="ghost" onClick={prevStep}>
                        Back
                      </Button>
                    ) : null}
                    {step < 4 ? (
                      <Button
                        type="button"
                        size="lg"
                        className="w-full"
                        onClick={nextStep}
                        disabled={(step === 2 && photoBusy) || recovering}
                      >
                        Continue
                      </Button>
                    ) : (
                      <Button
                        type="submit"
                        size="lg"
                        className="w-full"
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
                </>
  );
}
