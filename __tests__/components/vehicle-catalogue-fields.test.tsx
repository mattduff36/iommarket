// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { VehicleCatalogueFields } from "@/app/(public)/sell/vehicle-catalogue-fields";

const props = {
  makeAttribute: { id: "make", name: "Make", required: true },
  modelAttribute: { id: "model", name: "Model", required: true },
  makes: [], makeValue: "Volvo", required: true,
  onChange: vi.fn(), onSelectionChange: vi.fn(),
};
describe("linked IOM model and trim fields", () => {
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
