const FOCUSABLE = 'button,a[href],input,select,textarea,[tabindex],[contenteditable="true"]';

/** Isolate the background while leaving the live queue and the real footer in their original stacking contexts. */
export function lockStockWorkerPage(footer: HTMLElement, queue: HTMLElement) {
  const previousFocus = document.activeElement;
  const previousTabIndex = footer.getAttribute("tabindex");
  const previousOverflow = document.documentElement.style.overflow;
  const previousGutter = document.documentElement.style.scrollbarGutter;
  if (document.documentElement.clientWidth < window.innerWidth) document.documentElement.style.scrollbarGutter = "stable";
  document.documentElement.style.overflow = "hidden";
  footer.setAttribute("tabindex", "-1");

  const backdrop = document.createElement("div");
  backdrop.dataset.stockWorkerBackdrop = "";
  backdrop.setAttribute("aria-hidden", "true");
  backdrop.style.cssText = "position:fixed;inset:0;z-index:2147483646;pointer-events:none;";
  // Cut out the footer, including its open activity drawer, even in a transformed admin shell.
  const panels = Array.from({ length: 4 }, () => {
    const panel = document.createElement("div");
    panel.style.cssText = "position:absolute;background:rgba(6,8,12,.62);backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px);pointer-events:auto;touch-action:none";
    backdrop.append(panel);
    return panel;
  });
  document.body.append(backdrop);
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
      Object.assign(panel.style, { left: x+"px", top: y+"px", width: w+"px", height: h+"px" });
    });
    queue.style.height = top+"px";
  }

  const isolated = new Set<Element>();
  const ancestorInert = new Map<Element,string>();
  function isolate() {
    const path = new Set<Element>([footer,queue,backdrop]);
    for (const node of [footer,queue,backdrop]) {
      for (let ancestor = node.parentElement; ancestor; ancestor = ancestor.parentElement) path.add(ancestor);
    }
    for (const parent of path) {
      const prior = parent.getAttribute("inert");
      if (prior !== null) { if (!ancestorInert.has(parent)) ancestorInert.set(parent,prior); parent.removeAttribute("inert"); }
      if (parent === footer || parent === queue || parent === backdrop || parent === document.documentElement) continue;
      for (const child of parent.children) {
        if (!path.has(child) && !child.hasAttribute("inert")) { child.setAttribute("inert",""); isolated.add(child); }
      }
    }
  }
  function allowed(event: Event) {
    const path = event.composedPath();
    return path.includes(footer) || path.includes(queue);
  }
  function blockOutside(event: Event) {
    if (allowed(event)) return;
    if (event.cancelable) event.preventDefault();
    event.stopImmediatePropagation();
  }
  function controls() {
    return [queue,footer].flatMap(region => [...region.querySelectorAll<HTMLElement>(FOCUSABLE)])
      .filter(element => element.tabIndex >= 0 && !element.matches(":disabled") && !element.closest("[inert],[hidden]") &&
        element.getClientRects().length && getComputedStyle(element).visibility !== "hidden");
  }
  function focusFooter() {
    const items = controls();
    (items.find(element => element.closest("[data-stock-worker-commands]")) ?? items.find(element => footer.contains(element)) ?? footer).focus({preventScroll:true});
  }
  function keyboard(event: KeyboardEvent) {
    if (event.key !== "Tab") { blockOutside(event); return; }
    event.preventDefault();
    event.stopImmediatePropagation();
    const items = controls();
    if (!items.length) { footer.focus({preventScroll:true}); return; }
    const current = items.indexOf(document.activeElement as HTMLElement);
    const next = current < 0 ? (event.shiftKey ? items.length-1 : 0) : (current + (event.shiftKey ? -1 : 1) + items.length) % items.length;
    items[next].focus({preventScroll:true});
  }
  function keepFocus(event: FocusEvent) { if (!allowed(event)) { event.stopImmediatePropagation(); focusFooter(); } }
  const blocked = ["pointerdown","pointerup","mousedown","mouseup","click","auxclick","dblclick","contextmenu","beforeinput","input","change","submit","reset","paste","cut","dragstart","drop","wheel","touchstart","touchmove","keypress","keyup"];
  const capture = {capture:true,passive:false};
  for (const event of blocked) window.addEventListener(event,blockOutside,capture);
  window.addEventListener("keydown",keyboard,true);
  window.addEventListener("focusin",keepFocus,true);
  window.addEventListener("resize",measure);
  window.addEventListener("scroll",measure,true);
  window.visualViewport?.addEventListener("resize",measure);
  const mutations = new MutationObserver(isolate);
  mutations.observe(document.body,{childList:true,subtree:true});
  const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
  for (let node: HTMLElement | null = footer; node; node = node.parentElement) resize?.observe(node);
  isolate(); measure();
  if (!footer.contains(document.activeElement) && !queue.contains(document.activeElement)) focusFooter();

  return () => {
    mutations.disconnect(); resize?.disconnect();
    for (const event of blocked) window.removeEventListener(event,blockOutside,true);
    window.removeEventListener("keydown",keyboard,true);
    window.removeEventListener("focusin",keepFocus,true);
    window.removeEventListener("resize",measure);
    window.removeEventListener("scroll",measure,true);
    window.visualViewport?.removeEventListener("resize",measure);
    for (const node of isolated) if (node.getAttribute("inert")==="") node.removeAttribute("inert");
    for (const [node,value] of ancestorInert) if (!node.hasAttribute("inert")) node.setAttribute("inert",value);
    backdrop.remove();
    document.documentElement.style.overflow = previousOverflow;
    document.documentElement.style.scrollbarGutter = previousGutter;
    if (previousTabIndex === null) footer.removeAttribute("tabindex"); else footer.setAttribute("tabindex",previousTabIndex);
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected && !previousFocus.closest("[inert],[hidden]") && !previousFocus.matches(":disabled")) previousFocus.focus({preventScroll:true});
  };
}
