import React, { useMemo, useState } from "react";
import { Share } from "@capacitor/share";
import { executeMobileMission, loadLastMobileReport, loadMobileHistory, MISSION_STEPS } from "./mobile-mission.js";

const DEFAULT_GOAL = "帮我找今天值得卖的商品";
const FAVORITES_KEY = "hammer-os-android-product-favorites";

function loadFavorites() {
  try {
    const saved = JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]");
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function formatTime(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function money(value, currency) {
  return `${currency || "USD"} ${Number(value || 0).toFixed(2).replace(/\.00$/, "")}`;
}

function reportText(report) {
  const products = report.products.map((product, index) => [
    `${index + 1}. ${product.name}`,
    `推荐：${product.decision}`,
    `公开成本参考：${money(product.sourceCost, product.currency)}`,
    `市场对比价：${money(product.marketPrice, product.currency)}`,
    `预计利润：${money(product.estimatedProfit, product.currency)}`,
    `原因：${product.reason}`,
    `来源：${product.sourceUrl}`,
  ].join("\n")).join("\n\n");
  return [
    "《Hammer Mission 执行报告》",
    `任务：${report.goal}`,
    `结果：${report.summary}`,
    `扫描：${report.scannedCount} 个｜分析：${report.analyzedCount} 个｜TEST：${report.testCount} 个`,
    "",
    products,
    "",
    report.notice,
  ].join("\n");
}

function listingContent(product) {
  const title = `${product.name}｜实用好物 价格合适可直接咨询`;
  const description = [
    `商品：${product.name}`,
    "",
    `建议发布价：${money(product.marketPrice, product.currency)}`,
    `商品卖点：${product.reason}`,
    "",
    "商品信息来自公开页面，成交前会再次确认实际价格、库存和细节。想看更多信息可以直接问，确认清楚再决定。",
  ].join("\n");
  const replies = [
    `价格：目前参考价是 ${money(product.marketPrice, product.currency)}，确认实际成本后可以再聊。`,
    "库存：我先帮你确认当前库存，有结果马上回复你。",
    "发货：确认商品和收货信息后，会告诉你预计发出时间。",
  ];
  return [
    "《商品发布资料》",
    "",
    `标题：${title}`,
    "",
    description,
    "",
    "客服话术：",
    ...replies.map((reply) => `• ${reply}`),
    "",
    "图片建议：商品正面、细节、尺寸或使用场景、真实状态。",
  ].join("\n");
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const input = document.createElement("textarea");
  input.value = text;
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();
  document.execCommand("copy");
  input.remove();
}

function MissionView({ goal, events, running }) {
  if (!events.length) return null;
  const completed = new Set(events.map((event) => event.stepId));
  const currentId = running ? events.at(-1)?.stepId : "";
  return (
    <section className="mission-view" aria-live="polite">
      <div className="section-label">MISSION 执行过程</div>
      <h2>{goal}</h2>
      <div className={`mission-state ${running ? "working" : "done"}`}>
        <span />{running ? "AI 正在执行" : "执行完成"}
      </div>
      <ol>
        {MISSION_STEPS.map((step) => {
          const event = [...events].reverse().find((item) => item.stepId === step.id);
          const isCurrent = currentId === step.id;
          return (
            <li key={step.id} className={completed.has(step.id) ? "complete" : "waiting"}>
              <i>{completed.has(step.id) ? "✓" : ""}</i>
              <div>
                <b>{step.title}</b>
                <small>{event?.detail || (isCurrent ? "执行中" : "等待执行")}</small>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function ResultView({ report, favorites, onToggleFavorite }) {
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);
  if (!report) return null;
  async function copyReport() {
    await copyText(reportText(report));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }
  async function shareReport() {
    try {
      await Share.share({
        title: "Hammer Mission 执行报告",
        text: reportText(report),
        dialogTitle: "分享执行报告",
      });
      setShared(true);
      window.setTimeout(() => setShared(false), 1800);
    } catch {
      await copyReport();
    }
  }
  return (
    <section className="result-view">
      <div className="result-head">
        <span>MISSION SUCCESS</span>
        <h2>任务完成</h2>
        <p>{report.summary}</p>
        <div>
          <b>{report.scannedCount}<small>扫描商品</small></b>
          <b>{report.analyzedCount}<small>完成分析</small></b>
          <b>{report.testCount}<small>建议 TEST</small></b>
        </div>
      </div>
      <div className="result-list">
        {report.products.map((product, index) => (
          <article key={product.id}>
            <header>
              <span className={`decision ${product.decision.toLowerCase()}`}>{product.decision}</span>
              <small>TOP {index + 1}</small>
            </header>
            <div className="product-main">
              {product.imageUrl && <img src={product.imageUrl} alt="" loading="lazy" />}
              <div><h3>{product.name}</h3><p>{product.source}</p></div>
            </div>
            <div className="money-row">
              <span><small>公开成本参考</small><b>{money(product.sourceCost, product.currency)}</b></span>
              <span><small>市场对比价</small><b>{money(product.marketPrice, product.currency)}</b></span>
              <span><small>预计利润</small><b>{money(product.estimatedProfit, product.currency)}</b></span>
            </div>
            <p className="reason">{product.reason}</p>
            <div className="product-actions">
              <a href={product.sourceUrl} target="_blank" rel="noreferrer">查看公开来源 ↗</a>
              <button className={`favorite-button ${favorites.some((item) => item.id === product.id) ? "saved" : ""}`} type="button" onClick={() => onToggleFavorite(product)}>
                {favorites.some((item) => item.id === product.id) ? "★ 已收藏" : "☆ 收藏"}
              </button>
            </div>
          </article>
        ))}
      </div>
      {report.sourceErrors?.length > 0 && <p className="source-note">部分来源暂时不可用：{report.sourceErrors.join("；")}</p>}
      <p className="risk-note">{report.notice}</p>
      <div className="result-actions">
        <button className="copy-report-button" type="button" onClick={copyReport}>
          {copied ? "✓ 已复制" : "复制报告"}
        </button>
        <button className="share-report-button" type="button" onClick={shareReport}>
          {shared ? "✓ 已打开分享" : "分享报告"}
        </button>
      </div>
    </section>
  );
}

function HistoryView({ history, onSelect, onRun, onClose }) {
  return (
    <div className="history-layer" role="dialog" aria-modal="true" aria-label="任务历史">
      <button className="history-backdrop" type="button" onClick={onClose} aria-label="关闭任务历史" />
      <section className="history-panel">
        <header><div><small>当前手机保存</small><h2>任务历史</h2></div><button type="button" onClick={onClose}>×</button></header>
        <div className="history-list">
          {history.length === 0 && <p>还没有完成的任务。</p>}
          {history.map((item) => (
            <article className="history-row" key={item.missionId}>
              <button className="history-item" type="button" onClick={() => onSelect(item)}>
                <span>✓</span>
                <div><b>{item.goal}</b><small>{formatTime(item.completedAt)} · 扫描 {item.scannedCount} 个 · TEST {item.testCount} 个</small></div>
                <i>›</i>
              </button>
              <button className="history-rerun-button" type="button" onClick={() => onRun(item)}>重新执行</button>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function FavoritesView({ favorites, onToggleFavorite, onGenerateContent, onClose }) {
  return (
    <div className="history-layer" role="dialog" aria-modal="true" aria-label="商品收藏">
      <button className="history-backdrop" type="button" onClick={onClose} aria-label="关闭商品收藏" />
      <section className="history-panel favorites-panel">
        <header><div><small>当前手机保存</small><h2>商品收藏</h2></div><button type="button" onClick={onClose}>×</button></header>
        <div className="favorites-list">
          {favorites.length === 0 && <p className="favorites-empty">还没有收藏商品，先执行一次任务吧。</p>}
          {favorites.map((product) => (
            <article className="favorite-row" key={product.id}>
              <div className="favorite-product">
                {product.imageUrl && <img src={product.imageUrl} alt="" loading="lazy" />}
                <div>
                  <b>{product.name}</b>
                  <small>{product.source} · {formatTime(product.savedAt)}</small>
                  <span>预计利润 {money(product.estimatedProfit, product.currency)}</span>
                </div>
              </div>
              <p>{product.reason}</p>
              <div>
                <a href={product.sourceUrl} target="_blank" rel="noreferrer">查看公开来源 ↗</a>
                <span>
                  <button className="generate-content-button" type="button" onClick={() => onGenerateContent(product)}>生成发布资料</button>
                  <button type="button" onClick={() => onToggleFavorite(product)}>取消收藏</button>
                </span>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function ContentView({ product, onClose }) {
  const [copied, setCopied] = useState(false);
  const content = listingContent(product);
  async function copyContent() {
    await copyText(content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }
  return (
    <div className="history-layer" role="dialog" aria-modal="true" aria-label="商品发布资料">
      <button className="history-backdrop" type="button" onClick={onClose} aria-label="关闭商品发布资料" />
      <section className="history-panel content-panel">
        <header><div><small>根据收藏商品自动生成</small><h2>发布资料</h2></div><button type="button" onClick={onClose}>×</button></header>
        <div className="content-product"><span>商品</span><b>{product.name}</b></div>
        <pre>{content}</pre>
        <button className="copy-content-button" type="button" onClick={copyContent}>{copied ? "✓ 已复制全部资料" : "复制全部发布资料"}</button>
        <p>发布前请再次核对实际价格、库存和平台规则。</p>
      </section>
    </div>
  );
}

export default function App() {
  const restored = useMemo(() => loadLastMobileReport(), []);
  const [goal, setGoal] = useState(DEFAULT_GOAL);
  const [activeGoal, setActiveGoal] = useState(restored?.goal || "");
  const [events, setEvents] = useState(restored ? MISSION_STEPS.map((step) => ({ stepId: step.id, detail: "已完成" })) : []);
  const [report, setReport] = useState(restored);
  const [history, setHistory] = useState(() => loadMobileHistory());
  const [favorites, setFavorites] = useState(() => loadFavorites());
  const [historyOpen, setHistoryOpen] = useState(false);
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  const [contentProduct, setContentProduct] = useState(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  async function startMission(selectedGoal = null) {
    const value = String(typeof selectedGoal === "string" ? selectedGoal : goal).trim();
    if (!value || running) return;
    setActiveGoal(value);
    setEvents([]);
    setReport(null);
    setError("");
    setRunning(true);
    try {
      const result = await executeMobileMission(value, (event) => {
        setEvents((current) => [...current.filter((item) => item.stepId !== event.stepId), event]);
      });
      setReport(result);
      setHistory(loadMobileHistory());
    } catch (missionError) {
      setError(missionError?.message || "Mission 执行失败，请检查网络后重试");
    } finally {
      setRunning(false);
    }
  }

  function openHistoryReport(item) {
    setReport(item);
    setActiveGoal(item.goal);
    setEvents(MISSION_STEPS.map((step) => ({ stepId: step.id, detail: "已完成" })));
    setError("");
    setHistoryOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function rerunHistoryMission(item) {
    setGoal(item.goal);
    setHistoryOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
    void startMission(item.goal);
  }

  function toggleFavorite(product) {
    setFavorites((current) => {
      const exists = current.some((item) => item.id === product.id);
      const next = exists
        ? current.filter((item) => item.id !== product.id)
        : [{ ...product, missionGoal: activeGoal, savedAt: new Date().toISOString() }, ...current].slice(0, 50);
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
      return next;
    });
  }

  return (
    <main className="android-app">
      <header className="app-header">
        <div className="logo">H</div>
        <div><b>Hammer OS</b><small><i /> AI 在线</small></div>
        <div className="header-actions">
          <button className="favorites-open-button" type="button" onClick={() => setFavoritesOpen(true)} disabled={running}>
            收藏 <b>{favorites.length}</b>
          </button>
          <button className="history-open-button" type="button" onClick={() => setHistoryOpen(true)} disabled={running}>
            历史 <b>{history.length}</b>
          </button>
        </div>
      </header>

      <section className="home-view">
        <div className="eyebrow">你的 AI 商业员工</div>
        <h1>一句任务，<br />马上开始执行。</h1>
        <p>输入你今天要完成的目标。Hammer 会读取公开信息、计算利润并返回可核验结果。</p>
        <label htmlFor="mission-input">告诉 Hammer 要做什么</label>
        <textarea
          id="mission-input"
          value={goal}
          onChange={(event) => setGoal(event.target.value)}
          maxLength="300"
          rows="3"
          disabled={running}
          placeholder={DEFAULT_GOAL}
        />
        <button id="start-mission" type="button" onClick={startMission} disabled={running || !goal.trim()}>
          {running ? <><span className="loader" /> AI 执行中</> : <>开始执行 <span>→</span></>}
        </button>
        <div className="safety-line">只读取公开页面 · 不登录 · 不发布 · 不付款</div>
      </section>

      {error && <section className="error-card"><b>执行未完成</b><p>{error}</p><button type="button" onClick={() => startMission()}>重新执行</button></section>}
      <MissionView goal={activeGoal} events={events} running={running} />
      <ResultView report={report} favorites={favorites} onToggleFavorite={toggleFavorite} />
      {report && <button className="again-button" type="button" onClick={() => { setEvents([]); setReport(null); setActiveGoal(""); window.scrollTo({ top: 0, behavior: "smooth" }); }}>＋ 输入新任务</button>}
      <footer>上次完成：{report ? formatTime(report.completedAt) : "暂无"} · 结果保存在当前手机</footer>
      {historyOpen && <HistoryView history={history} onSelect={openHistoryReport} onRun={rerunHistoryMission} onClose={() => setHistoryOpen(false)} />}
      {favoritesOpen && <FavoritesView favorites={favorites} onToggleFavorite={toggleFavorite} onGenerateContent={(product) => { setFavoritesOpen(false); setContentProduct(product); }} onClose={() => setFavoritesOpen(false)} />}
      {contentProduct && <ContentView product={contentProduct} onClose={() => setContentProduct(null)} />}
    </main>
  );
}
