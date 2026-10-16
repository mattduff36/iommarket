// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { pushMock, refreshMock, signInMock, signOutMock, nextQuery } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
  signInMock: vi.fn(),
  signOutMock: vi.fn(),
  nextQuery: { value: "" },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
  useSearchParams: () => new URLSearchParams(nextQuery.value),
}));
vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({
    auth: { signInWithPassword: signInMock, signOut: signOutMock },
  }),
}));

import { SignInForm } from "@/components/auth/sign-in-form";
import { getSafeNextPath } from "@/lib/auth/return-path";

describe("staging sign-in form access decisions", () => {
  it("preserves encoded query values while checking redirect safety", () => {
    const path = "/search?q=red%26blue%23detail";
    expect(getSafeNextPath(path)).toBe(path);
    expect(getSafeNextPath("/%5c%5cevil.example")).toBeNull();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    nextQuery.value = "";
    signInMock.mockResolvedValue({ data: { user: { user_metadata: {} } }, error: null });
    signOutMock.mockResolvedValue({ error: null });
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  async function submit() {
    fireEvent.change(screen.getByLabelText(/Email/), { target: { value: "tester@example.com" } });
    fireEvent.change(screen.getByLabelText(/Password/), { target: { value: "correct horse battery staple" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  }

  it("routes an approved non-admin based on the server's staging access result", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      role: "USER", stagingAccessAllowed: true,
    }), { status: 200 }));
    render(<SignInForm adminOnly />);

    await submit();

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/account"));
    expect(signOutMock).not.toHaveBeenCalled();
  });

  it("preserves administrator routing", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      role: "ADMIN", stagingAccessAllowed: true,
    }), { status: 200 }));
    render(<SignInForm adminOnly />);

    await submit();

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/admin"));
    expect(signOutMock).not.toHaveBeenCalled();
  });

  it("signs out users not approved by the server", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      role: "USER", stagingAccessAllowed: false,
    }), { status: 200 }));
    render(<SignInForm adminOnly />);

    await submit();

    await waitFor(() => expect(signOutMock).toHaveBeenCalled());
    expect(screen.getByText(/approved test accounts/i)).toBeTruthy();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("returns a verified administrator to the retained pairing path", async () => {
    nextQuery.value = "next=%2Fadmin%2Fstock-worker%3Fcode%3DABCDEFGH";
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      role: "ADMIN", stagingAccessAllowed: true,
    }), { status: 200 }));
    render(<SignInForm adminOnly />);

    await submit();

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/admin/stock-worker?code=ABCDEFGH"));
  });

  it("does not send an approved non-admin to an admin return path", async () => {
    nextQuery.value = "next=%2Fadmin%2Fstock-worker%3Fcode%3DABCDEFGH";
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      role: "USER", stagingAccessAllowed: true,
    }), { status: 200 }));
    render(<SignInForm adminOnly />);

    await submit();

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/account"));
  });

  it("does not follow a return path when administrator verification fails", async () => {
    nextQuery.value = "next=%2Fadmin%2Fstock-worker%3Fcode%3DABCDEFGH";
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 401 }));
    render(<SignInForm adminOnly />);

    await submit();

    await waitFor(() => expect(signOutMock).toHaveBeenCalled());
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("rejects an open redirect even for a verified administrator", async () => {
    nextQuery.value = "next=https%3A%2F%2Fevil.example%2Fadmin";
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      role: "ADMIN", stagingAccessAllowed: true,
    }), { status: 200 }));
    render(<SignInForm adminOnly />);

    await submit();

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/admin"));
  });
});
