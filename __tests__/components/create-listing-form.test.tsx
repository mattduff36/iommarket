import * as React from "react";
import { fireEvent, render as rtlRender, screen, waitFor } from "@testing-library/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FUEL_TYPE_OPTIONS } from "@/lib/constants/fuel-types";

const { pushMock, replaceMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  replaceMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
    replace: replaceMock,
    refresh: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
  }),
}));

function render(ui: React.ReactElement) {
  return rtlRender(
    <AppRouterContext.Provider
      value={{
        push: pushMock,
        replace: replaceMock,
        refresh: vi.fn(),
        prefetch: vi.fn(),
        back: vi.fn(),
        forward: vi.fn(),
        bfcacheId: "test",
      }}
    >
      {ui}
    </AppRouterContext.Provider>,
  );
}

vi.mock("@/actions/listings", () => ({
  createListing: vi.fn(),
  syncListingImages: vi.fn(),
  submitListingForReview: vi.fn(),
  updateListing: vi.fn(),
}));

vi.mock("@/actions/payments", () => ({
  payForListing: vi.fn(),
  simulateDemoListingPaymentOutcome: vi.fn(),
}));

vi.mock("@/components/marketplace/image-upload", () => ({
  ImageUpload: ({
    onImagesChange,
    maxImages,
  }: {
    onImagesChange: (
      images: Array<{
        url: string;
        publicId: string;
        order: number;
        uploadIntentId: string;
        provider: "CLOUDINARY";
      }>
    ) => void;
    maxImages: number;
  }) => (
    <button
      type="button"
      data-testid="mock-image-upload"
      data-max-images={maxImages}
      onClick={() =>
        onImagesChange([
          {
            url: "https://example.com/image-1.jpg",
            publicId: "image-1",
            order: 0,
            uploadIntentId: "intent-1",
            provider: "CLOUDINARY",
          },
          {
            url: "https://example.com/image-2.jpg",
            publicId: "image-2",
            order: 1,
            uploadIntentId: "intent-2",
            provider: "CLOUDINARY",
          },
        ])
      }
    >
      Add mock images ({maxImages})
    </button>
  ),
}));

import { CreateListingForm } from "@/app/(public)/sell/create-listing-form";
import {
  applyAuthoritativePhotoRevision,
  chooseListingWriteAction,
  interpretPhotoSyncResult,
  nextPhotoRevisionAfterListingSave,
  resolvePhotoMutation,
  summarizeListingSubmitFieldErrors,
  tryBeginSubmitFlight,
} from "@/app/(public)/sell/create-listing-submit";
import {
  createListing,
  syncListingImages,
  submitListingForReview,
  updateListing,
} from "@/actions/listings";
import {
  payForListing,
  simulateDemoListingPaymentOutcome,
} from "@/actions/payments";

const fetchMock = vi.fn();

const categories = [
  {
    id: "car-category",
    name: "Cars",
    slug: "car",
    attributes: [
      { id: "make", name: "Make", slug: "make", dataType: "text", required: true, options: null },
      { id: "model", name: "Model", slug: "model", dataType: "text", required: true, options: null },
      {
        id: "write-off",
        name: "Insurance write-off category",
        slug: "write-off-category",
        dataType: "select",
        required: false,
        options: JSON.stringify(["None", "Category N", "Category S"]),
      },
      { id: "year", name: "Year", slug: "year", dataType: "number", required: true, options: null },
      {
        id: "fuel",
        name: "Fuel Type",
        slug: "fuel-type",
        dataType: "select",
        required: false,
        options: JSON.stringify(FUEL_TYPE_OPTIONS),
      },
      {
        id: "colour",
        name: "Colour",
        slug: "colour",
        dataType: "select",
        required: false,
        options: JSON.stringify(["Black", "White", "Silver", "Grey", "Blue", "Red"]),
      },
      { id: "mileage", name: "Mileage", slug: "mileage", dataType: "number", required: false, options: null },
      {
        id: "engine",
        name: "Engine Size",
        slug: "engine-size",
        dataType: "number",
        required: false,
        options: null,
      },
      {
        id: "co2",
        name: "CO2 Emissions",
        slug: "co2-emissions",
        dataType: "number",
        required: false,
        options: null,
      },
    ],
  },
  {
    id: "motorbike-category",
    name: "Motorbikes",
    slug: "motorbike",
    attributes: [
      { id: "bike-make", name: "Make", slug: "make", dataType: "text", required: true, options: null },
      { id: "bike-model", name: "Model", slug: "model", dataType: "text", required: true, options: null },
      { id: "bike-year", name: "Year", slug: "year", dataType: "number", required: true, options: null },
      {
        id: "bike-fuel",
        name: "Fuel Type",
        slug: "fuel-type",
        dataType: "select",
        required: false,
        options: JSON.stringify(FUEL_TYPE_OPTIONS),
      },
      {
        id: "bike-colour",
        name: "Colour",
        slug: "colour",
        dataType: "select",
        required: false,
        options: JSON.stringify(["Black", "White", "Silver", "Grey", "Blue", "Red"]),
      },
      { id: "bike-mileage", name: "Mileage", slug: "mileage", dataType: "number", required: false, options: null },
      {
        id: "bike-write-off",
        name: "Insurance write-off category",
        slug: "write-off-category",
        dataType: "select",
        required: false,
        options: JSON.stringify(["None", "Category N", "Category S"]),
      },
      {
        id: "bike-engine",
        name: "Engine Size",
        slug: "engine-size",
        dataType: "number",
        required: false,
        options: null,
      },
      {
        id: "bike-co2",
        name: "CO2 Emissions",
        slug: "co2-emissions",
        dataType: "number",
        required: false,
        options: null,
      },
    ],
  },
];

const regions = [{ id: "iom", name: "IOM Central" }];

