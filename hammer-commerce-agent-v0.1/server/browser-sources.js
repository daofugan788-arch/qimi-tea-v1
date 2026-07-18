const DEMO_SOURCE = Object.freeze({
  id: "webscraper-demo",
  name: "Webscraper 测试商城（验证源）",
  searchUrl: "https://webscraper.io/test-sites/e-commerce/allinone/phones/touch",
  itemSelector: ".thumbnail",
  titleSelector: ".title",
  linkSelector: ".title",
  priceSelector: ".price",
  descriptionSelector: ".description",
  imageSelector: "img.img-responsive",
  salesSelector: ".ratings .pull-right",
  ratingSelector: ".ratings p[data-rating]",
  ratingAttribute: "data-rating",
  supportedQueryPattern: "phone|手机|touch|telephone",
});

function validSelector(value, fallback = "") {
  const text = String(value || fallback).trim();
  if (!text || text.length > 180) throw new Error("Browser source selector 配置无效");
  return text;
}

function normalizeSource(source) {
  const searchUrl = String(source?.searchUrl || "").trim();
  const parsed = new URL(searchUrl.replace("{query}", "test"));
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
    throw new Error("Browser source 只允许 HTTPS 或 localhost");
  }
  return {
    id: String(source.id || parsed.hostname).replace(/[^a-z0-9_-]/gi, "-").slice(0, 60),
    name: String(source.name || parsed.hostname).trim().slice(0, 80),
    searchUrl,
    allowedOrigin: parsed.origin,
    itemSelector: validSelector(source.itemSelector),
    titleSelector: validSelector(source.titleSelector),
    linkSelector: validSelector(source.linkSelector, source.titleSelector),
    priceSelector: validSelector(source.priceSelector),
    descriptionSelector: validSelector(source.descriptionSelector, source.titleSelector),
    imageSelector: validSelector(source.imageSelector, "img"),
    salesSelector: validSelector(source.salesSelector, source.titleSelector),
    ratingSelector: validSelector(source.ratingSelector, source.titleSelector),
    ratingAttribute: String(source.ratingAttribute || "").trim().slice(0, 80),
    supportedQueryPattern: String(source.supportedQueryPattern || "").trim().slice(0, 180),
  };
}

export function loadBrowserSources(env = process.env) {
  const sources = [];
  if (env.BROWSER_SOURCE_CONFIG_JSON) {
    const parsed = JSON.parse(env.BROWSER_SOURCE_CONFIG_JSON);
    if (!Array.isArray(parsed)) throw new Error("BROWSER_SOURCE_CONFIG_JSON 必须是数组");
    sources.push(...parsed.map(normalizeSource));
  }
  if (env.BROWSER_ENABLE_DEMO !== "false") sources.push(normalizeSource(DEMO_SOURCE));
  return sources;
}

export function sourceSearchUrl(source, query) {
  return source.searchUrl.replaceAll("{query}", encodeURIComponent(query));
}
