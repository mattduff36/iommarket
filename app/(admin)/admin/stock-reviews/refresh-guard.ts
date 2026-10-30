export function canRefreshStockPage() {
  const focus = document.activeElement;
  return document.visibilityState !== "hidden" && !document.querySelector('[role="dialog"],dialog[open],[data-stock-review-editing="true"]') &&
    !(focus instanceof HTMLElement && (focus.matches('input:not([type="checkbox"]),textarea,select,[contenteditable="true"]')));
}
