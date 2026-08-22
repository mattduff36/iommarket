import { describe, expect, it } from "vitest";
import {
  discoverStockPageUrls,
  extractAutowebListings,
  nextAutowebPageUrl,
  sequentialStockPageUrls,
  stockPageQueue,
} from "../../../scripts/dealer-stock-sync/connectors/html-extract";
import {
  extractBudgetInventoryCards,
  extractCdinvCards,
  extractDwCarViews,
  extractSelectPropertyListings,
  extractSnccCarItems,
  extractDragon2000Stocklist,
  extractTdInventoryCards,
  parseYearMakeModel,
} from "../../../scripts/dealer-stock-sync/connectors/named-html";
import {
  extractBettridgeMotorCards,
  extractDealerWebsitesCards,
  extractDetailSpecs,
  extractFranklinsListBoxes,
  extractKingswoodPreowned,
  extractManxVehicleCards,
  extractRexSalesBoxes,
  extractClickDealerListings,
  extractPhilShawProducts,
  extractSwiftBskCards,
} from "../../../scripts/dealer-stock-sync/connectors/named-html-more";
import { mapReconciledVehicle } from "../../../scripts/dealer-stock-sync/map-listing";
import { normalizeWebsiteVehicle } from "../../../scripts/dealer-stock-sync/connectors/website-source";
import { dealerFixture } from "./fixtures";

const AUTOWEB_CARD = `
<div class="us-result-grid flexi-height_child radius" data-vehicle-id="21911132">
  <a href="/used/fiat/500/120th-special-edition/kirk-michael/isle-of-man/21911132" data-title="2019 (19) Fiat 500">2019 (19) Fiat 500</a>
  <div class="us-result-price"><div class="Price"><strong> £7,695 </strong></div></div>
  <div class="us-result-spec"><span class="us-result-spec-name">Gearbox:</span><strong>Manual</strong></div>
  <div class="us-result-spec"><span class="us-result-spec-name">Bodystyle:</span><strong>Hatchback</strong></div>
  <div class="us-result-spec"><span class="us-result-spec-name">Fuel Type:</span><strong>Petrol</strong></div>
  <div class="us-result-spec"><span class="us-result-spec-name">Engine Size:</span><strong>1200 cc </strong></div>
  <div class="us-result-spec"><span class="us-result-spec-name">Mileage:</span><strong>44,600 miles</strong></div>
</div>
<a href="/used-cars/page/2">Next</a>
`;

describe("Autoweb HTML extract", () => {
  it("parses Autoweb result cards into importable vehicles", () => {
    const cards = extractAutowebListings(AUTOWEB_CARD, "https://www.bcccars.im");
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      sourceVehicleId: "21911132",
      year: 2019,
      make: "Fiat",
      model: "500",
      price: 7695,
      mileage: "44,600 miles",
      fuel: "Petrol",
      transmission: "Manual",
    });
    expect(nextAutowebPageUrl(AUTOWEB_CARD, "https://www.bcccars.im", 1)).toBe(
      "https://www.bcccars.im/used-cars/page/2",
    );

    const dealer = dealerFixture({ key: "bcc-cars", connectorKey: "autoweb" });
    const vehicle = normalizeWebsiteVehicle(cards[0], {
      dealer,
      source: dealer.sources[0]!,
    });
    expect(vehicle?.sourceVehicleId).toBe("21911132");
    expect(vehicle?.mileage).toBe(44600);
    expect(vehicle?.pricePence).toBe(769500);
    const mapped = mapReconciledVehicle({
      identityKey: "sourceVehicleId:21911132",
      identityKind: "sourceVehicleId",
      sources: ["used-cars"],
      preferredSource: "used-cars",
      vehicle: vehicle!,
      priceMismatch: false,
      identityConflict: false,
      conflictReason: null,
      contentHash: "x",
    });
    expect(mapped.listing).not.toBeNull();
  });
});

