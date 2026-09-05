import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

vi.mock("@/actions/admin/preview-packs", () => ({
  enablePreviewPack: vi.fn(),
  disablePreviewPack: vi.fn(),
}));

vi.mock("@/actions/admin/preview-controls", () => ({
  getPreviewControls: vi.fn().mockResolvedValue({
    data: {
      packs: [],
      samplePrivateVisible: true,
      sampleDealerVisible: true,
    },
  }),
  setSampleListingVisibility: vi.fn(),
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
    vi.unstubAllGlobals();
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

  it("shows the mobile Preview packs expander for admins", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ name: "Admin", role: "ADMIN" }),
      }),
    );
    authMocks.getSession.mockResolvedValue({
      data: { session: { user: { email: "admin@mpdee.co.uk" } } },
    });

    const user = userEvent.setup();
    render(<SiteHeader />);
    await waitFor(() => {
      expect(screen.getByTestId("header-auth-state").textContent).toBe("ready");
    });
    await user.click(screen.getByRole("button", { name: "Toggle menu" }));
    await waitFor(() => {
      expect(screen.getByText("Preview packs")).toBeTruthy();
    });
  });

  it("hides the mobile Preview packs expander for members", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ name: "Member", role: "USER" }),
      }),
    );
    authMocks.getSession.mockResolvedValue({
      data: { session: { user: { email: "user@example.com" } } },
    });

    const user = userEvent.setup();
    render(<SiteHeader />);
    await waitFor(() => {
      expect(screen.getByTestId("header-auth-state").textContent).toBe("ready");
    });
    await user.click(screen.getByRole("button", { name: "Toggle menu" }));
    await waitFor(() => {
      expect(screen.getByText("Account overview")).toBeTruthy();
    });
    expect(screen.queryByText("Preview packs")).toBeNull();
  });
});
