import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "@playwright/test";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { lockStockWorkerPage } from "@/app/(admin)/admin/stock-reviews/worker-page-lock-dom";

declare global {
  interface Window {
    StockWorkerPageLock: { lockStockWorkerPage: typeof lockStockWorkerPage };
    releaseStockWorkerLock: () => void;
    stockLockClicks: Record<string, number>;
    stockLockWarnings: number;
  }
}

let browser: Browser;
let page: Page;
let productionCode: string;

beforeAll(async () => {
  const result = await build({
    entryPoints: [resolve(process.cwd(), "app", "(admin)", "admin", "stock-reviews", "worker-page-lock-dom.ts")],
    bundle: true, write: false, format: "iife", globalName: "StockWorkerPageLock", platform: "browser",
  });
  productionCode = result.outputFiles[0].text;
  browser = await chromium.launch({ headless: true, ignoreDefaultArgs: ["--hide-scrollbars"] });
});
afterAll(async () => { await browser?.close(); });
afterEach(async () => { await page?.close(); });
beforeEach(async () => {
  page = await browser.newPage({ viewport: { width: 1200, height: 850 }, hasTouch: true });
  await page.setContent(`<!doctype html><html><head><style>
    * { box-sizing: border-box } body { margin: 0; background: white }
    header { height: 64px; position: relative; z-index: 10000; background: white }
    button, input, a { display: inline-block; min-height: 44px; padding: 10px }
    .shell { display: flex; transform: translateZ(0) } aside { width: 180px; flex-shrink: 0 }
    main { padding: 16px; flex: 1; min-width: 0 } .viewport { height: calc(100vh - 96px); display: flex; flex-direction: column }
    #content { flex: 1; min-height: 0; overflow: auto } footer { flex-shrink: 0; background: white; border-top: 2px solid blue }
    .row { display: flex; align-items: center; flex-wrap: wrap; gap: 8px } .details { flex: 1; min-width: 140px }
    #activity { height: 240px; max-height: 35vh; overflow: auto } .spacer { height: 240px }
    @media(max-width: 600px) { aside { display: none } }
  </style></head><body>
    <header><button id="header">Header navigation</button></header>
    <div class="shell"><aside><a id="sidebar" href="#other">Sidebar navigation</a></aside>
      <main><div class="viewport"><section id="content"><button id="review">Edit review</button>
        <input id="editor" aria-label="Review text"><p id="live">Live result 1</p>
        <div id="nested" style="height:160px;overflow:auto"><button id="nested-edit">Nested review action</button><div style="height:1300px">Nested saved results</div></div>
        <div style="height:1800px">Saved results</div>
      </section><footer aria-label="Stock Update" id="dock"><div class="row">
        <button id="toggle" aria-expanded="false">Show activity</button><div class="details">Stock Update: processing Island Motors</div>
        <div data-stock-worker-commands><button id="stop">Stop safely</button></div>
      </div><div id="activity" hidden>Recent worker activity<div style="height:800px">Processing updates</div></div></footer></div></main>
    </div><div id="prior" inert="preserve-me"><button>Already unavailable</button></div><div class="spacer"></div>
  </body></html>`);
  await page.addScriptTag({ content: productionCode });
  await page.evaluate(() => {
    window.stockLockClicks = {};
    window.stockLockWarnings = 0;
    for (const id of ["header", "sidebar", "review", "nested-edit", "stop"]) {
      document.getElementById(id)!.addEventListener("click", () => { window.stockLockClicks[id] = (window.stockLockClicks[id] ?? 0) + 1; });
    }
    document.getElementById("toggle")!.addEventListener("click", () => {
      const activity = document.getElementById("activity")!;
      activity.hidden = !activity.hidden;
      document.getElementById("toggle")!.setAttribute("aria-expanded", String(!activity.hidden));
    });
  });
});

