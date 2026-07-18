import test from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { Window } from "happy-dom";
import App from "../src/App.jsx";

test("手机首页可以输入商品并获得商业分析报告", async () => {
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
  assert.match(document.querySelector("h1").textContent, /判断能不能卖/);

  const enter = async (selector, value) => {
    const input = document.querySelector(selector);
    await act(async () => {
      const prototype = input.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value").set.call(input, value);
      input.dispatchEvent(new window.InputEvent("input", { bubbles: true, data: value, inputType: "insertText" }));
      input.dispatchEvent(new window.Event("change", { bubbles: true }));
    });
  };
  await enter("#product-name", "桌面风扇");
  await enter("#product-cost", "15");
  await enter("#product-price", "39.9");
  await enter("#product-shipping", "5");
  await enter("#product-note", "夏季商品、小件、一件代发");

  await act(async () => {
    document.querySelector(".product-form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 1750));
  });

  assert.equal(document.querySelector(".task-heading b").textContent, "分析完成");
  assert.match(document.querySelector(".business-report").textContent, /商业分析报告/);
  assert.match(document.querySelector(".business-report").textContent, /桌面风扇/);
  assert.match(document.querySelector(".business-report").textContent, /19.9/);
  assert.equal(JSON.parse(localStorage.getItem("hammer-commerce-agent-v0.2-products")).length, 1);

  await act(async () => { root.unmount(); });
  window.close();
});
