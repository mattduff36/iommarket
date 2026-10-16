# Guided listing workflow

The private and dealer sell forms use four steps: Details, Photos, Advert, Review. Details combines required and additional fields in one continuous page. Section shortcuts scroll to their fields without hiding other sections. Ticks indicate valid required details or meaningful values added to an optional section. Ownership is not a separate group; existing tax and insurance fields remain in More details.

Required attributes come from `isListingAttributeRequired` (category `required` flags plus mileage and, when listing N/S policy is on, write-off category). Optional attributes are everything else that is currently visible, including motorhome and van groups from `partitionByDetailGroup`. Unknown optional slugs stay in a "More details" group. Advert holds title, price, region, then description. Review summarises those steps and then uses the existing declarations, featured offer, and submit or checkout actions.

The step rail uses status icons and labels, with accessible status text and subtle direction arrows. The page grows with the form; Continue, Back, and Submit sit in a sticky bottom action bar above the footer. Fields use `Input`, `Checkbox`, `ImageUpload`, `VehicleCatalogueFields`, and `CreateListingAttributeFields`.

Panels stay mounted and hidden so photos, controlled attributes, and advert `FormData` survive navigation. Forward movement checks only the current gate. Optional blank values do not block and are not cleared. Direct jumps cannot pass an incomplete required step, an invalid optional value, fewer than two photos, a busy photo upload, or an incomplete advert. Back and review Edit links can return to an earlier step. Server field errors use `guidedStepForFieldErrors` instead of the old step 1 or step 3 numbers.

No schema, API, or payment-provider change is involved. There is no separate Save and exit control because a draft is still created by the existing submit path, not by a new persistence call.


New unsaved listings are restored from versioned browser storage scoped to the authenticated user, seller mode and category. Text and photo metadata use localStorage; original uploaded photos use IndexedDB so expired upload intents can be refreshed through the normal upload path. Local storage failures are shown in the form. Declarations are not restored. Successful submission or explicit discard clears that local draft; validation and uncertain outcomes retain it.

Review includes an authenticated, noindex private preview in a separate tab. It uses the public listing gallery and specification components but does not create a listing or expose buyer actions. The preview snapshot stays in this browser and expires after one day.
