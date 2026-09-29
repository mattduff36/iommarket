// Only these informational pages are public; payment/account routes stay protected.
export function isPaymentReturnPath(pathname: string): boolean {
  return ["/pay/success", "/pay/failed", "/pay/cancelled"].includes(pathname);
}