describe("named HTML extractors", () => {
  it("splits year/make/model including two-word makes", () => {
    expect(parseYearMakeModel("2022 Land Rover Defender 110")).toMatchObject({
      year: 2022,
      make: "Land Rover",
      model: "Defender 110",
    });
  });

  it("parses MotorX cdinv cards", () => {
    const html = `
      <a class="cdinv-card" href="https://motorx.im/car/2014-hyundai-ix35-crdi/">
        <span class="cdinv-badge">2014</span>
        <div class="cdinv-card__price-badge">£5,495</div>
        <div class="cdinv-card__title">2014 Hyundai IX35 CRDI</div>
        <span class="cdinv-chip">61,000 miles</span>
      </a>`;
    const cards = extractCdinvCards(html, "https://motorx.im");
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      year: 2014,
      make: "Hyundai",
      model: "IX35 CRDI",
      price: 5495,
      mileage: 61000,
    });
  });

  it("parses Select property listings", () => {
    const html = `
      <div class="property-listing">
        <a href="/isle-of-man-used-cars/5803/2020-mercedes-e-sprinter">x</a>
        <h4 class="media-heading">
          <a href="/isle-of-man-used-cars/5803/2020-mercedes-e-sprinter">2020 MERCEDES E-SPRINTER L2<small>£ 9,995.00 </small></a>
        </h4>
        <p>ONLY 31,635 Miles with Full Service History</p>
      </div>`;
    const cards = extractSelectPropertyListings(html, "http://www.selectcarsales.co.im");
    expect(cards[0]).toMatchObject({
      year: 2020,
      make: "MERCEDES",
      model: "E-SPRINTER L2",
      price: 9995,
      mileage: 31635,
      sourceVehicleId: "5803",
    });
  });

  it("parses DW car-view cards and SNCC new-price rows", () => {
    const dw = extractDwCarViews(
      `<div class="car-view1-wrapper">
        <div class="txt1">Dacia DUSTER 1.3 TCe Extreme</div>
        <div class="txt6">In Stock - &pound;15350.00</div>
        <div class="txt5">11000 Miles</div>
        <div class="txt6">2024 / Manual / Petrol</div>
        <a href="details_00625.html">VIEW</a>
      </div>`,
      "https://www.dwcars.info",
    );
    expect(dw[0]).toMatchObject({ make: "Dacia", model: "DUSTER 1.3 TCe Extreme", year: 2024, price: 15350, mileage: 11000 });

    const sncc = extractSnccCarItems(
      `<li><i class="fas fa-calendar-alt"></i> 2022</li>
       <li><i class="glyph-icon flaticon-gas-station"></i> 23323</li>
       <a href="https://sncc.im/cars/2022-land-rover-defender-110-2-0/">2022 Land Rover Defender 110 2.0</a>
       <div class="price car-price"><bdi class="new-price"><span class="currency">&pound;</span>59,995.00</bdi></div>`,
      "https://sncc.im",
    );
    expect(sncc[0]).toMatchObject({
      year: 2022,
      make: "Land Rover",
      model: "Defender 110 2.0",
      price: 59995,
      mileage: 23323,
    });
  });

  it("parses TD slug cards and Budget uuid cards", () => {
    const td = extractTdInventoryCards(
      `<a href="/inventory/2019-bmw-3-series-330i-m-sport"><h3>BMW 3 Series</h3><p class="line-clamp-2">330i M Sport</p><div>£24,990</div><span>2019</span><span>50,139 miles</span></a>`,
      "https://www.tdcar.im",
    );
    expect(td[0]).toMatchObject({ make: "BMW", model: "3 Series", year: 2019, price: 24990, mileage: 50139 });

    const tdUuid = extractTdInventoryCards(
      `<a href="/inventory/73b87fae-ba7e-48ba-a587-d09aa6fe954f"><h3>2018 Audi A3</h3><span>44,000 miles</span><div>£12,995</div></a>`,
      "https://www.tdcar.im",
    );
    expect(tdUuid[0]).toMatchObject({ make: "Audi", model: "A3", year: 2018, mileage: 44000, price: 12995 });

    const tdNamed = extractTdInventoryCards(
      `<a href="/inventory/suzuki-vitara"><h3>Suzuki Vitara</h3><span>2016</span><span>70,800 miles</span><div>£7,895</div></a>`,
      "https://www.tdcar.im",
    );
    expect(tdNamed[0]).toMatchObject({ make: "Suzuki", model: "Vitara", year: 2016, mileage: 70800, price: 7895 });

    const budget = extractBudgetInventoryCards(
      `<a href="/inventory/73b87fae-ba7e-48ba-a587-d09aa6fe954f"><div>£<!-- -->5,495</div><h2>HYUNDAI <!-- -->IX35 PREMIUM 4x4</h2><span>2012</span><span>68,000<!-- --> miles</span></a>`,
      "https://www.budgetcars.im",
    );
    expect(budget[0]).toMatchObject({
      make: "HYUNDAI",
      model: "IX35 PREMIUM 4x4",
      year: 2012,
      price: 5495,
      mileage: 68000,
    });
  });

  it("parses Dragon2000 stocklist cards", () => {
    const cards = extractDragon2000Stocklist(
      `<div class="stocklist-vehicle vehicle_card_style_global_5">
        <a href="https://bvsvehicles.com/vehicle-details/used-mercedes-benz-glb-u2266/" title="View Mercedes-Benz GLB"></a>
        <img src="https://img.cdn.dragon2000.net/C3656/U2266/IMG_1200-medium.jpg" alt="2021 Mercedes-Benz GLB Image 1">
        <button data-stock-nr="U2266"></button>
        <h4 class="variant">GLB200 AMG Line</h4>
        <li class="modelYear">2021</li>
        <li class="mileageText">58,000 Mls</li>
        <div class="price priceTextBasic">£24,995</div>
      </div>`,
      "https://bvsvehicles.com",
    );
    expect(cards[0]).toMatchObject({
      year: 2021,
      make: "Mercedes-Benz",
      model: "GLB",
      price: 24995,
      mileage: 58000,
      sourceVehicleId: "U2266",
    });
  });

  it("parses Franklins, Manx, Kingswood, Rex, Ingear and Bettridge cards", () => {
    const franklins = extractFranklinsListBoxes(
      `<div class="list-box-wrapper grid-view">
        <div class="view-car-details"><h2><strong>MERCEDES-BENZ</strong> A CLASS</h2><h3>Saloon 2.0 A35 AMG (2019)</h3></div>
        <ul><li title='Miles'>30,850 Miles</li><li title='Fuel'>Petrol</li></ul>
        <a href="https://www.franklins.co.im/cars/mercedes-benz/aclass/2.0-a35-amg/1591090/">VIEW</a>
        <div class="car-actual-price">&pound;22,999</div>
      </div>`,
      "https://www.franklins.co.im",
    );
    expect(franklins[0]).toMatchObject({ make: "MERCEDES-BENZ", model: "A CLASS", year: 2019, price: 22999, mileage: 30850 });

    const manx = extractManxVehicleCards(
      `<div class="card text-bg-primary h-100 vehicle">
        <div class="card-body" data-finance="{&quot;Id&quot;:&quot;abc-1&quot;,&quot;Price&quot;:16995.0,&quot;RegDate&quot;:&quot;2025-06-30T00:00:00&quot;,&quot;VRM&quot;:&quot;TMN632E&quot;,&quot;Mileage&quot;:5125}">
          <a href="/vehicle/toyota-aygo-x-in-isle-of-man-abc-1">
            <div class="makemodel">Toyota Aygo</div>
            <div class="version">X 1.0</div>
            <div class="price">£16,995</div>
          </a>
        </div>
      </div>`,
      "https://www.manxcarstore.com",
    );
    expect(manx[0]).toMatchObject({ make: "Toyota", model: "Aygo", year: 2025, price: 16995, mileage: 5125, registration: "TMN632E" });

    const kingswood = extractKingswoodPreowned(
      `<div class="showroom-preowned-cars-container">
        <a href="https://www.kingswood-honda.com/preowned-cars/2025-honda-crv-hybrid/">x</a>
        <h3>2025 Honda CRV 2.0 i-MMD Hybrid</h3>
        <h3 class="price">£39,950</h3>
      </div>`,
      "https://www.kingswood-honda.com",
    );
    expect(kingswood[0]).toMatchObject({ year: 2025, make: "Honda", model: "CRV 2.0 i-MMD Hybrid", price: 39950 });

    const rex = extractRexSalesBoxes(
      `<div class="vehicles-list" id="latest-vehicles">
        <a class="box" href="/sales/volkswagen-golf-2-0-tsi-gti-dsg">
          FOR SALE - <strong>&pound;32,999</strong>
          <h2>Volkswagen Golf 2.0 TSI GTI 5dr DSG</h2>
        </a>
      </div>`,
      "https://www.rexmotorcompany.im",
    );
    expect(rex[0]).toMatchObject({ make: "Volkswagen", model: "Golf 2.0 TSI GTI 5dr DSG", price: 32999 });

    const ingear = extractDealerWebsitesCards(
      `<a href="https://www.ingearcarsales.co.uk/vehicle/37c56fd27694722ea557bb83c8f9244d">
        <h2 class="make-model font-s">Toyota Yaris</h2>
        <span class="derivative font-xxs">2023 - 1.5 GR Sport</span>
        <div class="vehicle-make-model p15"></div>
        <span class="vehicle-price"><span class="totalPrice">&pound;18,795</span></span>
        <li class="r25">15,000 Miles</li>
      </a>`,
      "https://www.ingearcarsales.co.uk",
    );
    expect(ingear[0]).toMatchObject({ make: "Toyota", model: "Yaris", year: 2023, price: 18795, mileage: 15000 });

    const bettridge = extractBettridgeMotorCards(
      `<h2><span>Peugeot </span>2008 Pure Tech 130 GT</h2>
       <span class="price blue_grad">£17,995</span>
       <div class="details">
         <span class='detail year'><i><span>Year</span></i>2023</span>
         <span class='detail mileage'><i><span>Mileage</span></i>12000</span>
       </div>
       <link rel="canonical" href="https://www.bettridges.com/motor/2008-pure-tech-130-gt/" />`,
      "https://www.bettridges.com",
    );
    expect(bettridge[0]).toMatchObject({ make: "Peugeot", model: "2008 Pure Tech 130 GT", year: 2023, mileage: 12000, price: 17995 });

    const clickDealer = extractClickDealerListings(
      `<div class="results-vehicleresults grid-view">
        <div class="listing veh-loc-1 veh-7756678">
          <a href="/used-mercedes-benz-coachman-castletown-isle-of-man-7756678" title="2023 MERCEDES-BENZ COACHMAN Kabe">x</a>
          <div class="price">£93,995</div>
          <div class="results-summary__title">2023 MERCEDES-BENZ COACHMAN Kabe 545</div>
          <span class="results-spec__label">Year</span><span class="results-spec__stat">2023</span>
          <span class="results-spec__label">Mileage</span><span class="results-spec__stat">264 miles</span>
          <span class="results-spec__label">Fuel Type</span><span class="results-spec__stat">Diesel</span>
        </div>
      </div>`,
      "https://www.mikesmotors.im",
    );
    expect(clickDealer[0]).toMatchObject({
      year: 2023,
      make: "MERCEDES-BENZ",
      model: "COACHMAN Kabe 545",
      price: 93995,
      mileage: 264,
      sourceVehicleId: "7756678",
    });

    const swift = extractSwiftBskCards(
      `<bsk-vehicle-card theme="bp" id="car_79184928">
        <bsk-vehicle-card-img url="/used-vehicle-details/used-mercedes-benz-glb/id-79184928/" manufacturer="Mercedes-Benz" model="GLB" price="24,450" stockid="79184928"></bsk-vehicle-card-img>
        <bsk-shortlist-local-heart data="{'mileage' : '29,000','fuelType' : 'Petrol','transmission' : 'Automatic'}"></bsk-shortlist-local-heart>
        <bsk-vehicle-card-titles manufacturer="Mercedes-Benz" model="GLB" regyear="2021"></bsk-vehicle-card-titles>
      </bsk-vehicle-card>`,
      "https://swiftmotors.net",
    );
    expect(swift[0]).toMatchObject({
      make: "Mercedes-Benz",
      model: "GLB",
      year: 2021,
      price: 24450,
      mileage: 29000,
      sourceVehicleId: "79184928",
    });

    const philShaw = extractPhilShawProducts(
      `<div class="u-products-item" data-product-id="5" data-product="{&quot;id&quot;:&quot;5&quot;,&quot;title&quot;:&quot;BMW F800-GT Sport Touring Motorcycle&quot;,&quot;description&quot;:&quot;First Registered: 2013(Nov) Mileage: 20,000 Miles only&quot;}">
        <div class="u-price"> £3,995 </div>
      </div>`,
      "https://www.philshawvehicles.im",
    );
    expect(philShaw[0]).toMatchObject({
      make: "BMW",
      model: "F800-GT Sport Touring Motorcycle",
      year: 2013,
      mileage: 20000,
      price: 3995,
      sourceVehicleId: "5",
    });

    expect(
      extractDetailSpecs(
        `<li class="car_year"><span>Year</span> <strong class="text-right">2022</strong></li>
         <li class="car_mileage"><span>Mileage</span> <strong class="text-right">23323</strong></li>`,
        "https://sncc.im/cars/2022-land-rover-defender/",
      ),
    ).toMatchObject({ year: 2022, mileage: 23323 });
    expect(
      extractDetailSpecs(
        `<p>A 2018 example finished with Sport Chrono. With just 30,500 miles covered, it presents well.</p>`,
        "https://www.rexmotorcompany.im/sales/porsche-macan-gts-5dr-pdk",
      ),
    ).toMatchObject({ year: 2018, mileage: 30500 });
    expect(
      extractDetailSpecs(
        `<span>Registration</span><span>Fuel Type</span>`,
        "https://swiftmotors.net/used-vehicle-details/id-1/",
      ).registration,
    ).toBeNull();
  });

  it("discovers Click Dealer and Swift pagination URLs", () => {
    expect(
      discoverStockPageUrls(
        `<a href="/used-cars/2">2</a><a href='/used-vans/3'>3</a>`,
        "https://www.mikesmotors.im/used-cars",
      ),
    ).toEqual(["https://www.mikesmotors.im/used-cars/2", "https://www.mikesmotors.im/used-vans/3"]);
    expect(
      discoverStockPageUrls(
        `<a href="/used-vehicles/page-2/default/-1/-1.aspx">Next</a>`,
        "https://swiftmotors.net/used-vehicles/",
      ),
    ).toEqual(["https://swiftmotors.net/used-vehicles/page-2/default/-1/-1.aspx"]);
    expect(sequentialStockPageUrls("https://www.mikesmotors.im/used-cars", 3)).toEqual([
      "https://www.mikesmotors.im/used-cars/2",
      "https://www.mikesmotors.im/used-cars/3",
    ]);
    expect(stockPageQueue("", "https://www.mikesmotors.im/used-cars", "https://www.mikesmotors.im/used-cars", 3)).toEqual(
      ["https://www.mikesmotors.im/used-cars/2", "https://www.mikesmotors.im/used-cars/3"],
    );
    expect(
      discoverStockPageUrls(
        `<a href="/inventory?page=1">1</a><a href="/inventory?page=2">2</a>`,
        "https://www.tdcar.im/inventory",
      ),
    ).toEqual(["https://www.tdcar.im/inventory?page=2"]);
  });
});
