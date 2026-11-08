const FOCUSABLE = 'button,a[href],input,select,textarea,[tabindex],[contenteditable="true"]';

function footerControls(footer: HTMLElement) {
  return [...footer.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(element =>
    element.tabIndex >= 0 && !element.matches(":disabled") && !element.closest("[inert],[hidden]")
    && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden");
}

/** Isolate the existing in-flow dock without moving or unmounting the live page. */
export function lockStockWorkerPage(footer: HTMLElement) {
  const previousFocus = document.activeElement;
  const previousTabIndex = footer.getAttribute("tabindex");
  const root = document.documentElement;
  const scrollStyles = ["overflow", "scrollbar-gutter"].map(property => ({
    property, value: root.style.getPropertyValue(property), priority: root.style.getPropertyPriority(property),
  }));
  // Hide the page scrollbar without shifting the footer; its activity scroller stays usable.
  const hadScrollbar = window.innerWidth > root.clientWidth;
  if (hadScrollbar) root.style.setProperty("scrollbar-gutter", "stable");
  root.style.setProperty("overflow", "hidden");
  const changed = new Map<Element, { before: string | null; applied: string | null }>();
  const overlay = document.createElement("div");
  overlay.dataset.stockWorkerBackdrop = "";
  overlay.setAttribute("aria-hidden", "true");
  overlay.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none;";
  const panels = Array.from({ length: 4 }, () => {
    const panel = document.createElement("div");
    panel.style.cssText = "position:absolute;background:rgba(0,0,0,0.20);pointer-events:auto;touch-action:none;";
    overlay.append(panel);
    return panel;
  });
  document.body.append(overlay);
  footer.setAttribute("tabindex", "-1");

  function measure() {
    const rect = footer.getBoundingClientRect();
    const width = window.innerWidth;
    const height = window.innerHeight;
    const left = Math.max(0, Math.min(width, rect.left));
    const right = Math.max(left, Math.min(width, rect.right));
    const top = Math.max(0, Math.min(height, rect.top));
    const bottom = Math.max(top, Math.min(height, rect.bottom));
    const sections = [[0, 0, width, top], [0, top, left, bottom - top],
      [right, top, width - right, bottom - top], [0, bottom, width, height - bottom]];
    panels.forEach((panel, index) => {
      const [x, y, w, h] = sections[index];
      Object.assign(panel.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
    });
  }

  function restore(element: Element, state: { before: string | null; applied: string | null }) {
    if (element.getAttribute("inert") !== state.applied) return;
    if (state.before === null) element.removeAttribute("inert");
    else element.setAttribute("inert", state.before);
  }

  function isolate() {
    if (!footer.isConnected) return;
    const desired = new Map<Element, string | null>();
    // Only ancestors of the dock stay traversable; every sibling branch is inert.
    for (let node: HTMLElement | null = footer; node; node = node.parentElement) {
      desired.set(node, null);
      if (node === document.body) break;
      for (const sibling of node.parentElement?.children ?? []) {
        if (sibling !== node && sibling !== overlay) desired.set(sibling, "");
      }
    }
    for (const [element, state] of changed) {
      if (!desired.has(element)) { restore(element, state); changed.delete(element); }
    }
    for (const [element, value] of desired) {
      const current = element.getAttribute("inert");
      if (value === null ? current === null : current !== null) continue;
      if (!changed.has(element)) changed.set(element, { before: current, applied: value });
      if (value === null) element.removeAttribute("inert");
      else element.setAttribute("inert", value);
    }
  }

  function focusFooter() {
    const controls = footerControls(footer);
    const command = controls.find(element => element.closest("[data-stock-worker-commands]"));
    (command ?? controls[0] ?? footer).focus({ preventScroll: true });
  }

  function containsEvent(event: Event) {
    return event.composedPath().includes(footer);
  }

  function blockOutside(event: Event) {
    if (containsEvent(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function keepFocus(event: FocusEvent) {
    if (!containsEvent(event)) { event.stopImmediatePropagation(); focusFooter(); }
  }

  function keyboard(event: KeyboardEvent) {
    if (event.key !== "Tab") { blockOutside(event); return; }
    event.preventDefault();
    event.stopImmediatePropagation();
    const controls = footerControls(footer);
    if (!controls.length) { footer.focus({ preventScroll: true }); return; }
    const current = controls.findIndex(element => element === document.activeElement);
    const next = current < 0 ? (event.shiftKey ? controls.length - 1 : 0)
      : (current + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
    (controls[next] ?? footer).focus({ preventScroll: true });
  }

  const pointerEvents = ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "contextmenu", "touchstart", "touchmove", "touchend", "wheel"];
  const capture = { capture: true, passive: false };
  for (const event of pointerEvents) window.addEventListener(event, blockOutside, capture);
  window.addEventListener("keydown", keyboard, true);
  window.addEventListener("keyup", blockOutside, true);
  window.addEventListener("focusin", keepFocus, true);
  window.addEventListener("resize", measure);
  window.addEventListener("scroll", measure, true);
  window.visualViewport?.addEventListener("resize", measure);
  window.visualViewport?.addEventListener("scroll", measure);
  isolate();
  measure();
  if (!footer.contains(document.activeElement)) focusFooter();

  const mutations = new MutationObserver(() => { isolate(); measure(); });
  mutations.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["inert", "hidden"] });
  const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
  for (let node: HTMLElement | null = footer; node; node = node.parentElement) resize?.observe(node);

  return () => {
    mutations.disconnect();
    resize?.disconnect();
    for (const event of pointerEvents) window.removeEventListener(event, blockOutside, true);
    window.removeEventListener("keydown", keyboard, true);
    window.removeEventListener("keyup", blockOutside, true);
    window.removeEventListener("focusin", keepFocus, true);
    window.removeEventListener("resize", measure);
    window.removeEventListener("scroll", measure, true);
    window.visualViewport?.removeEventListener("resize", measure);
    window.visualViewport?.removeEventListener("scroll", measure);
    for (const [element, state] of changed) restore(element, state);
    overlay.remove();
    for (const { property, value, priority } of scrollStyles) {
      const applied = property === "overflow" ? "hidden" : hadScrollbar ? "stable" : value;
      if (root.style.getPropertyValue(property) !== applied) continue;
      if (value) root.style.setProperty(property, value, priority);
      else root.style.removeProperty(property);
    }
    if (previousTabIndex === null) footer.removeAttribute("tabindex");
    else footer.setAttribute("tabindex", previousTabIndex);
    if ((footer.contains(document.activeElement) || document.activeElement === document.body)
      && previousFocus instanceof HTMLElement && previousFocus.isConnected
      && !previousFocus.closest("[inert],[hidden]") && !previousFocus.matches(":disabled")) {
      previousFocus.focus({ preventScroll: true });
    }
  };
}
