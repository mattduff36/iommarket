// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HoldingHeader } from "@/components/layout/holding-header";
import { SiteHeader } from "@/components/layout/site-header";

const authMocks = vi.hoisted(() => ({
  pathname: "/",
  getSession: vi.fn(),
  signOut: vi.fn(),
  unsubscribe: vi.fn(),
  authStateChangeCallback: null as null | ((
    event: string,
    session: { user: { email: string } } | null,
  ) => void),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => authMocks.pathname,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("next/dynamic", () => ({ default: () => ({ listingId, open }: { listingId: string; open: boolean }) => open ? <section role="dialog">Admin editor for {listingId}</section> : null }));

vi.mock("@/components/admin/listing-edit-dialog", () => ({
  ListingEditDialog: ({ listingId, open }: { listingId: string; open: boolean }) =>
    open ? <section role="dialog">Admin editor for {listingId}</section> : null,
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
    authMocks.pathname = "/";
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
        json: async () => ({ name: "Admin", role: "ADMIN", stagingFeaturesEnabled: true }),
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

  it("opens the admin editor from a listing's mobile menu", async () => {
    authMocks.pathname = "/listings/cmtestlisting";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ name: "Admin", role: "ADMIN" }) }));
    authMocks.getSession.mockResolvedValue({ data: { session: { user: { email: "admin@example.test" } } } });
    const user = userEvent.setup();
    render(<SiteHeader />);
    await waitFor(() => expect(screen.getByTestId("header-auth-state")).toHaveTextContent("ready"));
    await user.click(screen.getByRole("button", { name: "Toggle menu" }));
    await user.click(within(screen.getByTestId("mobile-menu-session")).getByRole("button", { name: "Edit as Admin" }));
    expect(await screen.findByRole("dialog")).toHaveTextContent("cmtestlisting");
  });

  it("places Edit as Admin in the desktop utility strip only for an admin on a listing", async () => {
    authMocks.pathname = "/listings/cmtestlisting";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ name: "Admin", role: "ADMIN" }) }));
    authMocks.getSession.mockResolvedValue({ data: { session: { user: { email: "admin@example.test" } } } });
    const user = userEvent.setup();
    const view = render(<SiteHeader />);
    await waitFor(() => expect(screen.getByTestId("header-auth-role")).toHaveTextContent("ADMIN"));

    const desktopEdit = within(screen.getByTestId("utility-strip")).getByRole("button", { name: "Edit as Admin" });
    expect(desktopEdit.className).toMatch(/text-red-/);
    await user.click(desktopEdit);
    expect(await screen.findByRole("dialog")).toHaveTextContent("cmtestlisting");

    view.unmount();
    authMocks.pathname = "/search";
    render(<SiteHeader />);
    await waitFor(() => expect(screen.getByTestId("header-auth-role")).toHaveTextContent("ADMIN"));
    expect(within(screen.getByTestId("utility-strip")).queryByRole("button", { name: "Edit as Admin" })).toBeNull();
  });

  it("does not offer Edit as Admin to a member viewing a listing", async () => {
    authMocks.pathname = "/listings/cmtestlisting";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ name: "Member", role: "USER" }) }));
    authMocks.getSession.mockResolvedValue({ data: { session: { user: { email: "member@example.test" } } } });
    const user = userEvent.setup();
    render(<SiteHeader />);
    await waitFor(() => expect(screen.getByTestId("header-auth-role")).toHaveTextContent("USER"));
    expect(within(screen.getByTestId("utility-strip")).queryByRole("button", { name: "Edit as Admin" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Toggle menu" }));
    expect(screen.queryByRole("button", { name: "Edit as Admin" })).toBeNull();
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

  it("shows the marketplace tagline in red on a preview site", async () => {
    authMocks.getSession.mockResolvedValue({ data: { session: null } });
    render(<SiteHeader previewSite />);
    await waitFor(() => {
      expect(screen.getAllByTestId("header-auth-state").every((element) => element.textContent === "ready")).toBe(true);
    });
    const tagline = within(screen.getByTestId("utility-strip")).getByText(
      "The Isle of Man's Trusted Vehicle Marketplace",
    );
    expect(tagline.className).toContain("text-red-500");
    const menu = screen.getByRole("button", { name: "Toggle menu" });
    expect(menu.className).toContain("text-red-500");
    expect(menu.className).toContain("hover:text-red-500");
    expect(menu.className).not.toContain("hover:text-text-primary");
    await userEvent.setup().click(menu);
    expect(menu).toHaveAttribute("aria-expanded", "true");
    expect(menu.className).toContain("text-red-500");
  });

  it("keeps the production marketplace tagline colour", async () => {
    authMocks.getSession.mockResolvedValue({ data: { session: null } });
    render(<SiteHeader />);
    await waitFor(() => {
      expect(screen.getAllByTestId("header-auth-state").every((element) => element.textContent === "ready")).toBe(true);
    });
    const tagline = within(screen.getByTestId("utility-strip")).getByText(
      "The Isle of Man's Trusted Vehicle Marketplace",
    );
    expect(tagline.className).not.toContain("text-red-500");
    expect(screen.getByRole("button", { name: "Toggle menu" }).className).not.toContain("text-red-500");
  });
});

describe("preview marketplace tagline", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
  });

  it("uses red on the holding header when the deployment is a preview", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    render(<HoldingHeader />);
    expect(screen.getByText("The Isle of Man's Trusted Vehicle Marketplace").className).toContain(
      "text-red-500",
    );
  });

  it("keeps the holding header tagline colour outside preview", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    render(<HoldingHeader />);
    const tagline = screen.getByText("The Isle of Man's Trusted Vehicle Marketplace");
    expect(tagline.className).toContain("text-metallic-400");
    expect(tagline.className).not.toContain("text-red-500");
  });
});
