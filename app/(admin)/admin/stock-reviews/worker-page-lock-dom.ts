import { isStockWorkerScrollbarEvent, scrollStockWorkerPage } from "./worker-page-scroll";

const FOCUSABLE = 'button,a[href],input,select,textarea,[tabindex],[contenteditable="true"]';
const NATIVE_INPUTS = 'button,input,select,textarea,[contenteditable]:not([contenteditable="false"])';
type InertState = { before: string | null; applied: string | null };

function footerControls(footer: HTMLElement) {
  return [...footer.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(element =>
    element.tabIndex >= 0 && !element.matches(":disabled") && !element.closest("[inert],[hidden]")
    && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden");
}

/** Keep native scroll hit testing intact; capture all non-footer interactions instead of making scroll containers inert. */
export function lockStockWorkerPage(footer: HTMLElement, options: {
  onBlockedClick?: () => void; warningViewport?: HTMLElement | null;
} = {}) {
  const previousFocus = document.activeElement;
  const previousTabIndex = footer.getAttribute("tabindex");
  const changed = new Map<Element, InertState>();
  let scrollTarget: EventTarget | null = null;
  const overlay = document.createElement("div");
  overlay.dataset.stockWorkerBackdrop = "";
  overlay.setAttribute("aria-hidden", "true");
  overlay.style.cssText = "position:fixed;inset:0;z-index:2147483646;pointer-events:none;";
  const panels = Array.from({ length: 4 }, () => {
    const panel = document.createElement("div");
    panel.style.cssText = "position:absolute;background:rgba(0,0,0,0.35);pointer-events:none;";
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
    if (options.warningViewport) options.warningViewport.style.maxHeight = `${top}px`;
  }

  function restore(element: Element, state: InertState) {
    if (element.getAttribute("inert") !== state.applied) return;
    if (state.before === null) element.removeAttribute("inert");
    else element.setAttribute("inert", state.before);
  }

  function isolate() {
    if (!footer.isConnected) return;
    const desired = new Map<Element, string | null>();
    // Native pickers can open before click cancellation on touch browsers. Isolate
    // the controls themselves so their surrounding panels retain native scrolling.
    for (const element of document.querySelectorAll(NATIVE_INPUTS)) {
      if (!footer.contains(element) && !element.contains(footer)) desired.set(element, "");
    }
    for (let node: HTMLElement | null = footer; node; node = node.parentElement) desired.set(node, null);
    for (const [element, state] of changed) {
      if (!desired.has(element)) { restore(element, state); changed.delete(element); }
    }
    for (const [element, value] of desired) {
      const before = element.getAttribute("inert");
      if (value === null ? before === null : before !== null) continue;
      if (!changed.has(element)) changed.set(element, { before, applied: value });
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
    event.stopImmediatePropagation();
    const scrollbar = isStockWorkerScrollbarEvent(event);
    if (scrollbar && ["pointerdown", "pointerup", "mousedown", "mouseup"].includes(event.type)) return;
    event.preventDefault();
    if (event.type === "click" && !scrollbar) options.onBlockedClick?.();
  }

  function gesture(event: Event) {
    scrollTarget = event.composedPath()[0] ?? event.target;
    if (containsEvent(event)) return;
    // Cancelling touch/pointer defaults would also cancel native panning and nested scrolling.
    event.stopImmediatePropagation();
  }

  function pointer(event: PointerEvent) {
    if (event.pointerType === "touch") gesture(event);
    else blockOutside(event);
  }

  function keepFocus(event: FocusEvent) {
    if (!containsEvent(event)) { event.stopImmediatePropagation(); focusFooter(); }
  }

  function footerKeyboard(event: KeyboardEvent) {
    if (!containsEvent(event) || !(event.target instanceof Element)) return false;
    return Boolean(event.target.closest('input,select,textarea,[contenteditable="true"],[role="slider"],[role="menu"]')
      || (["Enter", " "].includes(event.key) && event.target.closest('button,a[href],[role="button"]')));
  }

  function finishKeyboard(event: KeyboardEvent) {
    if (footerKeyboard(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function keyboard(event: KeyboardEvent) {
    if (event.key !== "Tab") {
      if (footerKeyboard(event)) return;
      scrollStockWorkerPage(event, scrollTarget ?? event.target);
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    const controls = footerControls(footer);
    if (!controls.length) { footer.focus({ preventScroll: true }); return; }
    const current = controls.findIndex(element => element === document.activeElement);
    const next = current < 0 ? (event.shiftKey ? controls.length - 1 : 0)
      : (current + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
    (controls[next] ?? footer).focus({ preventScroll: true });
  }

  const blocked = ["mousedown", "mouseup", "click", "auxclick", "dblclick", "contextmenu", "beforeinput", "input", "change", "submit", "reset", "paste", "cut", "copy", "dragstart", "dragover", "drop", "selectstart"];
  const gestures = ["wheel", "touchstart", "touchmove", "touchend", "touchcancel", "pointermove", "pointerover", "pointerout", "mouseover", "mouseout", "mousemove"];
  const capture = { capture: true, passive: false };
  for (const event of blocked) window.addEventListener(event, blockOutside, capture);
  for (const event of gestures) window.addEventListener(event, gesture, { capture: true, passive: true });
  window.addEventListener("pointerdown", pointer, capture);
  window.addEventListener("pointerup", pointer, capture);
  window.addEventListener("keydown", keyboard, true);
  window.addEventListener("keypress", finishKeyboard, true);
  window.addEventListener("keyup", finishKeyboard, true);
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
    for (const event of blocked) window.removeEventListener(event, blockOutside, true);
    for (const event of gestures) window.removeEventListener(event, gesture, true);
    window.removeEventListener("pointerdown", pointer, true);
    window.removeEventListener("pointerup", pointer, true);
    window.removeEventListener("keydown", keyboard, true);
    window.removeEventListener("keypress", finishKeyboard, true);
    window.removeEventListener("keyup", finishKeyboard, true);
    window.removeEventListener("focusin", keepFocus, true);
    window.removeEventListener("resize", measure);
    window.removeEventListener("scroll", measure, true);
    window.visualViewport?.removeEventListener("resize", measure);
    window.visualViewport?.removeEventListener("scroll", measure);
    for (const [element, state] of changed) restore(element, state);
    overlay.remove();
    if (previousTabIndex === null) footer.removeAttribute("tabindex");
    else footer.setAttribute("tabindex", previousTabIndex);
    if ((footer.contains(document.activeElement) || document.activeElement === document.body)
      && previousFocus instanceof HTMLElement && previousFocus.isConnected
      && !previousFocus.closest("[inert],[hidden]") && !previousFocus.matches(":disabled")) {
      previousFocus.focus({ preventScroll: true });
    }
  };
}
