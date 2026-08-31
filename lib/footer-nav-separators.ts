const DEFAULT_LINE_TOLERANCE_PX = 1;

/**
 * Returns whether the separator before each item after the first should show.
 * A dot is visible only when that item shares a line with the previous item.
 */
export function sameLineSeparatorVisibility(
  lineStarts: readonly number[],
  tolerance = DEFAULT_LINE_TOLERANCE_PX,
): boolean[] {
  if (lineStarts.length < 2) {
    return [];
  }

  return lineStarts.slice(0, -1).map((lineStart, index) => {
    const next = lineStarts[index + 1] ?? lineStart;
    return Math.abs(lineStart - next) <= tolerance;
  });
}
