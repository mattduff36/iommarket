import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SiteHeader } from "@/components/layout/site-header";

const authMocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  signOut: vi.fn(),
  unsubscribe: vi.fn(),
  authStateChangeCallback: null as null | ((
    event: string,
    session: { user: { email: string } } | null,
  ) => void),
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
  HeaderAuthButtons: ({
    authState,
  }: {
    authState: {
      displayName: string | null;
      loading: boolean;
      role: string | null;
    };
  }) => (
    <>
      <span data-testid="header-auth-state">
        {authState.loading ? "loading" : "ready"}
      </span>
      <span data-testid="header-auth-name">{authState.displayName}</span>
      <span data-testid="header-auth-role">{authState.role}</span>
    </>
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
      onAuthStateChange: (
        callback: NonNullable<typeof authMocks.authStateChangeCallback>,
      ) => {
        authMocks.authStateChangeCallback = callback;
        return {
          data: { subscription: { unsubscribe: authMocks.unsubscribe } },
        };
      },
    },
  }),
}));

describe("SiteHeader auth initialization", () => {
  beforeEach(() => {
    authMocks.getSession.mockReset();
    authMocks.signOut.mockReset();
    authMocks.unsubscribe.mockReset();
    authMocks.authStateChangeCallback = null;
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

  it("keeps the account control loading until the signed-in profile is ready", async () => {
    let resolveProfile!: (response: {
      ok: boolean;
      json: () => Promise<{ name: string; role: string }>;
    }) => void;
    const profileResponse = new Promise<{
      ok: boolean;
      json: () => Promise<{ name: string; role: string }>;
    }>((resolve) => {
      resolveProfile = resolve;
    });
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(profileResponse));
    authMocks.getSession.mockResolvedValue({
      data: { session: null },
    });

    render(<SiteHeader />);
    await waitFor(() => {
      expect(screen.getByTestId("header-auth-state")).toHaveTextContent("ready");
    });

    act(() => {
      authMocks.authStateChangeCallback?.("SIGNED_IN", {
        user: { email: "admin@mpdee.co.uk" },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId("header-auth-state")).toHaveTextContent("loading");
    });
    expect(screen.getByTestId("header-auth-name")).toHaveTextContent("");
    expect(screen.getByTestId("header-auth-role")).toHaveTextContent("");

    resolveProfile({
      ok: true,
      json: async () => ({ name: "Admin (mpdee)", role: "ADMIN" }),
    });

    await waitFor(() => {
      expect(screen.getByTestId("header-auth-state")).toHaveTextContent("ready");
      expect(screen.getByTestId("header-auth-name")).toHaveTextContent(
        "Admin (mpdee)",
      );
      expect(screen.getByTestId("header-auth-role")).toHaveTextContent("ADMIN");
    });
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

  it("uses two columns for public and account links, and one column for session actions", async () => {
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
      expect(screen.getByTestId("mobile-menu-account")).toBeTruthy();
    });

    expect(screen.getByTestId("mobile-menu-public").className).toContain("grid-cols-2");
    expect(screen.getByTestId("mobile-menu-account").className).toContain("grid-cols-2");
    expect(screen.getByTestId("mobile-menu-session").className).not.toContain("grid-cols-2");
    expect(screen.getByTestId("mobile-menu-session").className).toContain("flex-col");
    expect(screen.getByTestId("mobile-menu-session")).toHaveTextContent("Admin area");
    expect(screen.getByTestId("mobile-menu-session")).toHaveTextContent("Sign out");
    expect(screen.getByTestId("mobile-menu-account")).not.toHaveTextContent("Admin area");
  });
});
