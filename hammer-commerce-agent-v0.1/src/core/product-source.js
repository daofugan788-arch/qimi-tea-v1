const round = (value) => Math.round(Number(value || 0) * 100) / 100;

export function createProductSource(item = {}) {
  return {
    platform: String(item.source || "").trim(),
    url: String(item.sourceUrl || "").trim(),
    capturedAt: item.capturedAt || new Date().toISOString(),
    screenshot: String(item.screenshotUrl || "").trim(),
    pageScreenshot: String(item.pageScreenshotUrl || "").trim(),
    price: round(item.price),
    title: String(item.name || "").trim(),
  };
}
