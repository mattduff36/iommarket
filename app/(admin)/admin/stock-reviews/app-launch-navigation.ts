export function openStockUpdateProtocol(url: string) {
  if (!/^itrader-stock-update:\/\/launch\?environment=(preview|production)&ticket=[A-Za-z0-9_-]{43}$/.test(url)) {
    throw new Error("Invalid app launch link.");
  }
  window.location.assign(url);
}