async function lock() {
  await page.evaluate(() => {
    window.releaseStockWorkerLock = window.StockWorkerPageLock.lockStockWorkerPage(document.getElementById("dock")!, {
      onBlockedClick: () => { window.stockLockWarnings += 1; },
    });
  });
}
async function clickPoint(selector: string) {
  const rect = await page.locator(selector).boundingBox();
  if (!rect) throw new Error(`Missing bounds for ${selector}`);
  await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
}
async function expectFooterUncovered() {
  // ResizeObserver and scroll callbacks update the cut-out before the next paint.
  await page.waitForFunction(() => {
    const footer = document.getElementById("dock")!;
    const rect = footer.getBoundingClientRect();
    const width = window.innerWidth;
    const height = window.innerHeight;
    const left = Math.max(0, Math.min(width, rect.left));
    const right = Math.max(left, Math.min(width, rect.right));
    const top = Math.max(0, Math.min(height, rect.top));
    const bottom = Math.max(top, Math.min(height, rect.bottom));
    const expected = [[0, 0, width, top], [0, top, left, bottom - top], [right, top, width - right, bottom - top], [0, bottom, width, height - bottom]];
    const panels = [...document.querySelectorAll("[data-stock-worker-backdrop] > div")];
    return panels.length === 4 && panels.every((panel, index) => {
      const bounds = panel.getBoundingClientRect();
      return [bounds.x, bounds.y, bounds.width, bounds.height].every((value, axis) => Math.abs(value - expected[index][axis]) <= 1);
    }) && [[rect.left + 2, rect.top + 2], [rect.right - 2, rect.bottom - 2]]
      .every(([x, y]) => footer.contains(document.elementFromPoint(x, y)));
  });
  expect(await page.evaluate(() => {
    const footer = document.getElementById("dock")!;
    const rect = footer.getBoundingClientRect();
    const points = [[rect.left + 2, rect.top + 2], [rect.right - 2, rect.bottom - 2]];
    return points.every(([x, y]) => footer.contains(document.elementFromPoint(x, y)));
  })).toBe(true);
}

async function wheelOver(selector: string, delta: number) {
  const rect = await page.locator(selector).boundingBox();
  if (!rect) throw new Error(`Missing bounds for ${selector}`);
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.wheel(0, delta);
}

async function swipeUp(selector: string) {
  const rect = await page.locator(selector).boundingBox();
  if (!rect) throw new Error(`Missing bounds for ${selector}`);
  const session = await page.context().newCDPSession(page);
  const x = rect.x + rect.width / 2;
  const start = Math.min(rect.y + rect.height - 15, 650);
  try {
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: start }] });
    for (let step = 1; step <= 8; step += 1) {
      await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: start - step * 12 }] });
      await page.waitForTimeout(16);
    }
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } finally { await session.detach(); }
  // Wait for native fling scrolling to finish before testing a separate footer tap.
  await page.locator(selector).evaluate(async element => {
    let previous = element.scrollTop;
    let stable = 0;
    for (let frame = 0; frame < 120 && stable < 5; frame += 1) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const next = element.scrollTop;
      stable = next === previous ? stable + 1 : 0;
      previous = next;
    }
    if (stable < 5) throw new Error("Touch scrolling did not settle");
  });
}

