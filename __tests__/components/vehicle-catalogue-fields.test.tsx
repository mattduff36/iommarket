// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { VehicleCatalogueFields } from "@/app/(public)/sell/vehicle-catalogue-fields";

const props = {
  makeAttribute: { id: "make", name: "Make", required: true },
  modelAttribute: { id: "model", name: "Model", required: true },
  makes: [], makeValue: "Volvo", required: true,
  onChange: vi.fn(), onSelectionChange: vi.fn(),
};
describe("linked IOM model and trim fields", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ["Ford", "AB-12", "AB12"],
    ["Porsche", "S", "Cayman S"],
    ["Mercedes-Benz", "AMG LINE", "A-Class"],
  ])("does not infer %s %s from punctuation or ambiguous aliases", async (make, raw, catalogue) => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true, json: async () => ({ models: [{ id: "model", name: catalogue, aliases: [raw] }] }),
    })));
    render(<VehicleCatalogueFields {...props} makeValue={make} modelValue={raw}
      makes={[{ id: "make", name: make, normalizedName: make.toLowerCase().replace(/[^a-z]/g, "") }]} />);
    await waitFor(() => expect(screen.getByLabelText(/Model \(manual entry\)/)).toHaveValue(raw));
    expect(props.onChange).not.toHaveBeenCalledWith("model", catalogue);
  });

  it("formats safe make-scoped spellings while retaining the remaining trim", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true, json: async () => ({ models: [{ id: "crv", name: "CR-V", aliases: ["CRV"] }] }),
    })));
    render(<VehicleCatalogueFields {...props} makeValue="Honda" modelValue="CRV EX"
      makes={[{ id: "honda", name: "Honda", normalizedName: "honda" }]} />);
    await waitFor(() => expect(props.onChange).toHaveBeenCalledWith("model", "CR-V EX"));
    expect(props.onSelectionChange).toHaveBeenLastCalledWith(expect.objectContaining({
      canonicalMake: "Honda", canonicalModel: "CR-V", variant: "EX",
    }));
  });

  it("displays the base model and supplied trim separately without catalogue data", () => {
    render(<VehicleCatalogueFields {...props} modelValue="V50 R-DESIGN EDIT D2" variantHint="R-DESIGN EDIT D2" />);
    expect(screen.getByLabelText(/Model \(manual entry\)/)).toHaveValue("V50");
    expect(screen.getByLabelText(/Variant \/ trim/)).toHaveValue("R-DESIGN EDIT D2");
    expect(props.onSelectionChange).toHaveBeenLastCalledWith(expect.objectContaining({ variant: "R-DESIGN EDIT D2" }));
  });
  it("splits an external lookup update but preserves subsequent manual edits", () => {
    const { rerender } = render(<VehicleCatalogueFields {...props} modelValue="" />);
    rerender(<VehicleCatalogueFields {...props} modelValue="V50 R-DESIGN EDIT D2" variantHint="R-DESIGN EDIT D2" />);
    const model = screen.getByLabelText(/Model \(manual entry\)/);
    expect(model).toHaveValue("V50");
    fireEvent.change(model, { target: { value: "V60" } });
    expect(props.onChange).toHaveBeenLastCalledWith("model", "V60 R-DESIGN EDIT D2");
    rerender(<VehicleCatalogueFields {...props} modelValue="V60 R-DESIGN EDIT D2" variantHint="R-DESIGN EDIT D2" />);
    expect(model).toHaveValue("V60");
  });
  it("does not guess how to split an unrelated manual model", () => {
    render(<VehicleCatalogueFields {...props} modelValue="V50 SE" variantHint="R-DESIGN EDIT D2" />);
    expect(screen.getByLabelText(/Model \(manual entry\)/)).toHaveValue("V50 SE");
  });
});
