import path from "node:path";
import { EvidenceFileStore } from "./evidence-file-store.js";
import { launchBrowser } from "./public-browser-runner.js";

function safeOrigin(value) {
  try { return new URL(value).origin; } catch { return ""; }
}

async function firstText(page, selector) {
  const locator = page.locator(selector);
  if (!await locator.count()) return "";
  return String(await locator.first().textContent().catch(() => "") || "").replace(/\s+/g, " ").trim();
}

export class PublicProductPageVerifier {
  constructor({ allowedOrigins = [], evidenceDirectory = path.resolve("data/browser-evidence"), launch = launchBrowser } = {}) {
    this.allowedOrigins = new Set(allowedOrigins.map(safeOrigin).filter(Boolean));
    this.evidenceStore = new EvidenceFileStore(evidenceDirectory);
    this.launch = launch;
  }

  async verify({ runId, items = [], maxItems = 12 }) {
    const verificationRunId = `VERIFY-${runId || Date.now().toString(36).toUpperCase()}`;
    const limit = Math.max(1, Math.min(20, maxItems));
    const candidates = items.slice(0, limit);
    const untouched = items.slice(limit).map((item) => ({ ...item, browserVerified: false, browserSkipped: true }));
    const verifiedItems = [];
    const errors = [];
    await this.evidenceStore.prepare();
    const browser = await this.launch();
    try {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        locale: "zh-CN",
        userAgent: "HammerCommerceEmployee/0.8 PublicProductVerification",
        ignoreHTTPSErrors: process.env.BROWSER_IGNORE_HTTPS_ERRORS === "true",
      });
      for (let index = 0; index < candidates.length; index += 1) {
        const item = candidates[index];
        const origin = safeOrigin(item.sourceUrl);
        if (!origin || !this.allowedOrigins.has(origin)) {
          const error = "商品链接不在 Browser 白名单";
          errors.push({ name: item.name, url: item.sourceUrl, error });
          verifiedItems.push({ ...item, browserVerified: false, browserError: error });
          continue;
        }
        const page = await context.newPage();
        try {
          await page.goto(item.sourceUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
          if (safeOrigin(page.url()) !== origin) throw new Error("商品页跳转到白名单外域名");
          const body = await page.locator("body").innerText({ timeout: 10_000 }).catch(() => "");
          if (/验证码|安全验证|captcha|请先登录|sign\s*in\s*to/i.test(body)) throw new Error("页面要求登录或验证，Browser Agent 已停止");
          const screenshotFile = `${verificationRunId}-${index + 1}.png`;
          await page.screenshot({ path: this.evidenceStore.screenshotPath(screenshotFile), fullPage: true });
          verifiedItems.push({
            ...item,
            browserVerified: true,
            browserVerifiedAt: new Date().toISOString(),
            browserPageTitle: await firstText(page, "h1") || await page.title(),
            browserPageExcerpt: body.replace(/\s+/g, " ").trim().slice(0, 600),
            screenshotUrl: this.evidenceStore.screenshotPath(screenshotFile),
          });
        } catch (error) {
          const message = error?.message || "商品页核验失败";
          errors.push({ name: item.name, url: item.sourceUrl, error: message });
          verifiedItems.push({ ...item, browserVerified: false, browserError: message });
        } finally {
          await page.close();
        }
      }
    } finally {
      await browser.close();
    }
    const allItems = [...verifiedItems, ...untouched];
    const evidenceFile = await this.evidenceStore.saveSession(verificationRunId, {
      runId: verificationRunId,
      sourceRunId: runId,
      capturedAt: new Date().toISOString(),
      items: allItems,
      errors,
    });
    return {
      runId: verificationRunId,
      items: allItems,
      verifiedCount: allItems.filter((item) => item.browserVerified).length,
      errors,
      evidenceFile,
    };
  }
}
