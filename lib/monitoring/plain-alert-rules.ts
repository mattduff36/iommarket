import { isMetaMaskNoise, isWebKitBridgeNoise } from "./browser-noise";

export interface PlainAlertContext {
  text: string;
  title: string;
  message: string;
  lines: string[];
  action: string;
  page: string;
}

export interface PlainAlertMatch {
  problem: string;
  detail?: string;
  summary: string;
  check: string;
  impact?: string;
  subject?: string;
}

function sentencePage(page: string): string {
  return page.charAt(0).toUpperCase() + page.slice(1);
}

function prismaCall(text: string): { model: string; op: string } | null {
  const match = text.match(/prisma\.(\$[A-Za-z0-9_]+|[A-Za-z0-9_]+)(?:\.([A-Za-z0-9_]+))?\(\)/);
  if (!match?.[1]) return null;
  return { model: match[1], op: match[2] ?? "" };
}

function uniqueFields(text: string): string[] {
  const match = text.match(/Unique constraint failed on the fields:\s*\(([^)]+)\)/i);
  if (!match?.[1]) return [];
  return match[1]
    .split(",")
    .map((field) => field.replace(/[`"'\s]/g, ""))
    .filter((field) => field.length > 0);
}

function recordSentence(model: string, op: string): string | null {
  const noun: Record<string, string> = {
    user: "the account",
    listing: "the listing",
    listingStatusEvent: "the listing history",
    listingRevision: "the listing revision",
    subscription: "the subscription",
    payment: "the payments",
    dealerUpgradeAcceptance: "the dealer upgrade record",
    costEmailOutbox: "the invoice email",
    freeListingClaim: "free listings",
  };
  const name = noun[model];
  if (!name) return null;
  if (op === "count") return `The site could not count ${name}.`;
  if (op === "findMany" || op === "findFirst" || op === "findUnique") {
    return `The site could not load ${name}.`;
  }
  if (op === "create") return `The site could not create ${name}.`;
  if (op === "update") return `The site could not update ${name}.`;
  if (op === "delete" || op === "deleteMany") return `The site could not delete ${name}.`;
  return `The site could not finish a change to ${name}.`;
}

function accountRules(ctx: PlainAlertContext): PlainAlertMatch | null {
  const call = prismaCall(ctx.text);
  const fields = uniqueFields(ctx.text);
  if (call?.model === "user" && call.op === "create" && fields.includes("email")) {
    return {
      problem: "Sign-in problem",
      detail: "email already in use",
      summary: "A signed-in person could not get an account, because their email is already registered.",
      check: "that email",
      impact: "The site is still up.",
    };
  }
  if (/valid name is required to create an account profile/i.test(ctx.text)) {
    return {
      problem: "Account setup stopped",
      detail: "name missing",
      summary: "A signed-in person has no name saved, so the site could not finish setting up their account.",
      check: "that account",
      impact: "The site is still up.",
    };
  }
  if (call?.model === "subscription" && call.op === "create" && fields.includes("dealerId")) {
    return {
      problem: "Dealer signup problem",
      detail: "subscription already exists",
      summary: "A dealer could not finish joining, because they already have a subscription.",
      check: "that dealer",
      impact: "The site is still up.",
    };
  }
  if (fields.length > 0) {
    return {
      problem: "Save refused",
      detail: "a value is already in use",
      summary: "The site tried to save something that has to be unique, and that value is already in use.",
      check: "it",
      impact: "The site is still up.",
    };
  }
  return null;
}

function paymentRules(ctx: PlainAlertContext): PlainAlertMatch | null {
  if (/webhook rejected|failed HMAC|envelope checks/i.test(ctx.text)) {
    return {
      problem: "Payment notice rejected",
      summary: "A payment notice was turned away because it failed a security check.",
      check: "that payment notice",
      impact: "The site is still up.",
    };
  }
  if (/webhook quarantined|quarantined/i.test(ctx.text)) {
    return {
      problem: "Payment notice held back",
      summary: "A payment notice was held back and was not applied.",
      check: "that payment notice",
      impact: "The site is still up.",
    };
  }
  if (/no webhook receipt|checkout has no webhook/i.test(ctx.text)) {
    return {
      problem: "Payment confirmation missing",
      summary: "Someone started a payment, and no confirmation has arrived.",
      check: "that payment",
      impact: "The payment may be unfinished.",
    };
  }
  if (/webhook processing failed|webhook could not be applied/i.test(ctx.text)) {
    return {
      problem: "Payment notice not applied",
      summary: "A payment notice arrived, but the site could not apply it.",
      check: "that payment notice",
      impact: "The site is still up.",
    };
  }
  if (/RIPPLE_LISTING_PAYMENT_URL is not set/i.test(ctx.text)) {
    return {
      problem: "Checkout could not start",
      detail: "payment link missing",
      summary: "Checkout could not start, because the payment link is not configured.",
      check: "checkout",
      impact: "The site is still up.",
    };
  }
  if (/\b[A-Z][A-Z0-9_]+ is not set\b/.test(ctx.text)) {
    return {
      problem: "A feature could not run",
      detail: "a setting is missing",
      summary: "A feature could not run, because a required setting is missing.",
      check: "it",
      impact: "The site is still up.",
    };
  }
  if (/not a valid url/i.test(ctx.text)) {
    const dealerSignup = ctx.action === "createDealerSubscription";
    return {
      problem: dealerSignup ? "Dealer subscription not created" : "Invalid web address",
      summary: dealerSignup
        ? "A dealer subscription could not be created, because a web address in the payment setup is not valid."
        : "The site tried to use a web address that is not valid.",
      check: dealerSignup ? "that subscription" : "it",
      impact: "The site is still up.",
    };
  }
  if (/no such subscription/i.test(ctx.text)) {
    return {
      problem: "Subscription not cancelled",
      summary: "A subscription could not be cancelled, because the payment service has no record of it.",
      check: "that subscription",
      impact: "The site is still up.",
    };
  }
  if (/bucket not found/i.test(ctx.text)) {
    return {
      problem: "Dealer logo not saved",
      detail: "file storage is missing",
      summary: "A dealer logo could not be saved, because file storage is not set up.",
      check: "that logo",
      impact: "The site is still up.",
    };
  }
  return null;
}

function listingMailRules(ctx: PlainAlertContext): PlainAlertMatch | null {
  if (/listing notification sent/i.test(ctx.text)) {
    return {
      subject: "A listing email was sent",
      problem: "A listing email was sent",
      summary: "A listing email was sent.",
      check: "that email",
    };
  }
  if (/listing notification failed/i.test(ctx.text)) {
    if (/testing email address|example\.com/i.test(ctx.text)) {
      return {
        problem: "Listing email not sent",
        summary: "A listing email was not sent, because that address is not allowed by the email service.",
        check: "that email",
        impact: "The site is still up.",
      };
    }
    if (/domain is not verified/i.test(ctx.text)) {
      return {
        problem: "Listing email not sent",
        detail: "sending domain not verified",
        summary: "A listing email was not sent, because the itrader.im sending domain is not verified.",
        check: "that email",
        impact: "The site is still up.",
      };
    }
    return {
      problem: "Listing email not sent",
      summary: "A listing email was not sent.",
      check: "that email",
      impact: "The site is still up.",
    };
  }
  return null;
}

function dataRules(ctx: PlainAlertContext): PlainAlertMatch | null {
  if (/relation "listings" does not exist/i.test(ctx.text)) {
    return {
      problem: "Search is failing",
      detail: "listings are unavailable",
      summary: "Search could not run because the listings are not available.",
      check: "search",
      impact: "People using search will see a failure.",
    };
  }
  if (/dealer upgrade acceptance receipts are immutable/i.test(ctx.text)) {
    return {
      problem: "Account change blocked",
      summary: "An admin change was blocked because a dealer upgrade record is kept permanently and cannot be deleted.",
      check: "that account",
      impact: "The site is still up.",
    };
  }
  if (/expired transaction|timeout for this transaction/i.test(ctx.text)) {
    const summary =
      ctx.action === "setUserDisabled"
        ? "Disabling a user did not finish, because it ran out of time."
        : ctx.action === "requestProjectInvoice"
          ? "An invoice request did not finish, because it ran out of time."
          : `A change on ${ctx.page} did not finish, because it ran out of time.`;
    return {
      problem: "A task ran out of time",
      summary,
      check: "it",
      impact: "The site is still up.",
    };
  }
  if (/deserialize column of type 'void'|failed to deserialize column/i.test(ctx.text)) {
    const refund = ctx.action === "adminRefundSubscriptionPayment";
    return {
      problem: refund ? "A refund did not complete" : "A result could not be read",
      summary: refund
        ? "A refund could not be completed, because the site could not read the result."
        : "The site asked for a result and could not read it.",
      check: refund ? "that refund" : "it",
      impact: "The site is still up.",
    };
  }
  if (/relation "[^"]+" does not exist/i.test(ctx.text)) {
    return {
      problem: "Stored data is missing",
      summary: `The site could not find data it needs while someone was using ${ctx.page}.`,
      check: "it",
      impact: "That part of the site may fail until this is fixed.",
    };
  }
  const call = prismaCall(ctx.text);
  if (call?.model === "$queryRaw") {
    return {
      problem: "A data request failed",
      summary: `The site could not finish reading data on ${ctx.page}.`,
      check: "it",
      impact: "The site is still up.",
    };
  }
  if (call) {
    const summary = recordSentence(call.model, call.op);
    if (!summary) return null;
    return {
      problem: summary.replace(/\.$/, ""),
      summary,
      check: "it",
      impact: "The site is still up.",
    };
  }
  return null;
}

function browserRules(ctx: PlainAlertContext): PlainAlertMatch | null {
  const page = sentencePage(ctx.page);
  if (/minified react error #\d+/i.test(ctx.text)) {
    return {
      problem: "A page crashed in the browser",
      summary: `${page} crashed in the visitor's browser while it was loading.`,
      check: "that page",
      impact: "That visitor may have seen a broken page.",
    };
  }
  if (/server components render/i.test(ctx.text)) {
    return {
      problem: "A page failed to load",
      summary: `${page} failed while it was being prepared. The public error hides the detail.`,
      check: "that page",
      impact: "That page may not have loaded.",
    };
  }
  if (/only async functions are allowed to be exported in a "use server" file/i.test(ctx.text)) {
    return {
      problem: "An admin page could not load",
      summary: "An admin page could not load because an admin action is set up incorrectly.",
      check: "that page",
      impact: "The site is still up.",
    };
  }
  if (/functions cannot be passed directly to client components/i.test(ctx.text)) {
    return {
      problem: "An admin page crashed",
      summary: "An admin page crashed because part of it was sent to the browser in the wrong form.",
      check: "that page",
      impact: "The site is still up.",
    };
  }
  if (/invalid src prop .*next\/image|hostname "[^"]+" is not configured/i.test(ctx.text)) {
    const host = ctx.text.match(/hostname "([^"]+)"/i)?.[1] ?? "another website";
    return {
      problem: "An image could not be shown",
      summary: `A page could not show an image from ${host}, because that website is not on the allowed image list.`,
      check: "that page",
      impact: "The site is still up.",
    };
  }
  if (ctx.lines.some((line) => /^[\w$]+ is not defined\.?$/i.test(line))) {
    return {
      problem: "A page crashed",
      summary: `${page} crashed because a missing piece of the page was used.`,
      check: "that page",
      impact: "The site is still up.",
    };
  }
  if (/cannot read properties of undefined|undefined is not an object/i.test(ctx.text)) {
    if (isWebKitBridgeNoise(ctx.message)) {
      return {
        problem: "In-app browser error",
        summary: "A visitor's in-app browser reported an error.",
        check: "it",
        impact: "This usually comes from their phone browser.",
      };
    }
    return {
      problem: "A page crashed",
      summary: `${page} crashed because part of it was not ready.`,
      check: "that page",
      impact: "The site is still up.",
    };
  }
  if (isMetaMaskNoise(ctx.message)) {
    return {
      problem: "Wallet extension error",
      summary: "A visitor's wallet extension reported an error.",
      check: "it",
      impact: "This comes from their browser, not from an iTrader account.",
    };
  }
  if (/postMessage: Java object is gone/i.test(ctx.text)) {
    return {
      problem: "In-app browser error",
      summary: "A visitor's in-app browser lost its connection to the page.",
      check: "it",
      impact: "This usually comes from their phone browser.",
    };
  }
  if (/\{"isTrusted":true\}/i.test(ctx.text)) {
    return {
      problem: "Browser reported an empty error",
      summary: "The browser reported a generic page event, with no useful detail.",
      check: "it",
      impact: "This usually comes from the visitor's browser.",
    };
  }
  if (/signal is aborted without reason/i.test(ctx.text)) {
    return {
      problem: "A page request was cancelled",
      summary: "A page request was cancelled before it finished.",
      check: "it",
      impact: "This usually happens when someone leaves the page.",
    };
  }
  if (ctx.lines.some((line) => /^script error\.?$/i.test(line))) {
    return {
      problem: "Browser script error",
      summary: "The browser reported a script error and hid the detail.",
      check: "it",
      impact: "This often comes from another website's script.",
    };
  }
  if (
    ctx.lines.some((line) => /^load failed\.?$/i.test(line)) ||
    /failed to fetch rsc payload|typeerror: load failed/i.test(ctx.text)
  ) {
    if (/failed to fetch rsc payload/i.test(ctx.text)) {
      return {
        problem: "A page reloaded the ordinary way",
        summary: "A page did not load its latest content, so the browser opened it again in the normal way.",
        check: "that page",
        impact: "The site is still up.",
      };
    }
    return {
      problem: "A page did not finish loading",
      summary: `${page} did not finish loading.`,
      check: "that page",
      impact: "This is often a dropped connection.",
    };
  }
  if (/worker failed to load/i.test(ctx.text)) {
    return {
      problem: "Analytics map could not load",
      summary: "The analytics map could not load.",
      check: "the analytics page",
      impact: "The site is still up.",
    };
  }
  if (/unexpected response was received from the server/i.test(ctx.text)) {
    return {
      problem: "The browser got an unexpected reply",
      summary: "The browser received a reply it could not understand.",
      check: "that page",
      impact: "The site is still up.",
    };
  }
  if (/destination stream closed early/i.test(ctx.text)) {
    return {
      problem: "A page stopped loading",
      summary: `${page} stopped loading before it finished.`,
      check: "that page",
      impact: "The site is still up.",
    };
  }
  return null;
}

function looksTechnical(value: string): boolean {
  return /[`\\<>{}]|prisma|invocation|exception|undefined|chunk|https?:\/|\bP[0-9]{4}\b|\berror\b|\(\)|\/[A-Za-z]|[A-Z][A-Z0-9_]{2,}|\.[a-zA-Z]/u.test(value);
}

function plainTitle(ctx: PlainAlertContext): PlainAlertMatch | null {
  const title = ctx.title.trim();
  const message = ctx.message.trim();
  if (!title || looksTechnical(title)) return null;
  const summarySource = message && !looksTechnical(message) && message.length > title.length ? message : title;
  return {
    subject: title,
    problem: title,
    summary: summarySource.endsWith(".") ? summarySource : `${summarySource}.`,
    check: "it",
  };
}

export function matchPlainAlert(ctx: PlainAlertContext): PlainAlertMatch | null {
  return (
    accountRules(ctx) ??
    paymentRules(ctx) ??
    listingMailRules(ctx) ??
    dataRules(ctx) ??
    browserRules(ctx) ??
    plainTitle(ctx)
  );
}
