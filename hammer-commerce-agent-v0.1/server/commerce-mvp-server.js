import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createCommerceEmployee, dispatchCommerceMission } from "./commerce-employee-factory.js";

const port = Number(process.env.COMMERCE_MVP_PORT || process.env.PORT || 8788);
const accessToken = String(process.env.HAMMER_ACCESS_TOKEN || "");
const pageFile = path.resolve("public/commerce-employee.html");
const { hammer } = createCommerceEmployee({ dailyEnabled: true });
let missionQueue = Promise.resolve();

function headers(contentType = "application/json; charset=utf-8") {
  return { "Content-Type": contentType, "Cache-Control": "no-store", "Access-Control-Allow-Origin": process.env.HAMMER_ALLOWED_ORIGIN || "*" };
}

function json(response, status, body) {
  response.writeHead(status, headers());
  response.end(JSON.stringify(body));
}

function authorized(request, url) {
  if (!accessToken) return true;
  return request.headers.authorization === `Bearer ${accessToken}` || url.searchParams.get("token") === accessToken;
}

async function body(request) {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 16_384) throw new Error("请求内容过大");
  }
  return JSON.parse(raw || "{}");
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  if (request.method === "OPTIONS") {
    response.writeHead(204, { ...headers(), "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Allow-Methods": "GET,POST,OPTIONS" });
    return response.end();
  }
  if (request.method === "GET" && url.pathname === "/") {
    const page = await readFile(pageFile);
    response.writeHead(200, headers("text/html; charset=utf-8"));
    return response.end(page);
  }
  if (!authorized(request, url)) return json(response, 401, { error: "访问口令无效" });
  if (request.method === "GET" && url.pathname === "/health") {
    return json(response, 200, {
      status: "ok",
      employee: await hammer.memoryService.read("commerce.employee", "heartbeat"),
      latestReportAt: (await hammer.memoryService.read("commerce.employee", "latest-report"))?.generatedAt || null,
    });
  }
  if (request.method === "GET" && url.pathname === "/api/reports/latest") {
    return json(response, 200, { report: await hammer.memoryService.read("commerce.employee", "latest-report") || null });
  }
  if (request.method === "POST" && url.pathname === "/api/missions") {
    try {
      const input = await body(request);
      const goal = String(input.goal || "").trim().slice(0, 300);
      const work = missionQueue.then(() => dispatchCommerceMission(hammer, goal, {
        channel: input.channel,
        shippingCost: input.shippingCost,
        platformRate: input.platformRate,
        otherCost: input.otherCost,
        source: "mobile-web",
      }));
      missionQueue = work.catch(() => {});
      const result = await work;
      return json(response, 201, { missionId: result.mission.id, report: result.report });
    } catch (error) {
      return json(response, 422, { error: error?.message || "Mission 执行失败" });
    }
  }
  return json(response, 404, { error: "Not found" });
});

server.listen(port, "0.0.0.0", () => {
  process.stdout.write(`Hammer Commerce MVP listening on :${port}\n`);
});
