// @vitest-environment jsdom
import { Suspense, use, useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NavigationContent, NavigationProvider, useNavigationRouter, useSignOutLoading } from "@/components/navigation/navigation-pending";

const mocks = vi.hoisted(() => ({ push: vi.fn(), pathname: "/account" }));
vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: mocks.push, replace: mocks.push, refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() }),
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); mocks.pathname = "/account"; });

function Actions() {
  const router = useNavigationRouter();
  const signOut = useSignOutLoading();
  return <><button onClick={() => router.push("/search")}>Navigate</button><button onClick={() => router.push("/account?sort=new")}>Filter</button><button onClick={signOut.begin}>Sign out</button><button onClick={signOut.cancel}>Failed sign out</button></>;
}

describe("navigation feedback", () => {
  it("observes native internal navigation without changing external, modified or cancelled clicks", () => {
    render(<NavigationProvider><a href="https://example.com" target="_blank">External</a><a href="/search" onClick={(event) => event.preventDefault()}>Cancelled</a><a href="/search" target="_blank">New tab</a><a href="/search">Native</a><NavigationContent><p>Old page</p></NavigationContent></NavigationProvider>);
    fireEvent.click(screen.getByText("External"));
    fireEvent.click(screen.getByText("Cancelled"));
    fireEvent.click(screen.getByText("New tab"));
    fireEvent.click(screen.getByText("Native"), { ctrlKey: true });
    expect(screen.queryByText("Loading page…")).toBeNull();
    fireEvent.click(screen.getByText("Native"));
    expect(screen.getByText("Loading page…")).toBeVisible();
  });

  it("hides old content immediately during a suspended route transition, retains shell and clears on completion", async () => {
    let resolve!: (value: string) => void;
    const data = new Promise<string>((done) => { resolve = done; });
    function Destination() { return <p>{use(data)}</p>; }
    function Fixture() {
      const [destination, setDestination] = useState(false);
      mocks.push.mockImplementation(() => setDestination(true));
      return <NavigationProvider><header>Site shell</header><Actions /><NavigationContent><Suspense fallback={<p>Route loading</p>}>{destination ? <Destination /> : <p>Private content</p>}</Suspense></NavigationContent></NavigationProvider>;
    }
    render(<Fixture />);
    await act(async () => { fireEvent.click(screen.getByText("Navigate")); });
    expect(screen.getByText("Site shell")).toBeVisible();
    expect(screen.getByText("Private content")).not.toBeVisible();
    expect(screen.getByText("Loading page…")).toBeVisible();
    await act(async () => { resolve("New page"); await data; });
    expect(await screen.findByText("New page")).toBeVisible();
    expect(screen.queryByText("Loading page…")).toBeNull();
  });

  it("keeps private content hidden for the whole sign-out request and restores it only on failure", () => {
    render(<NavigationProvider><Actions /><NavigationContent><p>Private content</p></NavigationContent></NavigationProvider>);
    fireEvent.click(screen.getByText("Sign out"));
    expect(screen.getByText("Signing out…")).toBeVisible();
    expect(screen.getByText("Private content")).not.toBeVisible();
    fireEvent.click(screen.getByText("Failed sign out"));
    expect(screen.getByText("Private content")).toBeVisible();
  });

  it("conceals account navigation as well as content on sign-out", () => {
    render(<NavigationProvider><Actions /><NavigationContent scope="/account"><nav>Account sidebar</nav><NavigationContent><p>Private content</p></NavigationContent></NavigationContent></NavigationProvider>);
    fireEvent.click(screen.getByText("Sign out"));
    expect(screen.getByText("Account sidebar")).not.toBeVisible();
  });

  it("retains content and shows a small indicator for query-only transitions", async () => {
    window.history.replaceState({}, "", "/account");
    let resolve!: (value: string) => void;
    const data = new Promise<string>((done) => { resolve = done; });
    function Destination() { return <p>{use(data)}</p>; }
    function Fixture() {
      const [filtering, setFiltering] = useState(false);
      mocks.push.mockImplementation(() => setFiltering(true));
      return <NavigationProvider><Actions /><NavigationContent><Suspense fallback={null}>{filtering ? <Destination /> : <p>Existing results</p>}</Suspense></NavigationContent></NavigationProvider>;
    }
    render(<Fixture />);
    await act(async () => { fireEvent.click(screen.getByText("Filter")); });
    expect(screen.getByText("Existing results")).toBeVisible();
    expect(screen.getByText("Updating results…")).toBeVisible();
    expect(screen.queryByText("Loading page…")).toBeNull();
    await act(async () => { resolve("Filtered results"); await data; });
    expect(await screen.findByText("Filtered results")).toBeVisible();
    expect(screen.queryByText("Updating results…")).toBeNull();
    window.history.replaceState({}, "", "/");
  });
});
