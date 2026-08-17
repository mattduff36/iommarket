import * as React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CreateListingForm } from "@/app/(public)/sell/create-listing-form";
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
import { FUEL_TYPE_OPTIONS } from "@/lib/constants/fuel-types";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

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

const fetchMock = vi.fn();

const categories = [
  {
    id: "car-category",
    name: "Cars",
    slug: "car",
    attributes: [
      { id: "make", name: "Make", slug: "make", dataType: "text", required: true, options: null },
      { id: "model", name: "Model", slug: "model", dataType: "text", required: true, options: null },
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
    fetchMock.mockReset();
    pushMock.mockReset();
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
      fireEvent.change(screen.getByLabelText(/^Manual model fallback/), {
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
            make: "MERCEDES BENZ",
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
    expect((screen.getByLabelText(/^Manual model fallback/) as HTMLInputElement).value).toBe("A 200 AMG LINE");
    expect((screen.getByLabelText(/Year/i) as HTMLInputElement).value).toBe("2020");
    expect((screen.getByLabelText(/Fuel Type/i) as HTMLSelectElement).value).toBe("Petrol");
    expect((screen.getByLabelText(/Colour/i) as HTMLSelectElement).value).toBe("Grey");
    expect((screen.getByLabelText(/Mileage/i) as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText(/^Title/) as HTMLInputElement).value).toBe(
      "2020 Mercedes-Benz A 200 AMG LINE"
    );
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
    expect((screen.getByLabelText(/^Manual model fallback/) as HTMLInputElement).value).toBe("");
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
            make: "HONDA",
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
    expect((screen.getByLabelText(/^Manual model fallback/) as HTMLInputElement).value).toBe("CBR600RR");
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
    fireEvent.change(screen.getByLabelText(/^Manual model fallback/), {
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
      expect(pushMock).toHaveBeenCalledWith(
        "/sell/checkout?listing=listing-123&flow=private&opened=1"
      );
    });
  });

  it("updates an existing draft instead of creating a new listing", async () => {
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
      expect(pushMock).toHaveBeenCalledWith(
        "/sell/checkout?listing=draft-123&flow=private&opened=1"
      );
    });
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
    fireEvent.change(screen.getByLabelText(/^Manual model fallback/), {
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
      expect(pushMock).toHaveBeenCalledWith(
        "/sell/success?listing=live-123&flow=private&payment=skipped"
      );
    });
  });
});
