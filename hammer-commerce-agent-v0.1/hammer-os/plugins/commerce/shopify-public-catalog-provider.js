const round = (value) => Math.round(Number(value || 0) * 100) / 100;

function plainText(html) {
  return String(html || "").replace(/<[^>]+>/g, " ").replace(/&[^;]+;/g, " ").replace(/\s+/g, " ").trim().slice(0, 500);
}

function availableVariants(product) {
  return (product.variants || []).filter((variant) => variant.available !== false && Number(variant.price) > 0);
}

export class ShopifyPublicCatalogProvider {
  constructor({ name, baseUrl, currency = "USD", limit = 250, fetchImpl = globalThis.fetch } = {}) {
    this.name = name;
    this.baseUrl = String(baseUrl || "").replace(/\/$/, "");
    this.currency = currency;
    this.limit = Math.max(1, Math.min(250, Number(limit) || 250));
    this.fetchImpl = fetchImpl;
  }

  async search({ keywords = [], constraints = {} } = {}) {
    if (!this.name || !this.baseUrl || typeof this.fetchImpl !== "function") throw new Error("Shopify 公开目录配置无效");
    const response = await this.fetchImpl(`${this.baseUrl}/products.json?limit=${this.limit}`, {
      headers: { Accept: "application/json", "User-Agent": "HammerCommerceEmployee/0.7 PublicCatalogResearch" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const products = Array.isArray(payload.products) ? payload.products : [];
    const normalizedKeywords = (keywords || []).map((item) => String(item).toLowerCase()).filter(Boolean);
    return products.flatMap((product) => {
      const variants = availableVariants(product);
      if (!variants.length) return [];
      const searchable = `${product.title} ${product.product_type || ""} ${(product.tags || []).join(" ")}`.toLowerCase();
      if (normalizedKeywords.length && !normalizedKeywords.some((keyword) => searchable.includes(keyword))) return [];
      const price = Math.min(...variants.map((variant) => Number(variant.price)));
      const comparePrices = variants.map((variant) => Number(variant.compare_at_price)).filter((value) => value > price);
      const marketReference = comparePrices.length ? Math.max(...comparePrices) : price;
      if (constraints.maxSourcePrice !== null && constraints.maxSourcePrice !== undefined && price > constraints.maxSourcePrice) return [];
      return [{
        id: `${this.name}-${product.id}`,
        name: product.title,
        source: this.name,
        sourceUrl: `${this.baseUrl}/products/${product.handle}`,
        price: round(price),
        marketReference: round(marketReference),
        currency: this.currency,
        imageUrl: product.images?.[0]?.src || product.image?.src || "",
        description: plainText(product.body_html),
        productType: product.product_type || "",
        vendor: product.vendor || "",
        tags: product.tags || [],
        salesText: "未公开",
        reviewText: "未公开",
        ratingText: "未公开",
        evidenceType: "PUBLIC_CATALOG_JSON",
      }];
    });
  }
}