describe("production stock worker page isolation in Chromium", () => {
  it("scrolls real nested results, the page and footer activity with the wheel, without warnings", async () => {
    await lock();
    expect(await page.locator("[data-stock-worker-backdrop] > div").evaluateAll(elements => elements.every(element => getComputedStyle(element).pointerEvents === "none"))).toBe(true);
    await wheelOver("#nested", 120);
    await page.waitForFunction(() => document.getElementById("nested")!.scrollTop >= 80);
    expect(await page.locator("#content").evaluate(element => element.scrollTop)).toBe(0);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await page.evaluate(() => { const nested = document.getElementById("nested")!; nested.scrollTop = nested.scrollHeight; });
    await wheelOver("#nested", 160);
    await page.waitForFunction(() => document.getElementById("content")!.scrollTop >= 80);
    await page.mouse.move(50, 400);
    await page.mouse.wheel(0, 80);
    await page.waitForFunction(() => window.scrollY >= 40);
    await expectFooterUncovered();
    await page.locator("#toggle").click();
    await wheelOver("#activity", 120);
    await page.waitForFunction(() => document.getElementById("activity")!.scrollTop >= 80);
    expect(await page.evaluate(() => window.stockLockWarnings)).toBe(0);
    await clickPoint("#stop");
    expect(await page.evaluate(() => window.stockLockClicks.stop)).toBe(1);
    expect(await page.evaluate(() => window.stockLockWarnings)).toBe(0);
    await page.evaluate(() => window.releaseStockWorkerLock());
    const position = await page.locator("#activity").evaluate(element => element.scrollTop);
    await wheelOver("#activity", 100);
    await page.waitForFunction(previous => document.getElementById("activity")!.scrollTop > previous, position);
  });

  it("allows native scrollbar dragging without treating it as a blocked click", async () => {
    await page.addStyleTag({ content: "#nested::-webkit-scrollbar { width:16px } #nested::-webkit-scrollbar-thumb { background:#888 }" });
    await lock();
    const bar = await page.locator("#nested").evaluate(element => {
      if (!(element instanceof HTMLElement)) throw new Error("Expected HTML scroll container");
      const rect = element.getBoundingClientRect();
      const gutter = element.offsetWidth - element.clientWidth;
      return { x: rect.right - (gutter > 0 ? gutter / 2 : 8),
        y: rect.top, height: rect.height, thumb: element.clientHeight * element.clientHeight / element.scrollHeight };
    });
    await page.mouse.move(bar.x, bar.y + Math.max(4, bar.thumb / 2));
    await page.mouse.down();
    await page.mouse.move(bar.x, bar.y + bar.height * 0.7, { steps: 8 });
    await page.mouse.up();
    await page.waitForFunction(() => document.getElementById("nested")!.scrollTop > 100);
    expect(await page.evaluate(() => window.stockLockWarnings)).toBe(0);
  });

  it("allows genuine touch panning of nested and outer results without a tap warning", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await lock();
    await swipeUp("#nested");
    await page.waitForFunction(() => document.getElementById("nested")!.scrollTop > 30);
    expect(await page.locator("#content").evaluate(element => element.scrollTop)).toBe(0);
    await swipeUp("#content");
    await page.waitForFunction(() => document.getElementById("content")!.scrollTop > 30);
    expect(await page.evaluate(() => window.stockLockWarnings)).toBe(0);
    await expectFooterUncovered();
    await page.locator("#stop").tap();
    expect(await page.evaluate(() => window.stockLockClicks.stop)).toBe(1);
    expect(await page.evaluate(() => window.stockLockWarnings)).toBe(0);
    // A stationary tap is blocked and warns, unlike the preceding scroll gestures.
    await page.touchscreen.tap(30, 30);
    expect(await page.evaluate(() => window.stockLockClicks.header)).toBeUndefined();
    expect(await page.evaluate(() => window.stockLockWarnings)).toBe(1);
  });

  it("supports page-scrolling keys in the inspected container while retaining footer keyboard activation", async () => {
    await lock();
    const bounds = await page.locator("#nested").boundingBox();
    await page.mouse.move(bounds!.x + 30, bounds!.y + 70);
    await page.keyboard.press("PageDown");
    await page.waitForFunction(() => document.getElementById("nested")!.scrollTop > 100);
    await page.keyboard.press("End");
    await page.waitForFunction(() => { const nested = document.getElementById("nested")!; return nested.scrollTop >= nested.scrollHeight - nested.clientHeight - 1; });
    await page.keyboard.press("Home");
    await page.waitForFunction(() => document.getElementById("nested")!.scrollTop === 0);
    await page.keyboard.press("ArrowDown");
    await page.waitForFunction(() => document.getElementById("nested")!.scrollTop >= 40);
    await page.keyboard.press("ArrowUp");
    await page.waitForFunction(() => document.getElementById("nested")!.scrollTop === 0);
    expect(await page.evaluate(() => window.stockLockWarnings)).toBe(0);
    await page.locator("#stop").focus();
    await page.keyboard.press("Space");
    expect(await page.evaluate(() => window.stockLockClicks.stop)).toBe(1);
    expect(await page.evaluate(() => window.stockLockWarnings)).toBe(0);
  });

  it("blocks page pointer/keyboard input and new portals, but keeps STOP and live rendering usable", async () => {
    await page.locator("#editor").focus();
    const before = await page.locator("#dock").boundingBox();
    await lock();
    expect(await page.locator("#dock").boundingBox()).toEqual(before);
    expect(await page.locator("html").evaluate(element => element.style.overflow)).toBe("");
    expect(await page.locator("#content").getAttribute("inert")).toBeNull();
    expect(await page.locator("#dock").evaluate(element => element.closest("[inert]") === null)).toBe(true);
    for (const selector of ["#header", "#sidebar", "#review"]) await clickPoint(selector);
    expect(await page.evaluate(() => window.stockLockClicks)).toEqual({});
    await page.locator("#editor").evaluate(element => element.focus());
    await page.keyboard.type("blocked-input");
    expect(await page.locator("#editor").inputValue()).toBe("");
    expect(await page.evaluate(() => window.stockLockClicks.stop)).toBeUndefined();
    for (const key of ["Tab", "Tab", "Shift+Tab", "Tab", "Tab", "Tab"]) {
      await page.keyboard.press(key);
      expect(await page.evaluate(() => document.getElementById("dock")!.contains(document.activeElement))).toBe(true);
    }
    await page.locator("#stop").focus();
    await page.keyboard.press("Enter");
    await clickPoint("#stop");
    expect(await page.evaluate(() => window.stockLockClicks.stop)).toBe(2);
    await page.evaluate(() => {
      const portal = document.createElement("div");
      portal.id = "portal";
      portal.style.cssText = "position:fixed;top:4px;right:4px;z-index:2147483646";
      portal.innerHTML = '<button id="portal-button">New page portal</button><input id="portal-editor" aria-label="Portal text">';
      portal.addEventListener("click", () => { window.stockLockClicks.portal = 1; });
      document.body.append(portal);
      // The event barrier covers the same task, before MutationObserver runs.
      portal.querySelector("button")!.click();
      const sibling = document.createElement("button");
      sibling.id = "new-sibling";
      sibling.textContent = "New page control";
      document.getElementById("dock")!.before(sibling);
    });
    expect(await page.locator("#portal").getAttribute("inert")).toBeNull();
    expect(await page.locator("#new-sibling").getAttribute("inert")).toBe("");
    expect(await page.locator("#portal-editor").getAttribute("inert")).toBe("");
    await clickPoint("#portal-button");
    expect(await page.evaluate(() => window.stockLockClicks.portal)).toBeUndefined();
    await page.locator("#portal-editor").evaluate(element => element.focus());
    await page.keyboard.type("blocked-portal-input");
    expect(await page.locator("#portal-editor").inputValue()).toBe("");
    await page.evaluate(() => {
      const live = document.getElementById("live")!;
      live.dataset.instance = "still-mounted";
      let count = 1;
      window.setInterval(() => { live.textContent = `Live result ${++count}`; }, 30);
    });
    await page.waitForFunction(() => document.getElementById("live")!.textContent !== "Live result 1");
    expect(await page.locator("#live").getAttribute("data-instance")).toBe("still-mounted");
    const warningsBeforeRelease = await page.evaluate(() => window.stockLockWarnings);
    await page.evaluate(() => window.releaseStockWorkerLock());
    expect(await page.locator("[data-stock-worker-backdrop]").count()).toBe(0);
    expect(await page.locator("html").evaluate(element => element.style.overflow)).toBe("");
    expect(await page.locator("#content").getAttribute("inert")).toBeNull();
    expect(await page.locator("#portal").getAttribute("inert")).toBeNull();
    expect(await page.locator("#prior").getAttribute("inert")).toBe("preserve-me");
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("editor");
    await page.keyboard.type("editable again");
    expect(await page.locator("#editor").inputValue()).toBe("editable again");
    await clickPoint("#header");
    expect(await page.evaluate(() => window.stockLockClicks.header)).toBe(1);
    expect(await page.evaluate(() => window.stockLockWarnings)).toBe(warningsBeforeRelease);
  });

  it("keeps the in-flow mobile/expanded footer uncovered through resize and scroll without jumps", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator("#review").focus();
    const initialBounds = await page.locator("#dock").boundingBox();
    const scroll = await page.evaluate(() => window.scrollY);
    await lock();
    expect(await page.locator("#dock").boundingBox()).toEqual(initialBounds);
    expect(await page.evaluate(() => window.scrollY)).toBe(scroll);
    await expectFooterUncovered();
    await page.locator("#toggle").click();
    await page.waitForFunction(() => document.getElementById("toggle")!.getAttribute("aria-expanded") === "true");
    await expectFooterUncovered();
    const expanded = await page.locator("#dock").boundingBox();
    expect(expanded!.height).toBeGreaterThan(initialBounds!.height);
    expect(expanded!.y + expanded!.height).toBeLessThanOrEqual(844);
    const dimmer = await page.locator("[data-stock-worker-backdrop] > div").evaluateAll(elements => elements.map(element => ({ rect: element.getBoundingClientRect().toJSON(), color: getComputedStyle(element).backgroundColor })));
    expect(dimmer.every(panel => panel.color === "rgba(0, 0, 0, 0.35)")).toBe(true);
    await page.setViewportSize({ width: 480, height: 720 });
    await page.evaluate(() => window.scrollTo(0, 12));
    await page.waitForFunction(() => window.scrollY === 12);
    await expectFooterUncovered();
    await clickPoint("#review");
    expect(await page.evaluate(() => window.stockLockClicks.review)).toBeUndefined();
    await page.locator("#stop").tap();
    await clickPoint("#stop");
    expect(await page.evaluate(() => window.stockLockClicks.stop)).toBe(2);
    const beforeRelease = await page.locator("#dock").boundingBox();
    const beforeScroll = await page.evaluate(() => window.scrollY);
    await page.evaluate(() => window.releaseStockWorkerLock());
    expect(await page.locator("#dock").boundingBox()).toEqual(beforeRelease);
    expect(await page.evaluate(() => window.scrollY)).toBe(beforeScroll);
    expect(await page.locator("#dock").evaluate(element => getComputedStyle(element).position)).toBe("static");
  });

  it("isolates native picker/edit controls while their panels scroll and restores them on unlock", async () => {
    await page.evaluate(() => {
      const controls = document.createElement("div");
      controls.innerHTML = '<select id="native-select" style="width:160px;height:44px"><option value="one">First computer</option><option value="two">Second computer</option></select><input id="native-check" type="checkbox"><input id="native-range" type="range" value="40"><input id="native-prior" inert="preserve-control">';
      document.getElementById("content")!.prepend(controls);
    });
    await lock();
    expect(await page.locator("#content").getAttribute("inert")).toBeNull();
    for (const id of ["native-select", "native-check", "native-range"]) {
      expect(await page.locator("#" + id).getAttribute("inert")).toBe("");
    }
    for (const id of ["native-select", "native-check"]) {
      const bounds = await page.locator("#" + id).boundingBox();
      await page.touchscreen.tap(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
    }
    expect(await page.locator("#native-select").inputValue()).toBe("one");
    expect(await page.locator("#native-check").isChecked()).toBe(false);
    expect(await page.evaluate(() => window.stockLockWarnings)).toBe(2);
    await wheelOver("#nested", 120);
    await page.waitForFunction(() => document.getElementById("nested")!.scrollTop > 30);
    expect(await page.evaluate(() => window.stockLockWarnings)).toBe(2);
    await page.evaluate(() => window.releaseStockWorkerLock());
    for (const id of ["native-select", "native-check", "native-range"]) {
      expect(await page.locator("#" + id).getAttribute("inert")).toBeNull();
    }
    expect(await page.locator("#native-prior").getAttribute("inert")).toBe("preserve-control");
    await clickPoint("#native-check");
    expect(await page.locator("#native-check").isChecked()).toBe(true);
  });

  it("restores prior ancestor inert/tabindex, tolerates disabled controls, and cleans up on removal", async () => {
    await page.locator("#review").focus();
    await page.evaluate(() => {
      document.querySelector("main")!.setAttribute("inert", "prior-ancestor");
      document.getElementById("dock")!.setAttribute("tabindex", "3");
      for (const button of document.querySelectorAll<HTMLButtonElement>("#dock button")) button.disabled = true;
    });
    await lock();
    expect(await page.locator("main").getAttribute("inert")).toBeNull();
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("dock");
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("dock");
    await page.evaluate(() => window.releaseStockWorkerLock());
    expect(await page.locator("main").getAttribute("inert")).toBe("prior-ancestor");
    expect(await page.locator("#dock").getAttribute("tabindex")).toBe("3");
    await page.evaluate(() => document.querySelector("main")!.removeAttribute("inert"));
    await page.locator("#header").focus();
    await lock();
    await page.evaluate(() => {
      document.querySelector("main")!.remove();
      window.releaseStockWorkerLock();
    });
    expect(await page.locator("[data-stock-worker-backdrop]").count()).toBe(0);
    expect(await page.locator("header").getAttribute("inert")).toBeNull();
    expect(await page.locator("#prior").getAttribute("inert")).toBe("preserve-me");
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("header");
    await page.keyboard.press("Enter");
    expect(await page.evaluate(() => window.stockLockClicks.header)).toBe(1);
  });
});
