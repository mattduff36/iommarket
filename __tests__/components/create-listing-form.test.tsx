import * as React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CreateListingForm } from "@/app/(public)/sell/create-listing-form";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/actions/listings", () => ({
  createListing: vi.fn(),
  saveListingImages: vi.fn(),
  submitListingForReview: vi.fn(),
}));

vi.mock("@/actions/payments", () => ({
  payForListing: vi.fn(),
}));

vi.mock("@/components/marketplace/image-upload", () => ({
  ImageUpload: () => <div data-testid="mock-image-upload" />,
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
    vi.stubGlobal("fetch", fetchMock);
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
});
