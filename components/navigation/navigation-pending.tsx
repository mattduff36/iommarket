"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { PageSkeleton, skeletonKind } from "./page-skeletons";

type Router = ReturnType<typeof useRouter>;
type Pending = { href: string; pathname: string; signingOut: boolean };
type NavigationState = {
  pending: Pending | null;
  slow: boolean;
  router: Router;
  beginSignOut: () => void;
  cancel: () => void;
};
const NavigationContext = createContext<NavigationState | null>(null);

export function NavigationProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, setPending] = useState<Pending | null>(null);
  const [slow, setSlow] = useState(false);
  const [isPending, startTransition] = useTransition();
  const sawTransition = useRef(false);
  const signingOut = useRef(false);
  const previousPath = useRef(pathname);

  const cancel = useCallback(() => { signingOut.current = false; setPending(null); setSlow(false); }, []);
  const navigate = useCallback((method: "push" | "replace", href: string, options?: Parameters<Router["push"]>[1]) => {
    const url = new URL(href, window.location.href);
    if (url.origin === window.location.origin && (url.pathname !== window.location.pathname || url.search !== window.location.search || signingOut.current)) {
      setSlow(false);
      setPending({ href: url.pathname + url.search + url.hash, pathname: url.pathname, signingOut: signingOut.current });
    }
    startTransition(() => router[method](href, options));
  }, [router]);

  useEffect(() => {
    if (isPending) sawTransition.current = true;
    else if (sawTransition.current) {
      sawTransition.current = false;
      if (!signingOut.current) setPending(null);
    }
  }, [isPending]);
  useEffect(() => {
    if (previousPath.current !== pathname) {
      previousPath.current = pathname;
      cancel();
    }
  }, [pathname, cancel]);
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => setSlow(true), 15000);
    return () => clearTimeout(timer);
  }, [pending]);
  // Observe full-document links and GET forms without cancelling their native action.
  // React/Next handlers have already run by the time these bubble to document.
  useEffect(() => {
    const showDocumentPending = (href: string) => {
      const url = new URL(href, window.location.href);
      if (url.origin !== window.location.origin) return;
      setSlow(false);
      setPending({ href: url.pathname + url.search + url.hash, pathname: url.pathname, signingOut: signingOut.current });
    };
    const click = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(link instanceof HTMLAnchorElement) || link.hasAttribute("download") || (link.target && link.target !== "_self")) return;
      const url = new URL(link.href);
      if (url.hash && url.pathname === window.location.pathname && url.search === window.location.search) return;
      showDocumentPending(link.href);
    };
    const submit = (event: SubmitEvent) => {
      if (event.defaultPrevented || !(event.target instanceof HTMLFormElement)) return;
      const form = event.target;
      const button = event.submitter as HTMLButtonElement | null;
      const method = button?.getAttribute("formmethod") ?? form.method;
      const target = button?.getAttribute("formtarget") ?? form.target;
      if (method.toLowerCase() !== "get" || (target && target !== "_self")) return;
      const url = new URL(button?.getAttribute("formaction") ?? form.action, window.location.href);
      url.search = new URLSearchParams(Array.from(new FormData(form, button).entries()).filter((entry): entry is [string, string] => typeof entry[1] === "string")).toString();
      showDocumentPending(url.href);
    };
    const reset = () => { if (!signingOut.current) cancel(); };
    document.addEventListener("click", click);
    document.addEventListener("submit", submit);
    window.addEventListener("pageshow", reset);
    return () => { document.removeEventListener("click", click); document.removeEventListener("submit", submit); window.removeEventListener("pageshow", reset); };
  }, [cancel]);
  const beginSignOut = useCallback(() => {
    signingOut.current = true;
    setSlow(false);
    setPending({ href: "/sign-in", pathname: "/sign-in", signingOut: true });
  }, []);
  const trackedRouter = useMemo(() => ({ ...router,
    push: (href: string, options?: Parameters<Router["push"]>[1]) => navigate("push", href, options),
    replace: (href: string, options?: Parameters<Router["replace"]>[1]) => navigate("replace", href, options),
  }), [router, navigate]);
  const value = useMemo(() => ({ pending, slow, router: trackedRouter, beginSignOut, cancel }), [pending, slow, trackedRouter, beginSignOut, cancel]);
  return <NavigationContext.Provider value={value}>
    {pending ? <div role="progressbar" aria-label="Page navigation" className="pointer-events-none fixed inset-x-0 top-0 z-[2000] h-1 animate-pulse bg-neon-blue-400 motion-reduce:animate-none" /> : null}
    {children}
  </NavigationContext.Provider>;
}

export function useNavigationRouter(): Router {
  const context = useContext(NavigationContext);
  const router = useRouter();
  return context?.router ?? router;
}

export function useTrackedNavigation() { return useContext(NavigationContext)?.router; }

export function useSignOutLoading() {
  const context = useContext(NavigationContext);
  return { begin: context?.beginSignOut ?? (() => {}), cancel: context?.cancel ?? (() => {}) };
}

export function NavigationContent({ children, className, scope }: { children: React.ReactNode; className?: string; scope?: string | string[] }) {
  const context = useContext(NavigationContext);
  const pathname = usePathname();
  const pending = context?.pending;
  // Nested shells retain their sidebar for moves within the same area.
  const scopes = typeof scope === "string" ? [scope] : scope ?? [];
  const inArea = (path: string, area: string) => path === area || path.startsWith(area + "/");
  const retainedShell = scopes.some((area) => inArea(pathname, area) && pending && inArea(pending.pathname, area));
  const active = pending && (pending.signingOut || !retainedShell);
  const replaceContent = active && (pending.signingOut || pending.pathname !== pathname);
  return (
    <div className={className} aria-busy={Boolean(active)} data-navigation-content="">
      {replaceContent ? <PageSkeleton kind={skeletonKind(pending.pathname)} label={pending.signingOut ? "Signing out…" : "Loading page…"} /> : null}
      {active && !replaceContent ? <p role="status" className="flex items-center gap-2 px-4 py-2 text-sm text-text-secondary"><span aria-hidden="true" className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" />Updating results…</p> : null}
      {active && context?.slow ? <div role="status" className="px-6 py-4 text-sm">This is taking longer than usual. <a className="underline" href={pending.href}>Open the page again</a></div> : null}
      <div hidden={Boolean(replaceContent)} inert={replaceContent ? true : undefined}>{children}</div>
    </div>
  );
}
