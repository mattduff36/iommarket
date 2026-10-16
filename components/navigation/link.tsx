"use client";

import NextLink from "next/link";
import { forwardRef, useImperativeHandle, useRef } from "react";
import { useTrackedNavigation } from "./navigation-pending";

/** Keep Next prefetch/link semantics; track its supported navigation callback. */
const Link = forwardRef<HTMLAnchorElement, React.ComponentProps<typeof NextLink>>(function Link(
  { onNavigate, replace, scroll, ...props }, forwardedRef,
) {
  const anchor = useRef<HTMLAnchorElement>(null);
  useImperativeHandle(forwardedRef, () => anchor.current!, []);
  const router = useTrackedNavigation();
  return <NextLink {...props} ref={anchor} replace={replace} scroll={scroll} onNavigate={(event) => {
    let cancelled = false;
    onNavigate?.({ preventDefault() { cancelled = true; event.preventDefault(); } });
    if (cancelled || !anchor.current || !router) return;
    const url = new URL(anchor.current.href);
    if (url.pathname === window.location.pathname && url.search === window.location.search) return;
    event.preventDefault();
    router[replace ? "replace" : "push"](url.pathname + url.search + url.hash, { scroll });
  }} />;
});

export default Link;
