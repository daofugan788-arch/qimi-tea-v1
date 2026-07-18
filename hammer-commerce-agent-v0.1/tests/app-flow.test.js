import test from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { Window } from "happy-dom";
import App from "../src/App.jsx";

test("手机首页可以通过示例目标完成首次 Agent 任务", async () => {
  const window = new Window({ url: "https://hammer-commerce.test/" });
  window.scrollTo = () => {};
  Object.defineProperties(globalThis, {
    window: { value: window, configurable: true },
    document: { value: window.document, configurable: true },
    navigator: { value: window.navigator, configurable: true },
    localStorage: { value: window.localStorage, configurable: true },
    IS_REACT_ACT_ENVIRONMENT: { value: true, configurable: true },
  });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => { root.render(React.createElement(App)); });
  assert.match(document.querySelector("h1").textContent, /告诉我目标/);
  const example = [...document.querySelectorAll(".examples button")]
    .find((button) => button.textContent.includes("闲鱼"));
  assert.ok(example, "没有找到闲鱼示例入口");

  await act(async () => {
    example.click();
    await new Promise((resolve) => setTimeout(resolve, 1650));
  });

  assert.equal(document.querySelector(".task-heading b").textContent, "执行完成");
  assert.match(document.querySelector(".report-card").textContent, /首轮电商任务执行报告/);
  assert.match(document.querySelector(".metric-grid").textContent, /闲鱼/);
  assert.equal(JSON.parse(localStorage.getItem("hammer-commerce-agent-v0.1-tasks")).length, 1);

  await act(async () => { root.unmount(); });
  window.close();
});
