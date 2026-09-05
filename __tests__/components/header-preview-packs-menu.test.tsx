import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HeaderAuthButtons, resolveFlyoutSide } from "@/components/auth/header-auth-buttons";
import {
  PreviewPacksControlList,
  PreviewPacksMobileExpander,
  type PreviewControlsState,
} from "@/components/auth/preview-packs-controls";

const { enablePreviewPackMock, disablePreviewPackMock, getPreviewControlsMock } = vi.hoisted(
  () => ({
    enablePreviewPackMock: vi.fn(),
    disablePreviewPackMock: vi.fn(),
    getPreviewControlsMock: vi.fn(),
  }),
);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("@/actions/admin/preview-packs", () => ({
  enablePreviewPack: enablePreviewPackMock,
  disablePreviewPack: disablePreviewPackMock,
}));

vi.mock("@/actions/admin/preview-controls", () => ({
  getPreviewControls: getPreviewControlsMock,
  setSampleListingVisibility: vi.fn(),
}));

describe("header preview packs menu", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    getPreviewControlsMock.mockResolvedValue({
      data: {
        packs: [
          {
            dealerKey: "athol-garage",
            displayName: "Athol Garage",
            enabled: false,
            listingCount: 64,
          },
        ],
        samplePrivateVisible: true,
        sampleDealerVisible: true,
      },
    });
  });

  it("shows the red Preview packs item for admins only", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <HeaderAuthButtons
        authState={{
          user: { email: "admin@mpdee.co.uk" },
          displayName: "Admin",
          role: "ADMIN",
          loading: false,
          handleSignOut: async () => undefined,
        }}
      />,
    );
    const accountTrigger = screen.getByRole("button", { name: /Admin/i });
    expect(accountTrigger.className).toMatch(/focus-visible:ring-0/);
    expect(accountTrigger.className).toMatch(/focus-visible:outline-none/);
    await user.click(accountTrigger);
    expect(screen.getByText("Preview packs")).toBeTruthy();
    expect(screen.getByText("Admin area")).toBeTruthy();
    expect(screen.getByText("Preview packs").closest("[data-chevron]")).toHaveAttribute(
      "data-chevron",
      "left",
    );

    rerender(
      <HeaderAuthButtons
        authState={{
          user: { email: "user@example.com" },
          displayName: "Member",
          role: "USER",
          loading: false,
          handleSignOut: async () => undefined,
        }}
      />,
    );
    expect(screen.queryByText("Preview packs")).toBeNull();
    expect(screen.queryByText("Admin area")).toBeNull();
  });

  it("toggles a loaded pack and never lists a missing pack", async () => {
    const user = userEvent.setup();
    const state: PreviewControlsState = {
      packs: [
        {
          dealerKey: "athol-garage",
          displayName: "Athol Garage",
          enabled: false,
          listingCount: 64,
        },
      ],
      samplePrivateVisible: true,
      sampleDealerVisible: false,
    };
    enablePreviewPackMock.mockResolvedValue({ data: { enabled: true } });
    const onTogglePack = vi.fn();
    render(
      <PreviewPacksControlList
        state={state}
        error={null}
        pendingKey={null}
        onTogglePack={onTogglePack}
        onToggleSample={vi.fn()}
      />,
    );
    const packButton = screen.getByRole("button", { name: /Athol Garage/ });
    expect(packButton.className).toMatch(/hover:outline-neon-blue-500/);
    expect(screen.getByText("Athol Garage")).toBeTruthy();
    expect(screen.queryByText("vehicles-im")).toBeNull();
    await user.click(screen.getByRole("button", { name: /Athol Garage/ }));
    expect(onTogglePack).toHaveBeenCalledWith(state.packs[0]);
  });

  it("renders flyout rows as menu items that dismiss on select", async () => {
    const user = userEvent.setup();
    const onTogglePack = vi.fn();
    const { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } = await import(
      "@/components/ui/dropdown-menu"
    );
    render(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <PreviewPacksControlList
            asMenuItems
            state={{
              packs: [
                {
                  dealerKey: "athol-garage",
                  displayName: "Athol Garage",
                  enabled: false,
                  listingCount: 64,
                },
              ],
              samplePrivateVisible: true,
              sampleDealerVisible: true,
            }}
            error={null}
            pendingKey={null}
            onTogglePack={onTogglePack}
            onToggleSample={vi.fn()}
          />
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    await user.click(screen.getByRole("menuitem", { name: /Athol Garage/ }));
    expect(onTogglePack).toHaveBeenCalled();
  });

  it("expands the mobile Preview packs control for admins", async () => {
    const user = userEvent.setup();
    render(<PreviewPacksMobileExpander />);
    await user.click(screen.getByRole("button", { name: /Preview packs/ }));
    expect(getPreviewControlsMock).toHaveBeenCalled();
    expect(await screen.findByText("Private sample listings")).toBeTruthy();
    expect(screen.getByText("Dealer sample listings")).toBeTruthy();
    expect(screen.getByText("Athol Garage")).toBeTruthy();
  });
});

describe("preview packs flyout side", () => {
  function triggerAt(left: number, right: number) {
    return { getBoundingClientRect: () => ({ left, right, width: right - left, height: 32 }) } as HTMLElement;
  }

  it("points left when there is room on the left, down when the viewport is tight", () => {
    const innerWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
    expect(resolveFlyoutSide(triggerAt(900, 1124))).toBe("left");
    expect(resolveFlyoutSide(triggerAt(40, 264))).toBe("right");
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 360 });
    expect(resolveFlyoutSide(triggerAt(40, 264))).toBe("bottom");
    Object.defineProperty(window, "innerWidth", { configurable: true, value: innerWidth });
  });
});
