import type { FaqCategory } from "@/lib/faq/types";
import { link, text, supportEmail, FEATURED_LISTING_PHOTO_LIMIT, starterListingCap, proListingCap } from "@/lib/faq/copy";

export const serviceFaqCategories: FaqCategory[] = [
{
    id: "payments-featured-listings-and-refunds",
    title: "Payments, Featured Listings & Refunds",
    items: [
      {
        id: "what-is-a-featured-listing",
        question: "What is a Featured Listing?",
        paragraphs: [
          [
            text(
              "Featured is an optional upgrade that gives a listing extra visibility. It does not guarantee views, a particular place in search, enquiries or a sale. The current Featured price is on the ",
            ),
            link("/pricing", "pricing page"),
            text("."),
          ],
          [
            text(
              "Once Featured status has been applied, that fee is not normally refunded. A refund, credit or replacement may be considered where Featured exposure was not provided because of a significant technical failure caused by iTrader. The ",
            ),
            link("/refunds", "Refund Policy"),
            text(" explains the detail. This is not legal advice."),
          ],
        ],
      },
      {
        id: "what-happens-if-my-payment-fails",
        question: "What happens if my payment fails?",
        paragraphs: [
          [
            text(
              "Listing fees, Featured upgrades and dealer subscriptions are taken by Ripple, the payment provider. iTrader does not store your full card details. If a private listing payment fails, or you cancel checkout, the draft is kept so you can try again. The advert is not published as a paid listing until payment succeeds.",
            ),
          ],
          [
            text(
              "If a dealer subscription payment fails, dealer listings may be suspended until payment is completed. The ",
            ),
            link("/dealer-terms", "Dealer Terms"),
            text(" and "),
            link("/terms", "Terms"),
            text(" describe failed payments."),
          ],
        ],
      },
      {
        id: "can-i-get-a-refund",
        question: "Can I get a refund if my vehicle sells early?",
        paragraphs: [
          [
            text(
              "Not ordinarily. Selling the vehicle before the advertising period ends, or changing your mind after the advert has started, does not normally create a refund of the listing fee or a Featured upgrade. You can still mark the vehicle as sold.",
            ),
          ],
          [
            text(
              "A refund may be considered in other cases, such as a duplicate charge, a fee taken in error, or a significant technical failure that stops a paid listing from being published. Rights that the law does not allow iTrader to exclude still apply. Read the ",
            ),
            link("/refunds", "Refund Policy"),
            text(" for the full account. This page is not legal advice."),
          ],
        ],
      },
      {
        id: "what-should-i-do-if-i-am-charged-twice",
        question: "What should I do if I am charged twice?",
        paragraphs: [
          [
            text("Email "),
            supportEmail,
            text(
              " with the account email, the date, the amount, and whether the charge was for a private listing, a Featured upgrade or a dealer subscription. If iTrader confirms a duplicate payment, the duplicate amount may be refunded to the original payment method.",
            ),
          ],
          [
            text("The steps are in the "),
            link("/refunds", "Refund Policy"),
            text(". You can also use the "),
            link("/contact", "contact page"),
            text("."),
          ],
        ],
      },
    ],
  },
  {
    id: "dealers",
    title: "Dealers",
    items: [
      {
        id: "how-do-i-join-itrader-as-a-dealer",
        question: "How do I join iTrader as a dealer?",
        paragraphs: [
          [
            text("Create an account, then compare the dealer plans on the "),
            link("/pricing", "pricing page"),
            text(
              ". You add the business name and contact details, accept the Dealer Terms, and pay the monthly subscription through Ripple. When the subscription is active, add each vehicle as its own listing and manage them from the dealer dashboard.",
            ),
          ],
          [
            text("iTrader may ask for evidence that the business is genuine. The "),
            link("/dealer-terms", "Dealer Terms"),
            text(" explain eligibility, and public dealer profiles are listed on the "),
            link("/dealers", "dealers page"),
            text(" while a subscription is current."),
          ],
        ],
      },
      {
        id: "what-dealer-plans-are-available",
        question: "What dealer plans are available?",
        paragraphs: [
          [
            text(
              `There are two monthly plans. Dealer Starter allows up to ${starterListingCap} active listings. Dealer Pro allows up to ${proListingCap}. Drafts, listings waiting for review, and live adverts count towards that limit. A vehicle marked as sold does not.`,
            ),
          ],
          [
            text(
              "Current monthly prices, and any offer, are on the pricing page. Dealer listings can include up to ",
            ),
            text(`${FEATURED_LISTING_PHOTO_LIMIT} photographs`),
            text(
              ". Each plan includes a dealer profile, and a phone number can be shown on the dealer's listings. Subscriptions renew each month until cancelled. Compare them on the ",
            ),
            link("/pricing", "pricing page"),
            text(" and in the "),
            link("/dealer-terms", "Dealer Terms"),
            text("."),
          ],
        ],
      },
      {
        id: "how-do-i-cancel-a-dealer-subscription",
        question: "How do I cancel a dealer subscription?",
        paragraphs: [
          [
            text("Email "),
            supportEmail,
            text(
              " to cancel. When the dealer dashboard shows a cancellation request, you can use that as well. iTrader cannot cancel the payment-provider subscription immediately from the site. Staff complete that cancellation. Cancellation takes effect at the end of the period already paid for. You keep dealer access until then, and a pro-rata refund is not normally given.",
            ),
          ],
          [
            text(
              "The Refund Policy says existing listings may remain live until the end of that paid period. Dealer profiles are shown publicly while the subscription is current. See the ",
            ),
            link("/refunds", "Refund Policy"),
            text(" and "),
            link("/dealer-terms", "Dealer Terms"),
            text("."),
          ],
        ],
      },
      {
        id: "can-buyers-contact-dealers",
        question: "Can buyers contact dealers through iTrader?",
        paragraphs: [
          [
            text(
              "Yes. Buyers use Contact Seller on the listing after they sign in. Dealer listings are labelled Dealer and can link to the dealer profile, where a phone number may also be shown.",
            ),
          ],
          [
            text(
              "A signed-in buyer can leave a written review on a dealer profile. A star rating can be left without an account. Reviews are the reviewer's opinion. They are moderated, and they are not a statement by iTrader. Profiles of dealers with a current subscription are on the ",
            ),
            link("/dealers", "dealers page"),
            text("."),
          ],
        ],
      },
    ],
  },
  {
    id: "accounts",
    title: "Accounts",
    items: [
      {
        id: "how-do-i-create-and-manage-an-account",
        question: "How do I create an account, reset my password or change my details?",
        paragraphs: [
          [
            text("Create an account from "),
            link("/sign-up", "sign up"),
            text(
              ". You must be 18 or over, and the details you give need to be accurate. To reset a password, use ",
            ),
            link("/forgot-password", "forgot password"),
            text(" and follow the email link. Signed-in users can change a password from "),
            link("/account/change-password", "change password"),
            text("."),
          ],
          [
            text("Display name, phone, region, bio and photo are updated in "),
            link("/account/profile", "Profile & Security"),
            text(
              ". You can also request an email change there. iTrader will ask you to confirm the new address from your inbox.",
            ),
          ],
        ],
      },
      {
        id: "can-i-close-my-account",
        question: "Can I close my account?",
        paragraphs: [
          [
            text("Signed-in users can delete an account from "),
            link("/account/profile", "Profile & Security"),
            text(
              ". Type DELETE MY ACCOUNT to confirm. iTrader then disables the account and removes its live listings from public view. A later step removes login credentials, profile identifiers and eligible media. Payments, subscriptions and audit records are kept. Deleting an account does not refund fees already paid.",
            ),
          ],
          [
            text("You can also close an account by emailing "),
            supportEmail,
            text(", which is the written-notice route in the "),
            link("/terms", "Terms"),
            text(". The "),
            link("/privacy", "Privacy Policy"),
            text(" explains how account information is handled after deletion."),
          ],
        ],
      },
    ],
  },
  {
    id: "vehicle-check",
    title: "Vehicle Check",
    items: [
      {
        id: "what-is-itrader-vehicle-check",
        question: "What is iTrader Vehicle Check?",
        paragraphs: [
          [
            text(
              "Vehicle Check is an information service. You can run it without an account. Depending on the registration, the result may include DVLA vehicle data, DVSA MOT history, Isle of Man Government vehicle information, and possible auction references. It accepts UK and Isle of Man registrations.",
            ),
          ],
          [
            text(
              "The records come from third-party and public sources. They can be incomplete, delayed or wrong. Before a check is run, the page asks you to acknowledge the current ",
            ),
            link("/vehicle-check-terms", "Vehicle Check Terms"),
            text(" in your browser. Start a check from "),
            link("/vehicle-check", "Vehicle Check"),
            text("."),
          ],
        ],
      },
      {
        id: "does-a-vehicle-check-guarantee-the-vehicle",
        question: "Does a Vehicle Check guarantee a vehicle is problem-free?",
        paragraphs: [
          [
            text(
              "No. A Vehicle Check does not mean a vehicle is problem-free, safe to buy, or correctly described. It is not a finance check, proof of identity or ownership, or a substitute for inspecting the vehicle and its documents.",
            ),
          ],
          [
            text(
              "iTrader does not create the underlying records and does not warrant that a result is complete or accurate. The ",
            ),
            link("/vehicle-check-terms", "Vehicle Check Terms"),
            text(" explain the limits. Buying checks are on the "),
            link("/safety", "buyer safety page"),
            text("."),
          ],
        ],
      },
    ],
  },
  {
    id: "safety-and-moderation",
    title: "Safety & Moderation",
    items: [
      {
        id: "how-does-itrader-moderate-listings",
        question: "How does iTrader moderate listings?",
        paragraphs: [
          [
            text(
              "iTrader can review a listing before or after it is published. A listing can be rejected, changed, unpublished or removed if it is inaccurate, misleading, a duplicate, a prohibited vehicle, or otherwise breaks the rules. A listing going live does not mean iTrader has inspected the vehicle or verified the seller.",
            ),
          ],
          [
            text(
              "If a listing is removed because it breaks the rules, a refund is not normally given. Where the problem can be corrected, you may be able to change the listing and submit it again. The ",
            ),
            link("/acceptable-use", "Acceptable Use Policy"),
            text(", "),
            link("/private-seller-terms", "Private Seller Terms"),
            text(" and "),
            link("/refunds", "Refund Policy"),
            text(" explain enforcement and refunds."),
          ],
        ],
      },
      {
        id: "what-should-i-do-if-a-listing-looks-suspicious",
        question: "What should I do if a listing looks suspicious?",
        paragraphs: [
          [
            text(
              "Do not send money. Use the report control on the listing and describe what concerned you. You can send a report without an account; the form asks for your email. If you think someone is trying to scam you, also email ",
            ),
            supportEmail,
            text("."),
          ],
          [
            text(
              "iTrader can remove a listing and may report suspected fraud to the police. It does not guarantee that every listing or message is genuine, and it does not hold deposits or the purchase price between buyers and sellers. Read ",
            ),
            link("/safety", "buyer safety"),
            text(" before you meet or pay anyone."),
          ],
        ],
      },
      {
        id: "does-itrader-resolve-disputes-between-buyers-and-sellers",
        question: "Does iTrader resolve disputes between buyers and sellers?",
        paragraphs: [
          [
            text(
              "No. The sale is only between the buyer and the seller. iTrader is not a party to that contract. It does not provide a dispute-resolution, mediation or arbitration service, and it does not insure the vehicle or hold the purchase money.",
            ),
          ],
          [
            text(
              "Buyers and sellers need to deal with condition, price, payment and delivery between themselves. iTrader may, if it chooses, help pass on a message or look into a listing that may break the rules. That does not decide the outcome of the sale. See ",
            ),
            link("/safety", "buyer safety"),
            text(", the "),
            link("/terms", "Terms"),
            text(", the "),
            link("/private-seller-terms", "Private Seller Terms"),
            text(" and the "),
            link("/dealer-terms", "Dealer Terms"),
            text("."),
          ],
        ],
      },
    ],
  },
  {
    id: "support",
    title: "Support",
    items: [
      {
        id: "how-do-i-contact-itrader",
        question: "How do I contact iTrader?",
        paragraphs: [
          [
            text("Email "),
            supportEmail,
            text(". The "),
            link("/contact", "contact page"),
            text(" uses the same address."),
          ],
          [
            text(
              "Include the account email you use on iTrader. For a listing, add the listing link. For a payment, add the date, the amount, and whether it was a private listing, a Featured upgrade or a dealer subscription. Say what you need help with, and include any reference the payment provider gave you.",
            ),
          ],
        ],
      },
    ],
  }
];
