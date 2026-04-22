import * as React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CreateListingForm } from "@/app/(public)/sell/create-listing-form";
import { createListing, saveListingImages, submitListingForReview } from "@/actions/listings";
import {
  payForListing,
  simulateDemoListingPaymentOutcome,
} from "@/actions/payments";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/actions/listings", () => ({
  createListing: vi.fn(),
  saveListingImages: vi.fn(),
  submitListingForReview: vi.fn(),
}));

vi.mock("@/actions/payments", () => ({
  payForListing: vi.fn(),
  simulateDemoListingPaymentOutcome: vi.fn(),
}));

vi.mock("@/components/marketplace/image-upload", () => ({
  ImageUpload: ({
    onImagesChange,
  }: {
    onImagesChange: (
      images: Array<{ url: string; publicId: string; order: number }>
    ) => void;
  }) => (
    <button
      type="button"
      data-testid="mock-image-upload"
      onClick={() =>
        onImagesChange([
          {
            url: "https://example.com/image-1.jpg",
            publicId: "image-1",
            order: 0,
          },
          {
            url: "https://example.com/image-2.jpg",
            publicId: "image-2",
            order: 1,
          },
        ])
      }
    >
      Add mock images
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
        options: JSON.stringify(["Petrol", "Diesel", "Electric", "Hybrid", "Plug-in Hybrid"]),
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
        options: JSON.stringify(["Petrol", "Diesel", "Electric", "Hybrid", "Plug-in Hybrid"]),
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

const regions = [{ id: "iom", name: "Douglas" }];

describe("CreateListingForm registration lookup", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    pushMock.mockReset();
    vi.mocked(createListing).mockReset();
    vi.mocked(saveListingImages).mockReset();
    vi.mocked(submitListingForReview).mockReset();
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
    expect((screen.getByLabelText(/Model/i) as HTMLInputElement).value).toBe("A 200 AMG LINE");
    expect((screen.getByLabelText(/Year/i) as HTMLInputElement).value).toBe("2020");
    expect((screen.getByLabelText(/Fuel Type/i) as HTMLSelectElement).value).toBe("Petrol");
    expect((screen.getByLabelText(/Colour/i) as HTMLSelectElement).value).toBe("Grey");
    expect((screen.getByLabelText(/Mileage/i) as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe(
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
    expect((screen.getByLabelText(/Model/i) as HTMLInputElement).value).toBe("");
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
    expect((screen.getByLabelText(/Model/i) as HTMLInputElement).value).toBe("CBR600RR");
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe(
      "2019 Honda CBR600RR"
    );
  });

  it("opens hosted checkout in a new tab and moves the original tab to checkout status", async () => {
    vi.mocked(createListing).mockResolvedValue({
      data: { id: "listing-123" },
    } as Awaited<ReturnType<typeof createListing>>);
    vi.mocked(saveListingImages).mockResolvedValue({
      data: { count: 0 },
    } as Awaited<ReturnType<typeof saveListingImages>>);
    vi.mocked(submitListingForReview).mockResolvedValue({
      data: null,
    } as Awaited<ReturnType<typeof submitListingForReview>>);
    vi.mocked(payForListing).mockResolvedValue({
      data: { checkoutUrl: "https://checkout.example/pay/123" },
    } as Awaited<ReturnType<typeof payForListing>>);

    render(
      <CreateListingForm categories={categories} regions={regions} mode="private" />
    );

    fireEvent.click(screen.getByRole("button", { name: "Cars" }));
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "2019 BMW 320d M Sport" },
    });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "A well-kept BMW with full history and plenty of specification." },
    });
    fireEvent.change(screen.getByLabelText("Price (£)"), {
      target: { value: "15000" },
    });
    fireEvent.change(screen.getByLabelText("Region"), {
      target: { value: "iom" },
    });
    fireEvent.change(screen.getByLabelText(/Make/i), {
      target: { value: "BMW" },
    });
    fireEvent.change(screen.getByLabelText(/Model/i), {
      target: { value: "320d M Sport" },
    });
    fireEvent.change(screen.getByLabelText(/Year/i), {
      target: { value: "2019" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByTestId("mock-image-upload"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(
      screen.getByLabelText(
        "I confirm this vehicle is not stolen and has no outstanding finance"
      )
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue to Checkout" }));

    await waitFor(() => {
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

  it("keeps demo checkout inside the Ripple modal instead of redirecting the original tab", async () => {
    vi.mocked(createListing).mockResolvedValue({
      data: { id: "listing-456" },
    } as Awaited<ReturnType<typeof createListing>>);
    vi.mocked(saveListingImages).mockResolvedValue({
      data: { count: 0 },
    } as Awaited<ReturnType<typeof saveListingImages>>);
    vi.mocked(payForListing).mockResolvedValue({
      data: {
        checkoutUrl: "https://portal.startyourripple.co.uk/card/demo-gym/checkout-123",
      },
    } as Awaited<ReturnType<typeof payForListing>>);

    render(
      <CreateListingForm categories={categories} regions={regions} mode="private" />
    );

    fireEvent.click(screen.getByRole("button", { name: "Cars" }));
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "2018 Audi A4 S line" },
    });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "Clean example with full history and a tidy interior for testing." },
    });
    fireEvent.change(screen.getByLabelText("Price (£)"), {
      target: { value: "12000" },
    });
    fireEvent.change(screen.getByLabelText("Region"), {
      target: { value: "iom" },
    });
    fireEvent.change(screen.getByLabelText(/Make/i), {
      target: { value: "Audi" },
    });
    fireEvent.change(screen.getByLabelText(/Model/i), {
      target: { value: "A4 S line" },
    });
    fireEvent.change(screen.getByLabelText(/Year/i), {
      target: { value: "2018" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByTestId("mock-image-upload"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(
      screen.getByLabelText(
        "I confirm this vehicle is not stolen and has no outstanding finance"
      )
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue to Checkout" }));

    await screen.findByText("Preview the Ripple hosted payment journey");
    expect(
      screen.getByRole("button", { name: "Emulate successful payment" })
    ).toBeTruthy();
    expect(pushMock).not.toHaveBeenCalled();
  });
});
