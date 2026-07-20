import test from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { Window } from "happy-dom";
import App from "../src/App.jsx";

function catalog(source) {
  return {
    products: [
      {
        id: `${source}-1`,
        title: `${source} 便携商品`,
        handle: `${source}-portable-item`,
        product_type: "Accessories",
        variants: [{ available: true, price: "12", compare_at_price: "32" }],
        images: [{ src: "https://example.com/product.jpg" }],
      },
      {
        id: `${source}-2`,
        title: `${source} 普通商品`,
        handle: `${source}-regular-item`,
        product_type: "Home",
        variants: [{ available: true, price: "18", compare_at_price: "18" }],
        images: [],
      },
    ],
  };
}

test("Android 首页可以输入一句任务、查看执行过程并获得结果", async () => {
  const window = new Window({ url: "https://hammer-os.test/" });
  window.scrollTo = () => {};
  const fetchMock = async (url) => ({
    ok: true,
    status: 200,
    async json() { return catalog(new URL(url).hostname); },
  });
  Object.defineProperties(globalThis, {
    window: { value: window, configurable: true },
    document: { value: window.document, configurable: true },
    navigator: { value: window.navigator, configurable: true },
    localStorage: { value: window.localStorage, configurable: true },
    fetch: { value: fetchMock, configurable: true },
    IS_REACT_ACT_ENVIRONMENT: { value: true, configurable: true },
  });
  let copiedReport = "";
  let sharedReport = null;
  Object.defineProperty(window.navigator, "clipboard", {
    value: { async writeText(value) { copiedReport = value; } },
    configurable: true,
  });
  Object.defineProperty(window.navigator, "share", {
    value: async (value) => { sharedReport = value; },
    configurable: true,
  });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => { root.render(React.createElement(App)); });
  assert.match(document.querySelector("h1").textContent, /一句任务/);
  assert.equal(document.querySelector("#mission-input").value, "帮我找今天值得卖的商品");

  await act(async () => {
    document.querySelector("#start-mission").click();
    await new Promise((resolve) => setTimeout(resolve, 1500));
  });

  assert.equal(document.querySelector(".mission-state").textContent, "执行完成");
  assert.equal(document.querySelectorAll(".mission-view li.complete").length, 6);
  assert.match(document.querySelector(".result-view").textContent, /任务完成/);
  assert.match(document.querySelector(".result-view").textContent, /便携商品/);
  assert.match(document.querySelector(".result-view").textContent, /预计利润/);
  assert.ok(JSON.parse(localStorage.getItem("hammer-os-android-last-report")));
  assert.equal(JSON.parse(localStorage.getItem("hammer-os-android-mission-history")).length, 1);

  await act(async () => { document.querySelector(".favorite-button").click(); });
  assert.match(document.querySelector(".favorite-button").textContent, /已收藏/);
  assert.equal(JSON.parse(localStorage.getItem("hammer-os-android-product-favorites")).length, 1);
  assert.match(document.querySelector(".favorites-open-button").textContent, /1/);
  await act(async () => { document.querySelector(".favorites-open-button").click(); });
  assert.match(document.querySelector(".favorites-panel").textContent, /商品收藏/);
  assert.match(document.querySelector(".favorite-row").textContent, /便携商品/);
  assert.match(document.querySelector(".favorite-row").textContent, /预计利润/);
  await act(async () => { document.querySelector(".generate-content-button").click(); });
  assert.equal(document.querySelector(".favorites-panel"), null);
  assert.match(document.querySelector(".content-panel").textContent, /发布资料/);
  assert.match(document.querySelector(".content-panel").textContent, /客服话术/);
  await act(async () => { document.querySelector(".copy-content-button").click(); });
  assert.match(document.querySelector(".copy-content-button").textContent, /已复制全部资料/);
  assert.match(copiedReport, /商品发布资料/);
  assert.match(copiedReport, /客服话术/);
  await act(async () => { document.querySelector(".content-panel header button").click(); });
  assert.equal(document.querySelector(".content-panel"), null);

  await act(async () => { document.querySelector(".copy-report-button").click(); });
  assert.match(document.querySelector(".copy-report-button").textContent, /已复制/);
  assert.match(copiedReport, /Hammer Mission 执行报告/);
  assert.match(copiedReport, /公开成本参考/);

  await act(async () => {
    document.querySelector(".share-report-button").click();
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  assert.match(document.querySelector(".share-report-button").textContent, /已打开分享/);
  assert.match(sharedReport.text, /Hammer Mission 执行报告/);
  assert.match(sharedReport.text, /预计利润/);

  await act(async () => { document.querySelector(".history-open-button").click(); });
  assert.match(document.querySelector(".history-panel").textContent, /任务历史/);
  assert.equal(document.querySelectorAll(".history-item").length, 1);
  await act(async () => { document.querySelector(".history-item").click(); });
  assert.equal(document.querySelector(".history-panel"), null);
  assert.match(document.querySelector(".result-view").textContent, /任务完成/);

  await act(async () => { document.querySelector(".history-open-button").click(); });
  await act(async () => {
    document.querySelector(".history-rerun-button").click();
    await new Promise((resolve) => setTimeout(resolve, 1500));
  });
  assert.equal(document.querySelector(".history-panel"), null);
  assert.equal(JSON.parse(localStorage.getItem("hammer-os-android-mission-history")).length, 2);
  assert.match(document.querySelector(".history-open-button").textContent, /2/);
  assert.match(document.querySelector(".result-view").textContent, /任务完成/);
  assert.match(document.querySelector(".favorite-button").textContent, /已收藏/);

  await act(async () => { root.unmount(); });
  window.close();
});