describe("CreateListingForm registration lookup", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/");
    fetchMock.mockReset();
    pushMock.mockReset();
    replaceMock.mockReset();
    vi.mocked(createListing).mockReset();
    vi.mocked(syncListingImages).mockReset();
    vi.mocked(submitListingForReview).mockReset();
    vi.mocked(updateListing).mockReset();
    vi.mocked(payForListing).mockReset();
    vi.mocked(simulateDemoListingPaymentOutcome).mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("open", vi.fn());
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
  });

  it("uses private and dealer photo limits in the upload step", () => {
    function completeDetailsStep() {
      fireEvent.click(screen.getByRole("button", { name: "Cars" }));
      fireEvent.change(screen.getByLabelText(/^Title/), {
        target: { value: "2019 BMW 320d M Sport" },
      });
      fireEvent.change(screen.getByLabelText(/Description/i), {
        target: { value: "A clean example with good history and recent servicing." },
      });
      fireEvent.change(screen.getByLabelText(/^Price \(£\)/), {
        target: { value: "15000" },
      });
      fireEvent.change(screen.getByLabelText(/^Region/), {
        target: { value: "iom" },
      });
      fireEvent.change(screen.getByLabelText(/Make/i), {
        target: { value: "BMW" },
      });
      fireEvent.change(screen.getByLabelText(/^Model \(manual entry\)/), {
        target: { value: "320d M Sport" },
      });
      fireEvent.change(screen.getByLabelText(/Year/i), {
        target: { value: "2019" },
      });
      fireEvent.change(screen.getByLabelText(/Mileage/i), {
        target: { value: "45000" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    }

    const { unmount } = render(
      <CreateListingForm categories={categories} regions={regions} mode="private" />
    );

    completeDetailsStep();

    expect(screen.getByTestId("mock-image-upload").getAttribute("data-max-images")).toBe("10");

    unmount();
    render(<CreateListingForm categories={categories} regions={regions} mode="dealer" />);
    completeDetailsStep();

    expect(screen.getByTestId("mock-image-upload").getAttribute("data-max-images")).toBe("20");
  });

  it("marks vehicle mileage as required", () => {
    render(<CreateListingForm categories={categories} regions={regions} mode="private" />);

    fireEvent.click(screen.getByRole("button", { name: "Cars" }));

    expect((screen.getByLabelText(/Mileage/i) as HTMLInputElement).required).toBe(true);
    for (const marker of screen.getAllByText("*")) {
      expect(marker.classList.contains("text-text-error")).toBe(true);
    }
  });

  it("offers the standardized fuel types in listing creation order", () => {
    render(<CreateListingForm categories={categories} regions={regions} mode="private" />);

    fireEvent.click(screen.getByRole("button", { name: "Cars" }));

    const fuelTypeSelect = screen.getByLabelText(/Fuel Type/i) as HTMLSelectElement;
    expect(Array.from(fuelTypeSelect.options).slice(1).map((option) => option.value)).toEqual(
      FUEL_TYPE_OPTIONS
    );
  });

  it("progressively reveals searchable models and supports alias, keyboard, and manual fallback MD-CAT-002", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [
          {
            id: "t-roc",
            name: "T-Roc",
            aliases: ["T Roc", "TROC"],
          },
        ],
      }),
    });
    render(
      <CreateListingForm
        categories={categories}
        regions={regions}
        mode="private"
        vehicleMakes={[
          {
            id: "volkswagen",
            name: "Volkswagen",
            normalizedName: "volkswagen",
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cars" }));
    expect(screen.getByText("Choose or enter a make to reveal models.")).toBeTruthy();
    expect(screen.queryByLabelText(/^Model/)).toBeNull();

    const makeInput = screen.getByLabelText(/^Make/) as HTMLInputElement;
    expect(makeInput.getAttribute("list")).toBe("vehicle-make-options");
    await user.type(makeInput, "Volks");
    expect(makeInput.getAttribute("list")).toBe("vehicle-make-options");
    await user.type(makeInput, "wagen");

    const modelInput = (await screen.findByLabelText(/^Model/)) as HTMLInputElement;
    await waitFor(() => expect(modelInput.disabled).toBe(false));
    expect(modelInput.getAttribute("list")).toBe("vehicle-model-options");
    await user.type(modelInput, "T Roc");
    expect(modelInput.value).toBe("T-Roc");
    expect(screen.getByText("Catalogue model selected: T-Roc.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Add variant / trim" }));
    const variantInput = screen.getByLabelText("Variant / trim (optional)");
    await user.type(variantInput, "R-Line");

    await user.click(
      screen.getByRole("button", { name: "Other / enter model manually" }),
    );
    expect((screen.getByLabelText("Variant / trim (optional)") as HTMLInputElement).value).toBe(
      "R-Line",
    );
    await user.click(
      screen.getByRole("button", { name: "Choose from catalogue" }),
    );
    expect((screen.getByLabelText("Variant / trim (optional)") as HTMLInputElement).value).toBe(
      "R-Line",
    );
    await user.click(
      screen.getByRole("button", { name: "Other / enter model manually" }),
    );
    const manualModel = screen.getByLabelText(
      /^Model \(manual entry\)/,
    ) as HTMLInputElement;
    await user.clear(manualModel);
    await user.type(manualModel, "Coachbuilt Special");
    expect(manualModel.value).toBe("Coachbuilt Special");
    expect(
      (screen.getByLabelText("Variant / trim (optional)") as HTMLInputElement)
        .value,
    ).toBe("R-Line");
    expect(screen.getByText("Manual model entry selected.")).toBeTruthy();
  });

  it("keeps typing enabled and ignores an aborted stale model request", async () => {
    const user = userEvent.setup();
    let volkswagenSignal: AbortSignal | undefined;
    fetchMock.mockImplementation(
      (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("Volkswagen")) {
          volkswagenSignal = init?.signal ?? undefined;
          return new Promise((_, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"));
            });
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({
            models: [{ id: "focus", name: "Focus", aliases: [] }],
          }),
        });
      },
    );

    render(
      <CreateListingForm
        categories={categories}
        regions={regions}
        vehicleMakes={[
          { id: "vw", name: "Volkswagen", normalizedName: "volkswagen" },
          { id: "ford", name: "Ford", normalizedName: "ford" },
        ]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Cars" }));
    const makeInput = screen.getByLabelText(/^Make/) as HTMLInputElement;
    await user.type(makeInput, "Volkswagen");

    const loadingModel = await screen.findByLabelText(/^Model/);
    expect((loadingModel as HTMLInputElement).disabled).toBe(false);
    expect(loadingModel.getAttribute("list")).toBe("vehicle-model-options");

    await user.clear(makeInput);
    await user.type(makeInput, "Ford");
    expect(volkswagenSignal?.aborted).toBe(true);

    const fordModel = await screen.findByLabelText(/^Model/);
    await waitFor(() =>
      expect(screen.getByText("Start typing to search models for the selected make.")).toBeTruthy(),
    );
    expect((fordModel as HTMLInputElement).disabled).toBe(false);
    expect(screen.queryByText(/Models could not be loaded/)).toBeNull();
  });

  it("demotes unmatched catalogue makes on blur and submits manual values", async () => {
    const user = userEvent.setup();
    vi.mocked(createListing).mockResolvedValue({
      data: { id: "listing-manual-make" },
    } as Awaited<ReturnType<typeof createListing>>);
    vi.mocked(syncListingImages).mockResolvedValue({
      data: { count: 2, photoRevision: 1 },
    } as Awaited<ReturnType<typeof syncListingImages>>);
    vi.mocked(submitListingForReview).mockResolvedValue({
      data: null,
    } as unknown as Awaited<ReturnType<typeof submitListingForReview>>);
    vi.mocked(payForListing).mockResolvedValue({
      data: { checkoutUrl: "https://checkout.example/manual-make" },
    } as Awaited<ReturnType<typeof payForListing>>);

    render(
      <CreateListingForm
        categories={categories}
        regions={regions}
        vehicleMakes={[
          { id: "vw", name: "Volkswagen", normalizedName: "volkswagen" },
        ]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Cars" }));
    const makeInput = screen.getByLabelText(/^Make/);
    await user.type(makeInput, "Isuzu");
    expect(screen.getByLabelText(/^Model/)).toBeTruthy();
    await user.tab();
    expect(screen.getByLabelText(/^Make \(manual entry\)/)).toBeTruthy();

    const modelInput = screen.getByLabelText(/^Model \(manual entry\)/);
    await user.type(modelInput, "D-Max");
    await user.tab();
    expect(screen.getByText("Manual model entry selected.")).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/^Title/), {
      target: { value: "2020 Isuzu D-Max" },
    });
    fireEvent.change(screen.getByLabelText(/^Description/), {
      target: { value: "A carefully maintained utility vehicle with full service history." },
    });
    fireEvent.change(screen.getByLabelText(/^Price \(£\)/), {
      target: { value: "18000" },
    });
    fireEvent.change(screen.getByLabelText(/^Region/), {
      target: { value: "iom" },
    });
    fireEvent.change(screen.getByLabelText(/Year/i), {
      target: { value: "2020" },
    });
    fireEvent.change(screen.getByLabelText(/Mileage/i), {
      target: { value: "40000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByTestId("mock-image-upload"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(
      screen.getByLabelText(/I confirm I have authority to advertise this vehicle/),
    );
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /I expressly accept the current Private Seller Terms/i,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue to Checkout" }));

    await waitFor(() =>
      expect(createListing).toHaveBeenCalledWith(
        expect.objectContaining({
          attributes: expect.arrayContaining([
            { attributeDefinitionId: "make", value: "Isuzu" },
            { attributeDefinitionId: "model", value: "D-Max" },
          ]),
          vehicleCatalogueSelection: {
            makeMode: "manual",
            modelMode: "manual",
          },
        }),
      ),
    );
  });

  it("demotes unmatched Chrysler typing while keeping the model field visible", async () => {
    const user = userEvent.setup();
    render(
      <CreateListingForm
        categories={categories}
        regions={regions}
        vehicleMakes={[
          { id: "vw", name: "Volkswagen", normalizedName: "volkswagen" },
        ]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Cars" }));
    await user.type(screen.getByLabelText(/^Make/), "Chrysler");
    expect(screen.getByLabelText(/^Model/)).toBeTruthy();
    await user.tab();
    expect(screen.getByLabelText(/^Make \(manual entry\)/)).toBeTruthy();
    expect(screen.getByLabelText(/^Model \(manual entry\)/)).toBeTruthy();
  });

  it("hides variant entry when an 80-character model leaves no capacity", async () => {
    const user = userEvent.setup();
    render(<CreateListingForm categories={categories} regions={regions} />);
    await user.click(screen.getByRole("button", { name: "Cars" }));
    await user.type(screen.getByLabelText(/^Make/), "Custom");
    await user.type(screen.getByLabelText(/^Model \(manual entry\)/), "M".repeat(80));
    expect(
      screen.queryByRole("button", { name: "Add variant / trim" }),
    ).toBeNull();
  });

  it("demotes an unmatched Volkswagen model and submits a manual model payload", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [{ id: "t-roc", name: "T-Roc", aliases: [] }],
      }),
    });
    vi.mocked(createListing).mockResolvedValue({
      data: { id: "listing-manual-model" },
    } as Awaited<ReturnType<typeof createListing>>);
    vi.mocked(syncListingImages).mockResolvedValue({
      data: { count: 2, photoRevision: 1 },
    } as Awaited<ReturnType<typeof syncListingImages>>);
    vi.mocked(submitListingForReview).mockResolvedValue({
      data: null,
    } as unknown as Awaited<ReturnType<typeof submitListingForReview>>);
    vi.mocked(payForListing).mockResolvedValue({
      data: { checkoutUrl: "https://checkout.example/manual-model" },
    } as Awaited<ReturnType<typeof payForListing>>);

    render(
      <CreateListingForm
        categories={categories}
        regions={regions}
        vehicleMakes={[
          { id: "vw", name: "Volkswagen", normalizedName: "volkswagen" },
        ]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Cars" }));
    await user.type(screen.getByLabelText(/^Make/), "Volkswagen");
    const modelInput = await screen.findByLabelText(/^Model/);
    await user.type(modelInput, "Caddy");
    await user.tab();
    expect(screen.getByLabelText(/^Model \(manual entry\)/)).toBeTruthy();
    expect(screen.getByText("Manual model entry selected.")).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/^Title/), {
      target: { value: "2021 Volkswagen Caddy" },
    });
    fireEvent.change(screen.getByLabelText(/^Description/), {
      target: { value: "A practical Caddy with a clean interior and detailed history." },
    });
    fireEvent.change(screen.getByLabelText(/^Price \(£\)/), {
      target: { value: "19000" },
    });
    fireEvent.change(screen.getByLabelText(/^Region/), {
      target: { value: "iom" },
    });
    fireEvent.change(screen.getByLabelText(/Year/i), {
      target: { value: "2021" },
    });
    fireEvent.change(screen.getByLabelText(/Mileage/i), {
      target: { value: "35000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByTestId("mock-image-upload"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(
      screen.getByLabelText(/I confirm I have authority to advertise this vehicle/),
    );
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /I expressly accept the current Private Seller Terms/i,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue to Checkout" }));

    await waitFor(() =>
      expect(createListing).toHaveBeenCalledWith(
        expect.objectContaining({
          attributes: expect.arrayContaining([
            { attributeDefinitionId: "make", value: "Volkswagen" },
            { attributeDefinitionId: "model", value: "Caddy" },
          ]),
          vehicleCatalogueSelection: {
            makeMode: "catalogue",
            modelMode: "manual",
            canonicalMake: "Volkswagen",
          },
        }),
      ),
    );
  });

  it("auto-fills supported vehicle fields from lookup results", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        result: {
          normalizedRegistration: "AB12CDE",
          displayRegistration: "AB12 CDE",
          isManx: false,
          lookupTargetRegistration: "AB12CDE",
          vehicle: {
            registrationNumber: "AB12CDE",
            displayRegistrationNumber: "AB12 CDE",
            lookupPath: "uk",
            make: "Mercedes-Benz",
            model: "A 200 AMG LINE",
            colour: "GRAY",
            fuelType: "PETROL",
            taxStatus: "Taxed",
            taxDueDate: null,
            motStatus: "Valid",
            motExpiryDate: null,
            yearOfManufacture: 2020,
            engineSizeCc: 1332,
            co2Emissions: 121,
            monthOfFirstRegistration: null,
            wheelPlan: null,
            euroStatus: null,
            category: null,
            previousUkRegistration: null,
            dateOfFirstRegistrationIom: null,
            roadTax12Month: "£195.00",
            roadTax6Month: null,
            firstUsedDate: null,
          },
          motHistory: null,
          mileage: {
            latestMileage: 54321,
            latestMileageDate: "2025-01-01",
            earliestMileage: 30000,
            earliestMileageDate: "2023-01-01",
            averageAnnualMileage: 12000,
            points: [],
          },
          auctionHistory: null,
          warnings: [],
          sourceNotes: [],
          checkedAt: new Date().toISOString(),
        },
      }),
    });

    render(
      <CreateListingForm categories={categories} regions={regions} mode="private" />
    );

    fireEvent.click(screen.getByRole("button", { name: "Cars" }));
    fireEvent.change(screen.getByLabelText("Number Plate"), {
      target: { value: "ab12 cde" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Lookup Vehicle" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/vehicle-check", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ registration: "AB12 CDE" }),
      });
    });

    await screen.findByText(/Auto-filled/i);

    expect((screen.getByLabelText(/Make/i) as HTMLSelectElement).value).toBe("Mercedes-Benz");
    await waitFor(() =>
      expect(
        (screen.getByLabelText(/^Model \(manual entry\)/) as HTMLInputElement)
          .value,
      ).toBe("A 200 AMG LINE"),
    );
    expect((screen.getByLabelText(/Year/i) as HTMLInputElement).value).toBe("2020");
    expect((screen.getByLabelText(/Fuel Type/i) as HTMLSelectElement).value).toBe("Petrol");
    expect((screen.getByLabelText(/Colour/i) as HTMLSelectElement).value).toBe("Grey");
    expect((screen.getByLabelText(/Mileage/i) as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText(/^Title/) as HTMLInputElement).value).toBe(
      "2020 Mercedes-Benz A 200 AMG LINE"
    );
  });

  it("upgrades an autofilled canonical model after its make models load", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/vehicle-catalogue/models")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            models: [{ id: "t-roc", name: "T-Roc", aliases: [] }],
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          success: true,
          result: {
            normalizedRegistration: "AB12CDE",
            displayRegistration: "AB12 CDE",
            isManx: false,
            lookupTargetRegistration: "AB12CDE",
            vehicle: {
              registrationNumber: "AB12CDE",
              displayRegistrationNumber: "AB12 CDE",
              lookupPath: "uk",
              make: "Volkswagen",
              model: "T Roc",
              colour: null,
              fuelType: null,
              taxStatus: null,
              taxDueDate: null,
              motStatus: null,
              motExpiryDate: null,
              yearOfManufacture: 2020,
              engineSizeCc: null,
              co2Emissions: null,
              monthOfFirstRegistration: null,
              wheelPlan: null,
              euroStatus: null,
              category: null,
              previousUkRegistration: null,
              dateOfFirstRegistrationIom: null,
              roadTax12Month: null,
              roadTax6Month: null,
              firstUsedDate: null,
            },
            motHistory: null,
            mileage: null,
            auctionHistory: null,
            warnings: [],
            sourceNotes: [],
            checkedAt: new Date().toISOString(),
          },
        }),
      });
    });

    render(
      <CreateListingForm
        categories={categories}
        regions={regions}
        vehicleMakes={[
          {
            id: "volkswagen",
            name: "Volkswagen",
            normalizedName: "volkswagen",
          },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cars" }));
    fireEvent.change(screen.getByLabelText("Number Plate"), {
      target: { value: "AB12 CDE" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Lookup Vehicle" }));

    await waitFor(() =>
      expect((screen.getByLabelText(/^Model/) as HTMLInputElement).value).toBe(
        "T-Roc",
      ),
    );
    expect(screen.getByLabelText(/^Model/).getAttribute("list")).toBe(
      "vehicle-model-options",
    );
    expect(screen.getByText("Catalogue model selected: T-Roc.")).toBeTruthy();
  });

  it("shows lookup errors without mutating form state", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Vehicle not found for that registration" }),
    });

    render(
      <CreateListingForm categories={categories} regions={regions} mode="private" />
    );

    fireEvent.click(screen.getByRole("button", { name: "Cars" }));
    fireEvent.change(screen.getByLabelText("Number Plate"), {
      target: { value: "NO12 CAR" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Lookup Vehicle" }));

    await screen.findByText("Vehicle not found for that registration");
    expect(screen.getByText("Choose or enter a make to reveal models.")).toBeTruthy();
  });

  it("auto-selects category from lookup result when category is unset", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        result: {
          normalizedRegistration: "MN55ABC",
          displayRegistration: "MN 55 ABC",
          isManx: true,
          lookupTargetRegistration: "MN55ABC",
          vehicle: {
            registrationNumber: "MN55ABC",
            displayRegistrationNumber: "MN 55 ABC",
            lookupPath: "iom",
            make: "Honda",
            model: "CBR600RR",
            colour: "RED",
            fuelType: "PETROL",
            taxStatus: "Taxed",
            taxDueDate: null,
            motStatus: "Valid",
            motExpiryDate: null,
            yearOfManufacture: 2019,
            engineSizeCc: 599,
            co2Emissions: null,
            monthOfFirstRegistration: null,
            wheelPlan: "2-WHEEL",
            euroStatus: null,
            category: "MOTORCYCLE",
            previousUkRegistration: null,
            dateOfFirstRegistrationIom: null,
            roadTax12Month: null,
            roadTax6Month: null,
            firstUsedDate: null,
          },
          motHistory: null,
          mileage: null,
          auctionHistory: null,
          warnings: [],
          sourceNotes: [],
          checkedAt: new Date().toISOString(),
        },
      }),
    });

    render(
      <CreateListingForm categories={categories} regions={regions} mode="private" />
    );

    fireEvent.change(screen.getByLabelText("Number Plate"), {
      target: { value: "mn55 abc" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Lookup Vehicle" }));

    await screen.findByText(/Category auto-selected: Motorbikes/i);

    expect(
      screen
        .getByRole("button", { name: "Motorbikes" })
        .getAttribute("aria-pressed")
    ).toBe("true");
    expect((screen.getByLabelText(/Make/i) as HTMLSelectElement).value).toBe("Honda");
    expect((screen.getByLabelText(/^Model \(manual entry\)/) as HTMLInputElement).value).toBe("CBR600RR");
    expect((screen.getByLabelText(/^Title/) as HTMLInputElement).value).toBe(
      "2019 Honda CBR600RR"
    );
  });

  it("opens hosted checkout in a new tab and moves the original tab to checkout status", async () => {
    vi.mocked(createListing).mockResolvedValue({
      data: { id: "listing-123" },
    } as Awaited<ReturnType<typeof createListing>>);
    vi.mocked(syncListingImages).mockResolvedValue({
      data: { count: 2, photoRevision: 1 },
    } as Awaited<ReturnType<typeof syncListingImages>>);
    vi.mocked(submitListingForReview).mockResolvedValue({
      data: null,
    } as unknown as Awaited<ReturnType<typeof submitListingForReview>>);
    vi.mocked(payForListing).mockResolvedValue({
      data: { checkoutUrl: "https://checkout.example/pay/123" },
    } as Awaited<ReturnType<typeof payForListing>>);

    render(
      <CreateListingForm categories={categories} regions={regions} mode="private" />
    );

    fireEvent.click(screen.getByRole("button", { name: "Cars" }));
    fireEvent.change(screen.getByLabelText(/^Title/), {
      target: { value: "2019 BMW 320d M Sport" },
    });
    fireEvent.change(screen.getByLabelText(/^Description/), {
      target: { value: "A well-kept BMW with full history and plenty of specification." },
    });
    fireEvent.change(screen.getByLabelText(/^Price \(£\)/), {
      target: { value: "15000" },
    });
    fireEvent.change(screen.getByLabelText(/^Region/), {
      target: { value: "iom" },
    });
    fireEvent.change(screen.getByLabelText(/Make/i), {
      target: { value: "BMW" },
    });
    fireEvent.change(screen.getByLabelText(/^Model \(manual entry\)/), {
      target: { value: "320d M Sport" },
    });
    fireEvent.change(screen.getByLabelText(/Year/i), {
      target: { value: "2019" },
    });
    fireEvent.change(screen.getByLabelText(/Mileage/i), {
      target: { value: "45000" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByTestId("mock-image-upload"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(
      screen.getByLabelText(
        /I confirm I have authority to advertise this vehicle/
      )
    );
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /I expressly accept the current Private Seller Terms/i,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue to Checkout" }));

    await waitFor(() => {
      expect(payForListing).toHaveBeenCalledWith({
        listingId: "listing-123",
        privateSellerTermsAccepted: true,
      });
      expect(window.open).toHaveBeenCalledWith(
        "https://checkout.example/pay/123",
        "_blank",
        "noopener,noreferrer"
      );
    });

    await waitFor(() => {
      expect(window.location.pathname + window.location.search).toBe(
        "/sell/private?draft=listing-123",
      );
      expect(replaceMock).toHaveBeenCalledWith(
        "/sell/checkout?listing=listing-123&flow=private&opened=1"
      );
    });
    expect(replaceMock).not.toHaveBeenCalledWith("/sell/private?draft=listing-123");
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("updates an existing draft instead of creating a new listing", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [{ id: "a3", name: "A3", aliases: [] }],
      }),
    });
    vi.mocked(updateListing).mockResolvedValue({
      data: { id: "draft-123" },
    } as Awaited<ReturnType<typeof updateListing>>);
    vi.mocked(syncListingImages).mockResolvedValue({
      data: { count: 2, photoRevision: 4 },
    } as Awaited<ReturnType<typeof syncListingImages>>);
    vi.mocked(payForListing).mockResolvedValue({
      data: { checkoutUrl: "https://checkout.example/pay/draft-123" },
    } as Awaited<ReturnType<typeof payForListing>>);

    render(
      <CreateListingForm
        categories={categories}
        regions={regions}
        mode="private"
        vehicleMakes={[
          { id: "audi", name: "Audi", normalizedName: "audi" },
        ]}
        initialDraft={{
          id: "draft-123",
          title: "2017 Audi A3 Sport",
          description: "Previously saved draft description with enough detail to remain valid.",
          price: 11250,
          categoryId: "car-category",
          regionId: "iom",
          trustDeclarationAccepted: true,
          featured: false,
          photoRevision: 3,
          images: [
            {
              id: "img-1",
              url: "https://example.com/existing-1.jpg",
              publicId: "existing-1",
              order: 0,
              provider: "EXTERNAL",
              assetId: null,
              version: null,
              width: 800,
              height: 600,
              format: "jpg",
              bytes: null,
              uploadIntentId: null,
              focalX: null,
              focalY: null,
            },
            {
              id: "img-2",
              url: "https://example.com/existing-2.jpg",
              publicId: "existing-2",
              order: 1,
              provider: "EXTERNAL",
              assetId: null,
              version: null,
              width: 800,
              height: 600,
              format: "jpg",
              bytes: null,
              uploadIntentId: null,
              focalX: null,
              focalY: null,
            },
          ],
          attributes: [
            { attributeDefinitionId: "make", value: "Audi" },
            { attributeDefinitionId: "model", value: "A3 Sport" },
            { attributeDefinitionId: "year", value: "2017" },
            { attributeDefinitionId: "mileage", value: "65000" },
          ],
        }}
      />
    );

    expect((screen.getByLabelText(/^Title/) as HTMLInputElement).value).toBe(
      "2017 Audi A3 Sport"
    );
    expect((screen.getByLabelText(/^Price \(£\)/) as HTMLInputElement).value).toBe("11250");
    expect((screen.getByLabelText(/^Region/) as HTMLSelectElement).value).toBe("iom");
    await screen.findByDisplayValue("A3");
    expect(
      (screen.getByLabelText("Variant / trim (optional)") as HTMLInputElement)
        .value,
    ).toBe("Sport");

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /I expressly accept the current Private Seller Terms/i,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue to Checkout" }));

    await waitFor(() => {
      expect(updateListing).toHaveBeenCalledWith({
        id: "draft-123",
        title: "2017 Audi A3 Sport",
        description: "Previously saved draft description with enough detail to remain valid.",
        price: 1125000,
        categoryId: "car-category",
        regionId: "iom",
        trustDeclarationAccepted: true,
        attributes: [
          { attributeDefinitionId: "make", value: "Audi" },
          { attributeDefinitionId: "model", value: "A3 Sport" },
          { attributeDefinitionId: "year", value: "2017" },
          { attributeDefinitionId: "mileage", value: "65000" },
        ],
        vehicleCatalogueSelection: {
          makeMode: "catalogue",
          modelMode: "catalogue",
          canonicalMake: "Audi",
          canonicalModel: "A3",
          variant: "Sport",
        },
      });
    });

    expect(createListing).not.toHaveBeenCalled();
    expect(syncListingImages).toHaveBeenCalledWith(
      "draft-123",
      expect.objectContaining({
        basePhotoRevision: 3,
        mutationId: expect.any(String),
        photos: [
          {
            imageId: "img-1",
            uploadIntentId: undefined,
            focalX: null,
            focalY: null,
          },
          {
            imageId: "img-2",
            uploadIntentId: undefined,
            focalX: null,
            focalY: null,
          },
        ],
      }),
    );

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith(
        "/sell/checkout?listing=draft-123&flow=private&opened=1"
      );
    });
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("keeps demo checkout inside the Ripple modal instead of redirecting the original tab", async () => {
    vi.mocked(createListing).mockResolvedValue({
      data: { id: "listing-456" },
    } as Awaited<ReturnType<typeof createListing>>);
    vi.mocked(syncListingImages).mockResolvedValue({
      data: { count: 2, photoRevision: 1 },
    } as Awaited<ReturnType<typeof syncListingImages>>);
    vi.mocked(payForListing).mockResolvedValue({
      data: {
        checkoutUrl: "https://portal.startyourripple.co.uk/card/demo-gym/checkout-123",
      },
    } as Awaited<ReturnType<typeof payForListing>>);

    render(
      <CreateListingForm categories={categories} regions={regions} mode="private" />
    );

    fireEvent.click(screen.getByRole("button", { name: "Cars" }));
    fireEvent.change(screen.getByLabelText(/^Title/), {
      target: { value: "2018 Audi A4 S line" },
    });
    fireEvent.change(screen.getByLabelText(/^Description/), {
      target: { value: "Clean example with full history and a tidy interior for testing." },
    });
    fireEvent.change(screen.getByLabelText(/^Price \(£\)/), {
      target: { value: "12000" },
    });
    fireEvent.change(screen.getByLabelText(/^Region/), {
      target: { value: "iom" },
    });
    fireEvent.change(screen.getByLabelText(/Make/i), {
      target: { value: "Audi" },
    });
    fireEvent.change(screen.getByLabelText(/^Model \(manual entry\)/), {
      target: { value: "A4 S line" },
    });
    fireEvent.change(screen.getByLabelText(/Year/i), {
      target: { value: "2018" },
    });
    fireEvent.change(screen.getByLabelText(/Mileage/i), {
      target: { value: "45000" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByTestId("mock-image-upload"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(
      screen.getByLabelText(
        /I confirm I have authority to advertise this vehicle/
      )
    );
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /I expressly accept the current Private Seller Terms/i,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue to Checkout" }));

    await screen.findByText("Preview the Ripple hosted payment journey");
    expect(
      screen.getByRole("button", { name: "Emulate successful payment" })
    ).toBeTruthy();
    expect(pushMock).not.toHaveBeenCalled();
    expect(window.location.pathname + window.location.search).toBe(
      "/sell/private?draft=listing-456",
    );
    expect(replaceMock).not.toHaveBeenCalledWith("/sell/private?draft=listing-456");
    expect(replaceMock).not.toHaveBeenCalledWith(
      expect.stringContaining("/sell/checkout"),
    );
  });

  it("submits live revisions without opening checkout ALR-PAY-001", async () => {
    vi.mocked(updateListing).mockResolvedValue({
      data: { id: "live-123" },
    } as Awaited<ReturnType<typeof updateListing>>);
    vi.mocked(syncListingImages).mockResolvedValue({
      data: { count: 2, photoRevision: 4 },
    } as Awaited<ReturnType<typeof syncListingImages>>);
    vi.mocked(submitListingForReview).mockResolvedValue({
      data: { id: "live-123" },
    } as unknown as Awaited<ReturnType<typeof submitListingForReview>>);

    render(
      <CreateListingForm
        categories={categories}
        regions={regions}
        mode="private"
        initialDraft={{
          id: "live-123",
          title: "2017 Audi A3 Sport",
          description: "Previously saved live listing with enough detail to remain valid.",
          price: 11250,
          categoryId: "car-category",
          regionId: "iom",
          trustDeclarationAccepted: true,
          featured: false,
          photoRevision: 3,
          editMode: "revision",
          images: [
            {
              id: "img-1",
              url: "https://example.com/existing-1.jpg",
              publicId: "existing-1",
              order: 0,
              provider: "EXTERNAL",
              assetId: null,
              version: null,
              width: 800,
              height: 600,
              format: "jpg",
              bytes: null,
              uploadIntentId: null,
              focalX: null,
              focalY: null,
            },
            {
              id: "img-2",
              url: "https://example.com/existing-2.jpg",
              publicId: "existing-2",
              order: 1,
              provider: "EXTERNAL",
              assetId: null,
              version: null,
              width: 800,
              height: 600,
              format: "jpg",
              bytes: null,
              uploadIntentId: null,
              focalX: null,
              focalY: null,
            },
          ],
          attributes: [
            { attributeDefinitionId: "make", value: "Audi" },
            { attributeDefinitionId: "model", value: "A3 Sport" },
            { attributeDefinitionId: "year", value: "2017" },
            { attributeDefinitionId: "mileage", value: "65000" },
          ],
        }}
      />
    );

    expect(screen.getByText(/The current live listing stays public/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /I expressly accept the current Private Seller Terms/i,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Submit changes for review" }));

    await waitFor(() => {
      expect(submitListingForReview).toHaveBeenCalledWith({
        listingId: "live-123",
        privateSellerTermsAccepted: true,
      });
    });
    expect(payForListing).not.toHaveBeenCalled();
    expect(window.open).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith(
        "/sell/success?listing=live-123&flow=private&payment=skipped"
      );
    });
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("reuses the photo mutation ID after a timed-out synchronization retry", async () => {
    vi.mocked(updateListing).mockResolvedValue({
      data: { id: "draft-retry" },
    } as Awaited<ReturnType<typeof updateListing>>);
    vi.mocked(syncListingImages)
      .mockResolvedValueOnce({
        error: "Request timed out",
      } as Awaited<ReturnType<typeof syncListingImages>>)
      .mockResolvedValueOnce({
        data: { count: 2, photoRevision: 4 },
      } as Awaited<ReturnType<typeof syncListingImages>>);
    vi.mocked(payForListing).mockResolvedValue({
      data: { checkoutUrl: "https://checkout.example/retry" },
    } as Awaited<ReturnType<typeof payForListing>>);

    render(
      <CreateListingForm
        categories={[
          {
            id: "simple-category",
            name: "Other",
            slug: "other",
            attributes: [],
          },
        ]}
        regions={regions}
        mode="private"
        initialDraft={{
          id: "draft-retry",
          title: "Retryable photo listing",
          description: "A complete draft used to verify retry-safe photo synchronization.",
          price: 9000,
          categoryId: "simple-category",
          regionId: "iom",
          trustDeclarationAccepted: true,
          featured: false,
          photoRevision: 3,
          images: [
            {
              id: "img-1",
              url: "https://example.com/existing-1.jpg",
              publicId: "existing-1",
              order: 0,
              provider: "EXTERNAL",
              assetId: null,
              version: null,
              width: 800,
              height: 600,
              format: "jpg",
              bytes: null,
              uploadIntentId: null,
              focalX: 0.25,
              focalY: 0.75,
            },
            {
              id: "img-2",
              url: "https://example.com/existing-2.jpg",
              publicId: "existing-2",
              order: 1,
              provider: "EXTERNAL",
              assetId: null,
              version: null,
              width: 800,
              height: 600,
              format: "jpg",
              bytes: null,
              uploadIntentId: null,
              focalX: null,
              focalY: null,
            },
          ],
          attributes: [],
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /I expressly accept the current Private Seller Terms/i,
      }),
    );
    const submit = screen.getByRole("button", { name: "Continue to Checkout" });
    fireEvent.click(submit);
    await screen.findByText("Request timed out");
    await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));

    fireEvent.click(submit);
    await waitFor(() => expect(syncListingImages).toHaveBeenCalledTimes(2));

    const firstMutationId = vi.mocked(syncListingImages).mock.calls[0][1].mutationId;
    const retryMutationId = vi.mocked(syncListingImages).mock.calls[1][1].mutationId;
    expect(retryMutationId).toBe(firstMutationId);
  });
});

function fillRequiredVehicleDetails() {
  fireEvent.click(screen.getByRole("button", { name: "Cars" }));
  fireEvent.change(screen.getByLabelText(/^Title/), {
    target: { value: "2019 BMW 320d M Sport" },
  });
  fireEvent.change(screen.getByLabelText(/^Description/), {
    target: { value: "A well-kept BMW with full history and plenty of specification." },
  });
  fireEvent.change(screen.getByLabelText(/^Price \(£\)/), {
    target: { value: "15000" },
  });
  fireEvent.change(screen.getByLabelText(/^Region/), {
    target: { value: "iom" },
  });
  fireEvent.change(screen.getByLabelText(/Make/i), {
    target: { value: "BMW" },
  });
  fireEvent.change(screen.getByLabelText(/^Model \(manual entry\)/), {
    target: { value: "320d M Sport" },
  });
  fireEvent.change(screen.getByLabelText(/Year/i), {
    target: { value: "2019" },
  });
  fireEvent.change(screen.getByLabelText(/Mileage/i), {
    target: { value: "45000" },
  });
}

describe("CreateListingForm listing contract WS-17AUG-REG-7C4B", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/");
    fetchMock.mockReset();
    pushMock.mockReset();
    replaceMock.mockReset();
    vi.mocked(createListing).mockReset();
    vi.mocked(syncListingImages).mockReset();
    vi.mocked(submitListingForReview).mockReset();
    vi.mocked(updateListing).mockReset();
    vi.mocked(payForListing).mockReset();
    vi.mocked(simulateDemoListingPaymentOutcome).mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("open", vi.fn());
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  it("LST-VAL-001 keeps step 1 Continue on shared attribute validation errors", () => {
    render(
      <CreateListingForm
        categories={categories}
        regions={regions}
        enforceListingNs
      />,
    );
    fillRequiredVehicleDetails();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getByText("Create Listing - Step 1 of 3")).toBeTruthy();
    expect(
      screen.getByText("Insurance write-off category is required."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue" })).toBeTruthy();
  });

  it("LST-WRITEOFF-001 groups write-off after mileage/fuel and marks it required when NS is on", () => {
    render(
      <CreateListingForm
        categories={categories}
        regions={regions}
        enforceListingNs
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cars" }));

    const writeOff = screen.getByLabelText(/Insurance write-off category/);
    expect(writeOff).toBeTruthy();
    expect(screen.getByText("Insurance write-off category").textContent).toContain(
      "*",
    );

    const labels = screen
      .getAllByText(/^(Fuel Type|Mileage|Insurance write-off category|Engine Size)/)
      .map((node) => node.textContent?.replace(/\s+\*$/, "").trim());
    expect(labels.indexOf("Fuel Type")).toBeLessThan(labels.indexOf("Insurance write-off category"));
    expect(labels.indexOf("Mileage")).toBeLessThan(labels.indexOf("Insurance write-off category"));
    expect(labels.indexOf("Insurance write-off category")).toBeLessThan(
      labels.indexOf("Engine Size"),
    );
  });

  it("LST-PHOTO-CAS-001 applies the winning revision, drops the mutation, and does not auto-retry", async () => {
    vi.mocked(updateListing).mockResolvedValue({
      data: { id: "draft-cas", version: 8 },
    } as Awaited<ReturnType<typeof updateListing>>);
    vi.mocked(syncListingImages).mockResolvedValue({
      error: "These photos were updated elsewhere. Reload and try again.",
      conflict: true,
      photoRevision: 9,
    } as Awaited<ReturnType<typeof syncListingImages>>);

    render(
      <CreateListingForm
        categories={[
          {
            id: "simple-category",
            name: "Other",
            slug: "other",
            attributes: [],
          },
        ]}
        regions={regions}
        mode="private"
        initialDraft={{
          id: "draft-cas",
          title: "Conflict photo listing",
          description: "A complete draft used to verify photo CAS conflict handling.",
          price: 9000,
          categoryId: "simple-category",
          regionId: "iom",
          trustDeclarationAccepted: true,
          featured: false,
          photoRevision: 3,
          images: [
            {
              id: "img-1",
              url: "https://example.com/existing-1.jpg",
              publicId: "existing-1",
              order: 0,
              provider: "EXTERNAL",
              assetId: null,
              version: null,
              width: 800,
              height: 600,
              format: "jpg",
              bytes: null,
              uploadIntentId: null,
              focalX: null,
              focalY: null,
            },
            {
              id: "img-2",
              url: "https://example.com/existing-2.jpg",
              publicId: "existing-2",
              order: 1,
              provider: "EXTERNAL",
              assetId: null,
              version: null,
              width: 800,
              height: 600,
              format: "jpg",
              bytes: null,
              uploadIntentId: null,
              focalX: null,
              focalY: null,
            },
          ],
          attributes: [],
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /I expressly accept the current Private Seller Terms/i,
      }),
    );
    const submit = screen.getByRole("button", { name: "Continue to Checkout" });
    fireEvent.click(submit);

    await screen.findByText("These photos were updated elsewhere. Reload and try again.");
    expect(syncListingImages).toHaveBeenCalledTimes(1);
    expect(payForListing).not.toHaveBeenCalled();
    await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));

    fireEvent.click(submit);
    await waitFor(() => expect(syncListingImages).toHaveBeenCalledTimes(2));
    expect(vi.mocked(syncListingImages).mock.calls[0][1].basePhotoRevision).toBe(8);
    expect(vi.mocked(syncListingImages).mock.calls[1][1].basePhotoRevision).toBe(9);
    expect(vi.mocked(syncListingImages).mock.calls[1][1].mutationId).not.toBe(
      vi.mocked(syncListingImages).mock.calls[0][1].mutationId,
    );
  });

  it("LST-SUBMIT-001 retries with updateListing after create returns an id", async () => {
    vi.mocked(createListing).mockResolvedValue({
      data: { id: "listing-created" },
    } as Awaited<ReturnType<typeof createListing>>);
    vi.mocked(updateListing).mockResolvedValue({
      data: { id: "listing-created" },
    } as Awaited<ReturnType<typeof updateListing>>);
    vi.mocked(syncListingImages).mockResolvedValue({
      data: { count: 2, photoRevision: 1 },
    } as Awaited<ReturnType<typeof syncListingImages>>);
    vi.mocked(payForListing)
      .mockResolvedValueOnce({
        error: "Payment setup failed. Please try again.",
      } as Awaited<ReturnType<typeof payForListing>>)
      .mockResolvedValueOnce({
        data: { checkoutUrl: "https://checkout.example/retry" },
      } as Awaited<ReturnType<typeof payForListing>>);

    render(<CreateListingForm categories={categories} regions={regions} mode="private" />);
    fillRequiredVehicleDetails();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByTestId("mock-image-upload"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(
      screen.getByLabelText(/I confirm I have authority to advertise this vehicle/),
    );
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /I expressly accept the current Private Seller Terms/i,
      }),
    );
    const submit = screen.getByRole("button", { name: "Continue to Checkout" });
    fireEvent.click(submit);
    await screen.findByText("Payment setup failed. Please try again.");
    await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));

    fireEvent.click(submit);
    await waitFor(() => expect(payForListing).toHaveBeenCalledTimes(2));
    expect(createListing).toHaveBeenCalledTimes(1);
    expect(updateListing).toHaveBeenCalledWith(
      expect.objectContaining({ id: "listing-created" }),
    );
  });

  it("LST-SUBMIT-ERROR-002 keeps object payment errors visible on step 3 and retries the saved draft", async () => {
    vi.mocked(createListing).mockResolvedValue({
      data: { id: "listing-object-error" },
    } as Awaited<ReturnType<typeof createListing>>);
    vi.mocked(updateListing).mockResolvedValue({
      data: { id: "listing-object-error" },
    } as Awaited<ReturnType<typeof updateListing>>);
    vi.mocked(syncListingImages).mockResolvedValue({
      data: { count: 2, photoRevision: 1 },
    } as Awaited<ReturnType<typeof syncListingImages>>);
    vi.mocked(payForListing)
      .mockResolvedValueOnce({
        error: {
          privateSellerTermsAccepted: [
            "Private seller terms acceptance is required.",
          ],
        },
      } as Awaited<ReturnType<typeof payForListing>>)
      .mockResolvedValueOnce({
        data: { checkoutUrl: "https://checkout.example/object-error-retry" },
      } as Awaited<ReturnType<typeof payForListing>>);

    render(<CreateListingForm categories={categories} regions={regions} mode="private" />);
    fillRequiredVehicleDetails();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByTestId("mock-image-upload"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(
      screen.getByLabelText(/I confirm I have authority to advertise this vehicle/),
    );
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /I expressly accept the current Private Seller Terms/i,
      }),
    );

    const submit = screen.getByRole("button", { name: "Continue to Checkout" });
    fireEvent.click(submit);

    await screen.findByText("Private seller terms acceptance is required.");
    expect(screen.getByText("Create Listing - Step 3 of 3")).toBeTruthy();
    await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));

    fireEvent.click(submit);
    await waitFor(() => expect(payForListing).toHaveBeenCalledTimes(2));
    expect(createListing).toHaveBeenCalledTimes(1);
    expect(updateListing).toHaveBeenCalledWith(
      expect.objectContaining({ id: "listing-object-error" }),
    );
  });

  it("LST-SUBMIT-001 LST-PHOTO-CAS-001 preserves photo mutationId across payment failure", async () => {
    vi.mocked(createListing).mockResolvedValue({
      data: { id: "listing-created" },
    } as Awaited<ReturnType<typeof createListing>>);
    vi.mocked(updateListing).mockResolvedValue({
      data: { id: "listing-created" },
    } as Awaited<ReturnType<typeof updateListing>>);
    vi.mocked(syncListingImages).mockResolvedValue({
      data: { count: 2, photoRevision: 1 },
    } as Awaited<ReturnType<typeof syncListingImages>>);
    vi.mocked(payForListing)
      .mockResolvedValueOnce({
        error: "Payment setup failed. Please try again.",
      } as Awaited<ReturnType<typeof payForListing>>)
      .mockResolvedValueOnce({
        data: { checkoutUrl: "https://checkout.example/retry" },
      } as Awaited<ReturnType<typeof payForListing>>);

    render(<CreateListingForm categories={categories} regions={regions} mode="private" />);
    fillRequiredVehicleDetails();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByTestId("mock-image-upload"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(
      screen.getByLabelText(/I confirm I have authority to advertise this vehicle/),
    );
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /I expressly accept the current Private Seller Terms/i,
      }),
    );
    const submit = screen.getByRole("button", { name: "Continue to Checkout" });
    fireEvent.click(submit);
    await screen.findByText("Payment setup failed. Please try again.");
    await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(submit);
    await waitFor(() => expect(syncListingImages).toHaveBeenCalledTimes(2));

    expect(vi.mocked(syncListingImages).mock.calls[0][1].mutationId).toBe(
      vi.mocked(syncListingImages).mock.calls[1][1].mutationId,
    );
  });

  it("LST-DRAFT-NAV-002 LST-CHECKOUT-NAV-002 updates the draft URL without router navigation before checkout", async () => {
    const historyReplaceSpy = vi.spyOn(window.history, "replaceState");
    vi.mocked(createListing).mockResolvedValue({
      data: { id: "listing-redirect" },
    } as Awaited<ReturnType<typeof createListing>>);
    vi.mocked(syncListingImages).mockResolvedValue({
      data: { count: 2, photoRevision: 1 },
    } as Awaited<ReturnType<typeof syncListingImages>>);
    vi.mocked(payForListing).mockResolvedValue({
      data: { checkoutUrl: "https://checkout.example/pay/redirect" },
    } as Awaited<ReturnType<typeof payForListing>>);

    render(<CreateListingForm categories={categories} regions={regions} mode="private" />);
    fillRequiredVehicleDetails();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByTestId("mock-image-upload"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(
      screen.getByLabelText(/I confirm I have authority to advertise this vehicle/),
    );
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /I expressly accept the current Private Seller Terms/i,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue to Checkout" }));

    await waitFor(() => {
      expect(historyReplaceSpy).toHaveBeenCalledWith(
        null,
        "",
        "/sell/private?draft=listing-redirect",
      );
      expect(replaceMock).toHaveBeenCalledWith(
        "/sell/checkout?listing=listing-redirect&flow=private&opened=1",
      );
    });
    expect(window.location.pathname + window.location.search).toBe(
      "/sell/private?draft=listing-redirect",
    );
    expect(replaceMock).not.toHaveBeenCalledWith(
      "/sell/private?draft=listing-redirect",
    );
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("LST-SUBMIT-001 blocks a second in-flight submit until a recoverable outcome", async () => {
    let releaseCreate: ((value: Awaited<ReturnType<typeof createListing>>) => void) | undefined;
    vi.mocked(createListing).mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseCreate = resolve;
        }),
    );
    vi.mocked(syncListingImages).mockResolvedValue({
      data: { count: 2, photoRevision: 1 },
    } as Awaited<ReturnType<typeof syncListingImages>>);
    vi.mocked(payForListing).mockResolvedValue({
      data: { checkoutUrl: "https://checkout.example/flight" },
    } as Awaited<ReturnType<typeof payForListing>>);

    render(<CreateListingForm categories={categories} regions={regions} mode="private" />);
    fillRequiredVehicleDetails();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByTestId("mock-image-upload"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(
      screen.getByLabelText(/I confirm I have authority to advertise this vehicle/),
    );
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /I expressly accept the current Private Seller Terms/i,
      }),
    );
    const submit = screen.getByRole("button", { name: "Continue to Checkout" });
    fireEvent.click(submit);
    fireEvent.click(submit);

    await waitFor(() => expect(createListing).toHaveBeenCalledTimes(1));
    releaseCreate?.({ data: { id: "listing-flight" } } as Awaited<
      ReturnType<typeof createListing>
    >);
  });
});

