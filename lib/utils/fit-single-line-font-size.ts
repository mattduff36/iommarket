export function fitSingleLineFontSize(
  availableWidth: number,
  measuredWidthAtBase: number,
  baseFontSize: number,
  minFontSize: number,
): number {
  if (availableWidth <= 0 || measuredWidthAtBase <= 0 || baseFontSize <= 0) {
    return baseFontSize;
  }

  if (measuredWidthAtBase <= availableWidth) {
    return baseFontSize;
  }

  return Math.max(
    minFontSize,
    (baseFontSize * availableWidth) / measuredWidthAtBase,
  );
}
