import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { BrowserSearchPlanner } from "../src/core/browser-search-planner.js";
import { loadBrowserSources } from "./browser-sources.js";
import { EvidenceFileStore } from "./evidence-file-store.js";
import { PublicBrowserRunner } from "./public-browser-runner.js";

const port = Number(process.env.BROWSER_AGENT_PORT || process.env.PORT || 8787);
const evidenceDirectory = process.env.BROWSER_EVIDENCE_DIR || path.resolve("evidence");
const evidenceStore = new EvidenceFileStore(evidenceDirectory);
const planner = new BrowserSearchPlanner();
const sources = loadBrowserSources();
const runner = new PublicBrowserRunner({ evidenceStore });
const requestLog = new Map();

function headers(origin = "*") {
  const allowed = process.env.BROWSER_ALLOWED_ORIGIN || "*";
  return {
    "Access-Control-Allow-Origin": allowed === "*" ? "*" : allowed === origin ? origin : "null",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Cache-Control": "no-store",
  };
}

function json(response, status, body, origin) {
  response.writeHead(status, { ...headers(origin), "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 65536) throw new Error("请求内容过大");
  }
  return JSON.parse(raw || "{}");
}

function rateLimited(ip) {
  const now = Date.now();
  const recent = (requestLog.get(ip) || []).filter((time) => now - time < 60000);
  recent.push(now);
  requestLog.set(ip, recent);
  return recent.length > Number(process.env.BROWSER_RATE_LIMIT || 10);
}

const server = http.createServer(async (request, response) => {
  const origin = String(request.headers.origin || "");
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  if (request.method === "OPTIONS") {
    response.writeHead(204, headers(origin));
    return response.end();
  }
  if (request.method === "GET" && url.pathname === "/health") {
    return json(response, 200, { status: "ok", browser: "playwright", sources: sources.map(({ id, name }) => ({ id, name })) }, origin);
  }
  if (request.method === "GET" && url.pathname.startsWith("/evidence/")) {
    const fileName = path.basename(url.pathname);
    if (!fileName.endsWith(".png")) return json(response, 404, { error: "证据文件不存在" }, origin);
    try {
      const file = await readFile(evidenceStore.screenshotPath(fileName));
      response.writeHead(200, { ...headers(origin), "Content-Type": "image/png", "Cache-Control": "private, max-age=86400" });
      return response.end(file);
    } catch {
      return json(response, 404, { error: "证据文件不存在" }, origin);
    }
  }
  if (request.method !== "POST" || url.pathname !== "/api/browser/search") {
    return json(response, 404, { error: "Not found" }, origin);
  }

  const allowedOrigin = process.env.BROWSER_ALLOWED_ORIGIN || "*";
  if (allowedOrigin !== "*" && origin !== allowedOrigin) {
    return json(response, 403, { error: "请求来源未授权" }, origin);
  }

  const ip = String(request.headers["x-forwarded-for"] || request.socket.remoteAddress || "unknown").split(",")[0];
  if (rateLimited(ip)) return json(response, 429, { error: "搜索过于频繁，请稍后再试" }, origin);
  try {
    if (!sources.length) throw new Error("没有配置允许访问的公开商品来源");
    const body = await readJson(request);
    const goal = String(body.goal || "").trim().slice(0, 300);
    const plan = planner.createPlan(goal);
    const runId = `BRW-${Date.now().toString(36).toUpperCase()}`;
    await evidenceStore.prepare();
    const items = await runner.search({ plan, sources, runId });
    const baseUrl = process.env.BROWSER_PUBLIC_BASE_URL || `${request.headers["x-forwarded-proto"] || "http"}://${request.headers.host}`;
    const responseItems = items.map(({ screenshotFile, ...item }) => ({
      ...item,
      screenshotUrl: `${baseUrl.replace(/\/$/, "")}/evidence/${screenshotFile}`,
    }));
    await evidenceStore.saveSession(runId, { runId, goal, plan, items: responseItems, capturedAt: new Date().toISOString() });
    return json(response, 200, { runId, plan, items: responseItems }, origin);
  } catch (error) {
    return json(response, 422, { error: error?.message || "Browser Agent 执行失败" }, origin);
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Hammer Browser Agent listening on :${port}`);
});
