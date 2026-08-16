import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SiteHeader } from "@/components/layout/site-header";

const authMocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  signOut: vi.fn(),
  unsubscribe: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("next/image", () => ({
  default: ({ alt }: { alt: string }) => <span aria-label={alt} role="img" />,
}));

vi.mock("@/components/auth/header-auth-buttons", () => ({
  HeaderAuthButtons: ({ authState }: { authState: { loading: boolean } }) => (
    <span data-testid="header-auth-state">
      {authState.loading ? "loading" : "ready"}
    </span>
  ),
}));

vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({
    auth: {
      getSession: authMocks.getSession,
      signOut: authMocks.signOut,
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: authMocks.unsubscribe } },
      }),
    },
  }),
}));

describe("SiteHeader auth initialization", () => {
  beforeEach(() => {
    authMocks.getSession.mockReset();
    authMocks.signOut.mockReset();
    authMocks.unsubscribe.mockReset();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-anon-key");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("handles an aborted session request without logging an error", async () => {
    const cancellation = Object.assign(new Error("signal is aborted without reason"), {
      name: "AbortError",
    });
    authMocks.getSession.mockRejectedValueOnce(cancellation);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    render(<SiteHeader />);

    await waitFor(() => {
      expect(
        screen
          .getAllByTestId("header-auth-state")
          .every((element) => element.textContent === "ready"),
      ).toBe(true);
    });
    expect(consoleError).not.toHaveBeenCalled();
  });
});
