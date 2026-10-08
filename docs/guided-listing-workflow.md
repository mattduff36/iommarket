# Guided listing workflow

The private and dealer sell forms use five steps in this order: Required vehicle details, Optional vehicle details, Photos, Advert, Review.

Required attributes come from `isListingAttributeRequired` (category `required` flags plus mileage and, when listing N/S policy is on, write-off category). Optional attributes are everything else that is currently visible, including motorhome and van groups from `partitionByDetailGroup`. Unknown optional slugs stay in a "More details" group. Advert holds title, price, region, then description. Review summarises those steps and then uses the existing declarations, featured offer, and submit or checkout actions.

The step rail follows the admin queue's card-plus-panel interaction (group, pressed, expanded, controls) with repository colour, radius, and type tokens. It does not share the admin stylesheet: that panel is a fixed 128px height, and this panel has to grow with the form. Admin queue appearance is unchanged. Continue, Back, and Submit still use `Button`. Fields still use `Input`, `Checkbox`, `ImageUpload`, `VehicleCatalogueFields`, and `CreateListingAttributeFields`.

Panels stay mounted and hidden so photos, controlled attributes, and advert `FormData` survive navigation. Forward movement checks only the current gate. Optional blank values do not block and are not cleared. Direct jumps cannot pass an incomplete required step, an invalid optional value, fewer than two photos, a busy photo upload, or an incomplete advert. Back and review Edit links can return to an earlier step. Server field errors use `guidedStepForFieldErrors` instead of the old step 1 or step 3 numbers.

No schema, API, or payment-provider change is involved. There is no separate Save and exit control because a draft is still created by the existing submit path, not by a new persistence call.
