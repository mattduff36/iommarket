type Router = {
  push: (...args: unknown[]) => void;
  replace: (...args: unknown[]) => void;
  refresh: (...args: unknown[]) => void;
  prefetch: (...args: unknown[]) => void;
  back: (...args: unknown[]) => void;
  forward: (...args: unknown[]) => void;
};

function createRouter(): Router {
  return {
    push() {},
    replace() {},
    refresh() {},
    prefetch() {},
    back() {},
    forward() {},
  };
}

export function useRouter(): Router {
  return createRouter();
}

export function usePathname(): string {
  return "/";
}

export function useSearchParams(): { get: (name: string) => string | null } {
  return { get: () => null };
}

export function useParams(): Record<string, string | string[] | undefined> {
  return {};
}

export function useSelectedLayoutSegment(): null {
  return null;
}

export function useSelectedLayoutSegments(): string[] {
  return [];
}

export function redirect(path: string): never {
  throw new Error(`redirect:${path}`);
}

export function permanentRedirect(path: string): never {
  throw new Error(`redirect:${path}`);
}

export function notFound(): never {
  throw new Error("notFound");
}

export function forbidden(): never {
  throw new Error("forbidden");
}

export function unauthorized(): never {
  throw new Error("unauthorized");
}
