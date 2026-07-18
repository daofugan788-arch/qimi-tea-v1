import chromiumBinary from "@sparticuz/chromium";
import { chromium as playwrightChromium } from "playwright";
import { sourceSearchUrl } from "./browser-sources.js";
import { bundledChromiumExecutablePath } from "./chromium-runtime.js";

const round = (value) => Math.round(Number(value || 0) * 100) / 100;

function readPrice(value) {
  const match = String(value || "").replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))];
}

async function text(locator) {
  if (await locator.count() === 0) return "";
  return String(await locator.first().textContent().catch(() => "") || "").replace(/\s+/g, " ").trim();
}

async function attribute(locator, name) {
  if (await locator.count() === 0) return "";
  return String(await locator.first().getAttribute(name).catch(() => "") || "").trim();
}

function absoluteUrl(value, pageUrl) {
  if (!value) return "";
  try { return new URL(value, pageUrl).href; } catch { return ""; }
}

function browserProxy() {
  const value = String(process.env.BROWSER_PROXY_URL || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || "").trim();
  if (!value) return undefined;
  const parsed = new URL(value);
  return {
    server: parsed.origin,
    ...(parsed.username ? { username: decodeURIComponent(parsed.username) } : {}),
    ...(parsed.password ? { password: decodeURIComponent(parsed.password) } : {}),
  };
}

export async function launchBrowser() {
  process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY ??= "1";
  const configuredExecutable = String(process.env.CHROMIUM_EXECUTABLE_PATH || "").trim();
  if (configuredExecutable) {
    return playwrightChromium.launch({ executablePath: configuredExecutable, headless: true, proxy: browserProxy() });
  }
  try {
    return await playwrightChromium.launch({ headless: true, proxy: browserProxy() });
  } catch (error) {
    if (!/Executable doesn't exist|executable.*not found/i.test(String(error?.message || ""))) throw error;
    chromiumBinary.setGraphicsMode = false;
    const executablePath = await bundledChromiumExecutablePath();
    return playwrightChromium.launch({
      executablePath,
      args: chromiumBinary.args,
      headless: true,
      proxy: browserProxy(),
      env: {
        ...process.env,
        HOME: process.env.HAMMER_BROWSER_HOME || executablePath.replace(/\/chromium$/, ""),
      },
    });
  }
}

export class PublicBrowserRunner {
  constructor({ evidenceStore, launch = launchBrowser } = {}) {
    this.evidenceStore = evidenceStore;
    this.launch = launch;
  }

  async search({ plan, sources, runId }) {
    const browser = await this.launch();
    const capturedAt = new Date().toISOString();
    const collected = [];
    try {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        locale: "zh-CN",
        userAgent: "HammerCommerceAgent/1.0 PublicPageResearch",
        ignoreHTTPSErrors: process.env.BROWSER_IGNORE_HTTPS_ERRORS === "true",
      });
      for (const source of sources) {
        if (source.supportedQueryPattern && !new RegExp(source.supportedQueryPattern, "i").test(plan.query)) continue;
        const page = await context.newPage();
        const searchUrl = sourceSearchUrl(source, plan.query);
        await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
        if (new URL(page.url()).origin !== source.allowedOrigin) throw new Error(`${source.name} 跳转到未授权域名，已停止`);
        const pageText = await page.locator("body").innerText({ timeout: 10000 }).catch(() => "");
        if (/验证码|安全验证|captcha|请先登录|sign\s*in\s*to/i.test(pageText)) {
          throw new Error(`${source.name} 要求登录或验证，基础版不会绕过`);
        }
        await page.waitForSelector(source.itemSelector, { timeout: 15000 });
        const pageScreenshotFile = `${runId}-${source.id}-page.png`;
        await page.screenshot({ path: this.evidenceStore.screenshotPath(pageScreenshotFile), fullPage: true });
        const cards = page.locator(source.itemSelector);
        const count = Math.min(await cards.count(), Math.max(1, plan.constraints.limit || 12));
        for (let index = 0; index < count; index += 1) {
          const card = cards.nth(index);
          const name = await text(card.locator(source.titleSelector));
          const description = await text(card.locator(source.descriptionSelector));
          const price = readPrice(await text(card.locator(source.priceSelector)));
          if (!name || price === null) continue;
          if (plan.constraints.maxSourcePrice !== null && price > plan.constraints.maxSourcePrice) continue;
          const link = absoluteUrl(await attribute(card.locator(source.linkSelector), "href"), page.url());
          const imageUrl = absoluteUrl(await attribute(card.locator(source.imageSelector), "src"), page.url());
          const salesText = await text(card.locator(source.salesSelector));
          const reviewText = source.reviewSelector ? await text(card.locator(source.reviewSelector)) : "";
          const ratingText = source.ratingAttribute
            ? await attribute(card.locator(source.ratingSelector), source.ratingAttribute)
            : await text(card.locator(source.ratingSelector));
          const screenshotFile = `${runId}-${source.id}-${index + 1}.png`;
          await card.screenshot({ path: this.evidenceStore.screenshotPath(screenshotFile) });
          collected.push({
            id: `${source.id}-${index + 1}`,
            name,
            description,
            source: source.name,
            sourceUrl: link || searchUrl,
            price: round(price),
            salesText: salesText || "未公开",
            reviewText: reviewText || "未公开",
            ratingText: ratingText || "未公开",
            imageUrl,
            screenshotFile,
            pageScreenshotFile,
            capturedAt,
          });
        }
        await page.close();
      }
    } finally {
      await browser.close();
    }

    const reference = percentile(collected.map((item) => item.price), 0.75);
    return collected
      .map((item) => {
        const marketReference = round(Math.max(item.price, reference));
        const estimatedProfit = round(marketReference - item.price);
        return {
          ...item,
          marketReference,
          estimatedProfit,
          reason: "来自公开商品页面；价格截图及页面提供的公开销量、评价信息已保存。",
        };
      })
      .filter((item) => plan.constraints.minProfit === null || item.estimatedProfit >= plan.constraints.minProfit)
      .sort((a, b) => b.estimatedProfit - a.estimatedProfit || a.price - b.price);
  }
}
