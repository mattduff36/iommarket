// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { pushMock, refreshMock, signInMock, signOutMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
  signInMock: vi.fn(),
  signOutMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({
    auth: { signInWithPassword: signInMock, signOut: signOutMock },
  }),
}));

import { SignInForm } from "@/components/auth/sign-in-form";

describe("staging sign-in form access decisions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
