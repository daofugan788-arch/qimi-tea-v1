import { TOOL_RISK, TOOL_TYPE } from "../../tools/tool-types.js";

export class ProductPageVerificationTool {
  constructor(verifier) {
    this.name = "browser.product.verify";
    this.type = TOOL_TYPE.BROWSER;
    this.riskLevel = TOOL_RISK.LOW;
    this.description = "真实打开白名单商品页，保存截图并核验公开商品信息";
    this.verifier = verifier;
  }

  async execute(input = {}) {
    const searchResult = input.dependencyOutput;
    if (!searchResult?.items) throw new Error("Browser Tool 没有收到 Search Agent 商品列表");
    if (!this.verifier?.verify) throw new Error("Browser Plugin 未连接真实页面执行器");
    let verification;
    try {
      verification = await this.verifier.verify({
        runId: searchResult.runId,
        items: searchResult.items,
        maxItems: Number(input.maxItems) || 12,
      });
    } catch (error) {
      const message = error?.message || "Browser 真实页面核验失败";
      verification = {
        runId: `VERIFY-${searchResult.runId || Date.now().toString(36).toUpperCase()}`,
        verifiedCount: 0,
        evidenceFile: null,
        errors: [{ error: message, scope: "browser-launch" }],
        items: searchResult.items.map((item) => ({ ...item, browserVerified: false, browserError: message })),
      };
    }
    return {
      ...searchResult,
      browserRunId: verification.runId,
      browserVerifiedCount: verification.verifiedCount,
      browserEvidenceFile: verification.evidenceFile,
      browserErrors: verification.errors,
      items: verification.items,
    };
  }
}
