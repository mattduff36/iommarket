import { createHash } from "node:crypto";

export function foundingManagedSlug(registryKey: string, sourceIdentityKey: string) {
  const digest = createHash("sha256")
    .update(`founding-listing:${registryKey}:${sourceIdentityKey}`)
    .digest("hex")
    .slice(0, 32);
  return `fd-${registryKey}-${digest}`;
}

export function oceanManagedSlug(sourceIdentityKey: string) {
  const digest = createHash("sha256")
    .update(`ocean-managed:${sourceIdentityKey}`)
    .digest("hex")
    .slice(0, 32);
  return `omv-${digest}`;
}
