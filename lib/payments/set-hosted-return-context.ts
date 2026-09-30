import { cookies } from "next/headers";
import { encodeHostedReturnContext, HOSTED_RETURN_COOKIE, HOSTED_RETURN_MAX_AGE_SECONDS } from "@/lib/payments/hosted-return-context";
import { checkoutRoutingCookie } from "@/lib/payments/staging-return-routing";

export async function setHostedReturnContext(input: Parameters<typeof encodeHostedReturnContext>[0]) {
  const store = await cookies();
  store.set(HOSTED_RETURN_COOKIE, encodeHostedReturnContext(input), {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax",
    path: "/", maxAge: HOSTED_RETURN_MAX_AGE_SECONDS,
  });
  const routing = checkoutRoutingCookie();
  if (routing) store.set(routing.name, routing.value, routing.options);
}
