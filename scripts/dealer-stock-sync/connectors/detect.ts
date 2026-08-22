import type { ConnectorDetectInput, StockConnector } from "./contract";
import { autowebConnector } from "./autoweb";
import { clickDealerConnector } from "./click-dealer";
import { csvConnector } from "./csv";
import { dealerWebsitesConnector } from "./dealer-websites";
import { dragon2000Connector } from "./dragon2000";
import { htmlStructuredConnector } from "./html-structured";
import { iomwebdesignConnector } from "./iomwebdesign";
import { netdirectorConnector } from "./netdirector";
import { unknownConnector } from "./unknown";
import type { ConnectorKey } from "../types";

export const CONNECTORS: StockConnector[] = [
  netdirectorConnector,
  clickDealerConnector,
  dragon2000Connector,
  autowebConnector,
  dealerWebsitesConnector,
  iomwebdesignConnector,
  htmlStructuredConnector,
  csvConnector,
  unknownConnector,
];

export function getConnector(key: ConnectorKey) {
  const connector = CONNECTORS.find((item) => item.key === key);
  if (!connector) throw new Error(`Unknown connector: ${key}`);
  return connector;
}

export function detectConnector(input: ConnectorDetectInput): ConnectorKey | null {
  const ranked = CONNECTORS.filter((connector) => connector.key !== "unknown" && connector.detect(input));
  if (ranked.length === 0) return null;
  if (ranked.some((connector) => connector.key === "csv") && !input.url && !input.html) {
    return "csv";
  }
  return ranked.find((connector) => connector.key !== "html-structured" && connector.key !== "csv")
    ?.key ?? ranked[0]!.key;
}
