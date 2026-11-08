const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End", " "]);

/** Keyboard focus stays in the dock; scroll the area being inspected instead. */
export function scrollStockWorkerPage(event: KeyboardEvent, target: EventTarget | null) {
  if (!SCROLL_KEYS.has(event.key) || event.altKey || event.ctrlKey || event.metaKey) return false;
  const root = document.scrollingElement ?? document.documentElement;
  const candidates: Element[] = [];
  for (let node = target instanceof Element && target.isConnected ? target : null; node; node = node.parentElement) {
    if (node !== root) candidates.push(node);
  }
  const results = document.querySelector("[data-stock-worker-content]");
  if (results && !candidates.includes(results)) candidates.push(results);
  candidates.push(root);
  const horizontal = event.key === "ArrowLeft" || event.key === "ArrowRight";
  const backwards = ["ArrowUp", "ArrowLeft", "PageUp", "Home"].includes(event.key) || (event.key === " " && event.shiftKey);
  for (const element of candidates) {
    const style = getComputedStyle(element);
    if (element !== root && !/auto|scroll|overlay/.test(horizontal ? style.overflowX : style.overflowY)) continue;
    const size = horizontal ? element.clientWidth : element.clientHeight;
    const extent = horizontal ? element.scrollWidth : element.scrollHeight;
    const position = horizontal ? element.scrollLeft : element.scrollTop;
    if (extent <= size || (backwards ? position <= 0 : position >= extent - size)) continue;
    const distance = event.key === "Home" || event.key === "End" ? extent
      : event.key.startsWith("Arrow") ? 40 : size * 0.9;
    const delta = distance * (backwards ? -1 : 1);
    element.scrollBy({ top: horizontal ? 0 : delta, left: horizontal ? delta : 0 });
    break;
  }
  return true;
}

/** Native scrollbar presses need their defaults, unlike page controls. */
export function isStockWorkerScrollbarEvent(event: Event) {
  if (!(event instanceof MouseEvent) || !(event.target instanceof HTMLElement)) return false;
  const element = event.target;
  const root = document.scrollingElement;
  if (element === root) {
    return (event.clientX >= document.documentElement.clientWidth && event.clientX < window.innerWidth)
      || (event.clientY >= document.documentElement.clientHeight && event.clientY < window.innerHeight);
  }
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  const left = rect.left + element.clientLeft;
  const top = rect.top + element.clientTop;
  const right = left + element.clientWidth;
  const bottom = top + element.clientHeight;
  const borderLeft = parseFloat(style.borderLeftWidth) || 0;
  const borderRight = parseFloat(style.borderRightWidth) || 0;
  const borderBottom = parseFloat(style.borderBottomWidth) || 0;
  const vertical = element.scrollHeight > element.clientHeight && /auto|scroll|overlay/.test(style.overflowY)
    && event.clientY >= top && event.clientY < bottom
    && ((event.clientX >= right && event.clientX < rect.right - borderRight)
      || (event.clientX >= rect.left + borderLeft && event.clientX < left));
  const horizontal = element.scrollWidth > element.clientWidth && /auto|scroll|overlay/.test(style.overflowX)
    && event.clientX >= left && event.clientX < right
    && event.clientY >= bottom && event.clientY < rect.bottom - borderBottom;
  return vertical || horizontal;
}
