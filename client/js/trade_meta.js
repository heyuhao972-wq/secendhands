const STORAGE_KEY = "trade_meta";

export function loadTradeMeta() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

export function saveTradeMeta(contentHash, meta) {
  const all = loadTradeMeta();
  all[contentHash] = meta;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}
