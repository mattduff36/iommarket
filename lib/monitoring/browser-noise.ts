/** Match observed extension/bridge errors, not application text mentioning them. */
export function isWebKitBridgeNoise(message: string): boolean {
  return /^undefined is not an object \(evaluating ['"]window\.webkit\.messageHandlers['"]\)$/i.test(normalize(message));
}

export function isMetaMaskNoise(message: string): boolean {
  return /^failed to connect to metamask\.?$/i.test(normalize(message));
}

function normalize(message: string): string {
  return message.replace(/^Console Error:\s*/i, "").trim();
}