describe("create-listing-submit helpers WS-17AUG-REG-7C4B", () => {
  it("LST-SUBMIT-ERROR-002 summarizes the first actionable field error", () => {
    expect(
      summarizeListingSubmitFieldErrors(
        {
          listingId: [],
          privateSellerTermsAccepted: ["Private seller terms acceptance is required."],
        },
        "Fallback",
      ),
    ).toBe("Private seller terms acceptance is required.");
    expect(summarizeListingSubmitFieldErrors({}, "Fallback")).toBe("Fallback");
  });

  it("LST-SUBMIT-001 chooses update once a listing id exists", () => {
    expect(chooseListingWriteAction(null)).toBe("create");
    expect(chooseListingWriteAction("listing-1")).toBe("update");
  });

  it("LST-PHOTO-CAS-001 uses returned revision version after live update", () => {
    expect(nextPhotoRevisionAfterListingSave({ version: 8, photoRevision: 3 })).toBe(8);
    expect(nextPhotoRevisionAfterListingSave({ photoRevision: 4 })).toBe(4);
    expect(nextPhotoRevisionAfterListingSave({})).toBeNull();
    expect(applyAuthoritativePhotoRevision(9, 8)).toBe(9);
    expect(applyAuthoritativePhotoRevision(3, 8)).toBe(8);
  });

  it("LST-PHOTO-CAS-001 reuses a mutation id only for unchanged photo content", () => {
    const pending = {
      basePhotoRevision: 3,
      photoSignature: "same",
      mutationId: "mut-1",
    };
    expect(
      resolvePhotoMutation({
        pending,
        basePhotoRevision: 3,
        photoSignature: "same",
        createMutationId: () => "mut-new",
      }).mutationId,
    ).toBe("mut-1");
    expect(
      resolvePhotoMutation({
        pending,
        basePhotoRevision: 4,
        photoSignature: "same",
        createMutationId: () => "mut-new",
      }).mutationId,
    ).toBe("mut-1");
    expect(
      resolvePhotoMutation({
        pending,
        basePhotoRevision: 3,
        photoSignature: "changed",
        createMutationId: () => "mut-new",
      }).mutationId,
    ).toBe("mut-new");
  });

  it("LST-PHOTO-CAS-001 interprets conflict without retrying the winning revision", () => {
    expect(
      interpretPhotoSyncResult({
        error: "These photos were updated elsewhere. Reload and try again.",
        conflict: true,
        photoRevision: 9,
      }),
    ).toEqual({
      kind: "conflict",
      photoRevision: 9,
      error: "These photos were updated elsewhere. Reload and try again.",
    });
    expect(
      interpretPhotoSyncResult({ data: { photoRevision: 4 } }),
    ).toEqual({ kind: "success", photoRevision: 4, keepMutation: true });
  });

  it("LST-SUBMIT-001 uses a synchronous submit-flight latch", () => {
    const inFlight = { current: false };
    expect(tryBeginSubmitFlight(inFlight)).toBe(true);
    expect(tryBeginSubmitFlight(inFlight)).toBe(false);
    inFlight.current = false;
    expect(tryBeginSubmitFlight(inFlight)).toBe(true);
  });
});
