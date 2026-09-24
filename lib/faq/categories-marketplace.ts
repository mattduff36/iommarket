import type { FaqCategory } from "@/lib/faq/types";
import { link, text, LISTING_DURATION_DAYS, PRIVATE_LISTING_PHOTO_LIMIT, FEATURED_LISTING_PHOTO_LIMIT } from "@/lib/faq/copy";

export const marketplaceFaqCategories: FaqCategory[] = [
  {
    id: "about-itrader",
    title: "About iTrader",
    items: [
      {
        id: "what-is-itrader",
        question: "What is iTrader.im?",
        paragraphs: [
          [
            text(
              "iTrader.im is an Isle of Man marketplace for cars, vans, motorbikes and motorhomes. It is a trading name of Code Lab Platforms Limited. Private sellers and motor dealers advertise vehicles on the site. Buyers search those adverts and contact the seller directly.",
            ),
          ],
          [
            text(
              "You can browse without an account. An account is needed to advertise a vehicle, save a listing or search, and send a message from a listing.",
            ),
          ],
        ],
      },
      {
        id: "is-itrader-only-for-the-isle-of-man",
        question: "Is iTrader.im only for the Isle of Man?",
        paragraphs: [
          [
            text(
              "iTrader is an Isle of Man marketplace. A vehicle advertised here may be located in the Isle of Man or the United Kingdom.",
            ),
          ],
          [
            text(
              "Search can be filtered by location. A listing can also be recorded against a United Kingdom location, so results are not limited to one place name. The ",
            ),
            link("/terms", "Terms"),
            text(" explain who the service is for."),
          ],
        ],
      },
      {
        id: "what-vehicles-can-i-buy-and-sell",
        question: "What types of vehicles can I buy and sell?",
        paragraphs: [
          [
            text(
              "You can advertise cars, vans, motorbikes and motorhomes. Each listing is for one vehicle. Browse them from ",
            ),
            link("/categories", "vehicle categories"),
            text(" or "),
            link("/search", "search"),
            text("."),
          ],
          [
            text(
              "Number plates, vehicle parts and other goods are not accepted. Written-off vehicles are not accepted either, except a Category N or Category S vehicle when that category is clearly disclosed. See ",
            ),
            link(
              "/faq#can-i-advertise-a-category-n-or-category-s-vehicle",
              "Category N and Category S",
            ),
            text(" and the "),
            link("/acceptable-use", "Acceptable Use Policy"),
            text("."),
          ],
        ],
      },
      {
        id: "does-itrader-sell-the-vehicles",
        question: "Does iTrader sell the vehicles advertised on the site?",
        paragraphs: [
          [
            text(
              "No. iTrader is an advertising marketplace. It does not own, buy or sell the vehicles, and it is not the seller, the buyer, a broker or an agent for the sale.",
            ),
          ],
          [
            text(
              "Any agreement to buy a vehicle is only between the buyer and the seller. iTrader does not inspect the vehicle, negotiate the sale, hold a deposit or the purchase price, or guarantee the condition, history, mileage, ownership or that a sale will complete. Read the ",
            ),
            link("/terms", "Terms"),
            text(" and "),
            link("/safety", "buyer safety guidance"),
            text(" before you agree anything."),
          ],
        ],
      },
    ],
  },
  {
    id: "buying-a-vehicle",
    title: "Buying a Vehicle",
    items: [
      {
        id: "how-do-i-contact-a-seller",
        question: "How do I contact a seller?",
        paragraphs: [
          [
            text(
              "Open the listing and use Contact Seller. The message form is shown after you sign in. You enter your name, email and message. iTrader emails the seller and sends you a confirmation.",
            ),
          ],
          [
            text(
              "The seller decides whether to reply. iTrader does not guarantee that an enquiry is genuine or that it will lead to a purchase. You can ",
            ),
            link("/sign-in", "sign in"),
            text(" or "),
            link("/search", "browse vehicles"),
            text(" first."),
          ],
        ],
      },
      {
        id: "how-can-i-search-for-a-vehicle",
        question: "How can I search for a vehicle?",
        paragraphs: [
          [
            text("Use "),
            link("/search", "search"),
            text(" or browse "),
            link("/categories", "cars, vans, motorbikes and motorhomes"),
            text(
              ". You can narrow results by details such as make, model, price, year, mileage, location and whether the seller is private or a dealer.",
            ),
          ],
          [
            text(
              "Looking through vehicles does not need an account. Saving a search, or saving a vehicle, does.",
            ),
          ],
        ],
      },
      {
        id: "can-i-save-vehicles-and-searches",
        question: "Can I save vehicles and searches?",
        paragraphs: [
          [
            text(
              "Yes, once you have an account. On a listing, use Save to favourites. Those vehicles are kept under ",
            ),
            link("/account/favourites", "Saved Listings"),
            text("."),
          ],
          [
            text(
              "On the search results, signed-in users can save the current search and give it a name. Saved searches are listed under ",
            ),
            link("/account/saved-searches", "Saved Searches"),
            text(". Create an account from "),
            link("/sign-up", "sign up"),
            text(" if you do not have one yet."),
          ],
        ],
      },
      {
        id: "does-itrader-guarantee-a-vehicle",
        question: "Does iTrader guarantee a vehicle's condition or history?",
        paragraphs: [
          [
            text(
              "No. A listing is the seller's advertisement. iTrader does not guarantee the condition, history, mileage, ownership, roadworthiness or completeness of a description.",
            ),
          ],
          [
            text("Vehicle Check is a separate information service. It is not a guarantee either. Use "),
            link("/safety", "buyer safety"),
            text(" and, if you want the information service, "),
            link("/vehicle-check", "Vehicle Check"),
            text("."),
          ],
        ],
      },
      {
        id: "what-checks-should-i-make-before-buying",
        question: "What checks should I make before buying a vehicle?",
        paragraphs: [
          [
            text(
              "See the vehicle in person where you can. Check the documents, who you are dealing with, who owns the vehicle, and whether any finance is still outstanding. An independent inspection or history check is worth considering before you pay.",
            ),
          ],
          [
            text(
              "Do not send a deposit or the purchase price until you are satisfied. This is general guidance, not legal advice. The ",
            ),
            link("/safety", "buyer safety page"),
            text(" sets out the same practical points, and "),
            link("/vehicle-check", "Vehicle Check"),
            text(" can add registration information. It does not replace those checks."),
          ],
        ],
      },
      {
        id: "how-do-i-know-if-a-seller-is-private-or-a-dealer",
        question: "How do I know whether a vehicle is being sold privately or by a dealer?",
        paragraphs: [
          [
            text(
              "Each listing is labelled Private Seller or Dealer. A dealer listing can show the business name, a phone number when the dealer has provided one, and a link to that dealer's profile.",
            ),
          ],
          [
            text("Search can also be filtered by seller type. Dealer profiles are collected on the "),
            link("/dealers", "dealers page"),
            text("."),
          ],
        ],
      },
    ],
  },
  {
    id: "selling-privately",
    title: "Selling Privately",
    items: [
      {
        id: "how-do-i-advertise-a-vehicle",
        question: "How do I advertise a vehicle on iTrader?",
        paragraphs: [
          [
            text(
              "Create an account if you need one. You must be 18 or over. Open ",
            ),
            link("/sell", "Sell"),
            text(
              " and follow the private listing flow. Add the vehicle details and photographs, confirm the seller declaration, and pay the fee shown at checkout.",
            ),
          ],
          [
            text(
              "The listing is then reviewed. Once it is approved, it stays live for the advertising period unless it is removed earlier. A dealer account uses the dealer listing flow instead. The ",
            ),
            link("/private-seller-terms", "Private Seller Terms"),
            text(" explain the private advertising rules, and "),
            link("/pricing", "current prices"),
            text(" are on the pricing page."),
          ],
        ],
      },
      {
        id: "how-much-does-a-private-listing-cost",
        question: "How much does it cost to advertise a vehicle?",
        paragraphs: [
          [
            text(
              "The private listing fee, any current launch offer, and the Featured upgrade price are shown on the ",
            ),
            link("/pricing", "pricing page"),
            text(
              ". Checkout charges the price shown there, including any launch offer that is currently available. You are paying to advertise on iTrader, not for a guaranteed sale.",
            ),
          ],
          [
            text("A standard private listing runs for "),
            text(`${LISTING_DURATION_DAYS} days`),
            text(". See "),
            link(
              "/faq#how-long-does-a-private-listing-stay-live",
              "how long a private listing stays live",
            ),
            text(" and the "),
            link("/refunds", "Refund Policy"),
            text(" if you need the refund rules."),
          ],
        ],
      },
      {
        id: "how-long-does-a-private-listing-stay-live",
        question: "How long does a private listing stay live?",
        paragraphs: [
          [
            text(`A private listing stays live for ${LISTING_DURATION_DAYS} days from publication, unless it is removed sooner.`),
          ],
          [
            text(
              "Marking the vehicle as sold takes it out of live search before then. Editing the listing does not start the period again. When it expires, you can renew it by paying the fee then shown on the ",
            ),
            link("/pricing", "pricing page"),
            text("."),
          ],
        ],
      },
      {
        id: "can-i-advertise-more-than-one-vehicle",
        question: "Can I advertise more than one vehicle?",
        paragraphs: [
          [
            text(
              "Yes. Each vehicle needs its own listing. A private seller can advertise more than one vehicle. A dealer can advertise up to the active-listing allowance on their plan.",
            ),
          ],
          [
            text("Several vehicles cannot be placed in one listing. See the "),
            link("/acceptable-use", "Acceptable Use Policy"),
            text(" and "),
            link("/faq#what-dealer-plans-are-available", "dealer plans"),
            text("."),
          ],
        ],
      },
      {
        id: "can-i-advertise-a-vehicle-i-do-not-own",
        question: "Can I advertise a vehicle I do not own?",
        paragraphs: [
          [
            text(
              "Only if you have the owner's permission. The account holder must be 18 or over. If the owner is under 18, an adult can advertise the vehicle on their own account and is responsible for the listing.",
            ),
          ],
          [
            text(
              "Do not advertise a stolen vehicle, or one you are not allowed to sell. You confirm authority, mileage and the other listing declarations before you submit. The ",
            ),
            link("/private-seller-terms", "Private Seller Terms"),
            text(" set this out."),
          ],
        ],
      },
      {
        id: "can-a-business-use-a-private-seller-account",
        question: "Can a business use a Private Seller account?",
        paragraphs: [
          [
            text(
              "No. A private seller account is only for a genuine private sale. It must not be used to disguise commercial vehicle trading.",
            ),
          ],
          [
            text(
              "If iTrader reasonably believes you are selling in the course of a business, it may require a dealer account. Dealer advertising uses the monthly dealer plans on the ",
            ),
            link("/pricing", "pricing page"),
            text(". Read the "),
            link("/dealer-terms", "Dealer Terms"),
            text(" and the "),
            link("/private-seller-terms", "Private Seller Terms"),
            text("."),
          ],
        ],
      },
    ],
  },
  {
    id: "vehicle-listings",
    title: "Vehicle Listings",
    items: [
      {
        id: "can-i-edit-my-listing",
        question: "Can I edit my listing after publishing it?",
        paragraphs: [
          [
            text("Yes, where the site allows it. Open "),
            link("/account/listings", "My listings"),
            text(
              " and choose Edit. If the advert is already live, the changes are checked before they replace what buyers can see. The current advert can stay online with the last approved details while that check happens.",
            ),
          ],
          [
            text(
              "iTrader may unpublish a listing during a review. An edit does not extend the advertising period. The ",
            ),
            link("/private-seller-terms", "Private Seller Terms"),
            text(" and "),
            link("/dealer-terms", "Dealer Terms"),
            text(" both describe this."),
          ],
        ],
      },
      {
        id: "how-do-i-mark-my-vehicle-as-sold",
        question: "How do I mark my vehicle as sold?",
        paragraphs: [
          [
            text(
              "Mark it as sold from the live listing, from My listings, or from the dealer dashboard if you are a dealer. Do this promptly once the vehicle is no longer available. It then leaves live search results. The listing page can still show it as sold.",
            ),
          ],
          [
            text(
              "Selling before the advertising period ends does not normally entitle you to a refund. See the ",
            ),
            link("/refunds", "Refund Policy"),
            text("."),
          ],
        ],
      },
      {
        id: "can-i-renew-a-listing",
        question: "Can I renew a listing?",
        paragraphs: [
          [
            text(
              "Yes. An expired listing can be renewed from My listings. Renewal asks you to pay again at the price then shown on the ",
            ),
            link("/pricing", "pricing page"),
            text(
              ". That starts another advertising period. It does not happen automatically.",
            ),
          ],
        ],
      },
      {
        id: "what-photographs-should-i-upload",
        question: "What photographs should I upload?",
        paragraphs: [
          [
            text(
              `Use real photographs of the vehicle you are advertising. Show the outside and the inside, and make the first photograph clear. At least two photographs are required. A private listing can include up to ${PRIVATE_LISTING_PHOTO_LIMIT} photographs. A dealer listing, or a private listing with Featured status, can include up to ${FEATURED_LISTING_PHOTO_LIMIT} photographs.`,
            ),
          ],
          [
            text(
              "Do not use stock images, photographs of a different vehicle, or pictures that hide damage. You need the right to use what you upload. Nudity and other unsuitable images are not allowed. The ",
            ),
            link("/acceptable-use", "Acceptable Use Policy"),
            text(" covers prohibited content."),
          ],
        ],
      },
      {
        id: "can-i-advertise-a-category-n-or-category-s-vehicle",
        question: "Can I advertise a Category N or Category S vehicle?",
        paragraphs: [
          [
            text(
              "Category N and Category S vehicles may be advertised only when that category is clearly and prominently stated in the listing. Other written-off vehicles must not be advertised.",
            ),
          ],
          [
            text(
              "The seller declaration asks you to confirm that any Category N or Category S write-off is disclosed, and that the vehicle is not a prohibited write-off. Hiding the category, or advertising a different write-off category, can lead to the listing being rejected or removed. See the ",
            ),
            link("/acceptable-use", "Acceptable Use Policy"),
            text(" and the "),
            link("/private-seller-terms", "Private Seller Terms"),
            text("."),
          ],
        ],
      },
      {
        id: "can-i-advertise-number-plates-or-vehicle-parts",
        question: "Can I advertise number plates or vehicle parts?",
        paragraphs: [
          [
            text(
              "No. Number plates and vehicle parts are not accepted, unless iTrader expressly allows a category later. A listing has to be for one vehicle only.",
            ),
          ],
          [
            text("The "),
            link("/acceptable-use", "Acceptable Use Policy"),
            text(" is the rule for what can be advertised."),
          ],
        ],
      },
    ],
  }
];
