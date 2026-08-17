export function allocateSharedPence(
  markedTotal: bigint,
  projectIds: readonly string[],
  ourProjectId: string,
): { share: bigint; denominator: number; membership: string[] } {
  const membership = [...new Set(projectIds)].sort();
  if (membership.length === 0) {
    return { share: BigInt(0), denominator: 0, membership };
  }

  const denominator = membership.length;
  const base = markedTotal / BigInt(denominator);
  const remainder = markedTotal - base * BigInt(denominator);
  const remainderCount = remainder < BigInt(0) ? -remainder : remainder;
  const bump = remainder < BigInt(0) ? BigInt(-1) : BigInt(1);
  const extraIds = new Set(membership.slice(0, Number(remainderCount)));
  const share = membership.includes(ourProjectId)
    ? base + (extraIds.has(ourProjectId) ? bump : BigInt(0))
    : BigInt(0);

  return { share, denominator, membership };
}
