import { expect, it, vi } from "vitest";
import { htmlStructuredConnector } from "@/scripts/dealer-stock-sync/connectors/html-structured";
import { emptyVehicle } from "@/scripts/dealer-stock-sync/connectors/contract";
import { getDealer } from "@/scripts/dealer-stock-sync/registry";
it("preserves the detailed sales description instead of replacing it with a short metadata summary", async () => {
  const dealer = getDealer("mikes-motors"); const source = dealer.sources[0]!;
  const description = "Volkswagen Transporter 4 Berth Camper Van, pop-top conversion, kitchen and rock and roll bed.";
  const context = { dealer, source, fetchImpl: vi.fn(async () => new Response('<meta name="description" content="Transporter, Manual, White.">')) as typeof fetch };
  const v = emptyVehicle(context, { make: "VOLKSWAGEN", model: "TRANSPORTER", description, vehicleType: "motorhome", detailUrl: "https://www.mikesmotors.im/used-vw-8219839" });
  const result = await htmlStructuredConnector.fetchDetails(context, [v]);
  expect(result.vehicles[0]?.description).toBe(description);
  expect(result.vehicles[0]?.vehicleType).toBe("motorhome");
});
