import React, { useEffect, useMemo, useState } from "react";
import { createCommerceAgent } from "./core/create-agent.js";
import { STEP_STATUS, TASK_STATUS } from "./core/task-status.js";

const EXAMPLES = [
  "找适合闲鱼卖的高利润小商品",
  "帮我筛选利润率30%以上的商品",
  "规划一个低成本个人卖货测试",
];

const EMPTY_PRODUCT = Object.freeze({
  name: "",
  cost: "",
  price: "",
  shipping: "",
  platformFee: "0",
  note: "",
});

const STATUS_TEXT = {
  [TASK_STATUS.WAITING]: "等待执行",
  [TASK_STATUS.RUNNING]: "正在分析",
  [TASK_STATUS.SUCCESS]: "分析完成",
  [TASK_STATUS.FAILED]: "分析失败",
};

const DIMENSION_LABELS = {
  profit: "利润",
  demand: "需求",
  competition: "竞争",
  afterSales: "售后安全",
  transport: "运输",
};

const money = (value) => `¥${Number(value || 0).toFixed(2).replace(/\.00$/, "")}`;

function formatTime(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function TaskProgress({ task }) {
  if (!task) return null;
  return (
    <section className="task-card" aria-live="polite">
      <div className="task-heading">
        <div><span className={`status-dot status-${task.status.toLowerCase()}`} /><b>{STATUS_TEXT[task.status]}</b></div>
        <small>{task.id}</small>
      </div>
      <p className="task-goal">“{task.goal}”</p>
      {task.steps.length > 0 && (
        <ol className="step-list">
          {task.steps.map((step) => (
            <li key={step.id} className={`step-${step.status.toLowerCase()}`}>
              <span>{step.status === STEP_STATUS.SUCCESS ? "✓" : step.index + 1}</span>
              <div>
                <b>{step.title}</b>
                <small>{step.status === STEP_STATUS.RUNNING ? "Agent 正在处理…" : step.status === STEP_STATUS.SUCCESS ? "已完成" : "等待"}</small>
              </div>
            </li>
          ))}
        </ol>
      )}
      {task.error && <p className="error-message">{task.error}</p>}
    </section>
  );
}

function BusinessReport({ report }) {
  return (
    <section className="report-card business-report">
      <div className="report-kicker">COMMERCE REPORT · V0.2</div>
      <div className="business-title-row">
        <div><h2>{report.title}</h2><p>{report.product.name}</p></div>
        <div className="score-ring" style={{ "--score": `${report.score.total * 3.6}deg` }}>
          <b>{report.score.total}</b><small>/100</small>
        </div>
      </div>
      <div className={`recommendation recommendation-${report.recommendation.tone}`}>
        <span>推荐等级 {report.recommendation.level}</span><b>{report.recommendation.label}</b>
      </div>
      <div className="money-grid">
        <div><small>总成本</small><b>{money(report.cost.total)}</b></div>
        <div><small>建议售价</small><b>{money(report.pricing.recommended)}</b></div>
        <div><small>预计利润</small><b className={report.profit.net < 0 ? "negative" : ""}>{money(report.profit.net)}</b></div>
        <div><small>利润率</small><b className={report.profit.rate < 30 ? "negative" : ""}>{report.profit.rate}%</b></div>
      </div>
      <div className="cost-detail">
        <span>采购 {money(report.cost.purchase)}</span>
        <span>运费 {money(report.cost.shipping)}</span>
        <span>平台费 {money(report.cost.platformFee)}</span>
        <span>保本价 {money(report.pricing.minimum)}</span>
      </div>
      <div className="report-section score-section">
        <h3>五维商品评分</h3>
        {Object.entries(report.score.dimensions).map(([key, value]) => (
          <div className="dimension-row" key={key}>
            <span>{DIMENSION_LABELS[key]} <small>{report.score.weights[key]}%</small></span>
            <i><em style={{ width: `${value}%` }} /></i><b>{value}</b>
          </div>
        ))}
      </div>
      <div className="report-section">
        <h3>风险判断</h3>
        <ul>{report.risks.map((risk) => <li key={risk}>{risk}</li>)}</ul>
      </div>
      <div className="report-section">
        <h3>下一步建议</h3>
        <ol>{report.nextActions.map((action) => <li key={action}>{action}</li>)}</ol>
      </div>
      <p className="report-notice">{report.notice}</p>
    </section>
  );
}

function GoalReport({ report }) {
  return (
    <section className="report-card">
      <div className="report-kicker">AGENT REPORT</div>
      <h2>{report.title}</h2>
      <p className="report-summary">{report.summary}</p>
      <div className="metric-grid">
        {report.metrics.map((metric) => <div key={metric.label}><small>{metric.label}</small><b>{metric.value}</b></div>)}
      </div>
      <div className="report-section"><h3>筛选条件</h3><ul>{report.filters.map((item) => <li key={item}>{item}</li>)}</ul></div>
      <div className="report-section"><h3>接下来执行</h3><ol>{report.actions.map((item) => <li key={item}>{item}</li>)}</ol></div>
      <p className="report-notice">{report.notice}</p>
    </section>
  );
}

function ExecutionReport({ report }) {
  if (!report) return null;
  return report.kind === "PRODUCT_ANALYSIS" ? <BusinessReport report={report} /> : <GoalReport report={report} />;
}

function ProductForm({ product, setProduct, running, error, onSubmit }) {
  const update = (field) => (event) => setProduct((current) => ({ ...current, [field]: event.target.value }));
  return (
    <form className="product-form" onSubmit={onSubmit}>
      <div className="form-heading"><span>商品信息</span><small>带 * 为必填</small></div>
      <label className="full-field"><span>商品名称 *</span><input id="product-name" name="productName" value={product.name} onChange={update("name")} maxLength="80" placeholder="例如：桌面风扇" disabled={running} /></label>
      <div className="money-fields">
        <label><span>采购价格 *</span><div><i>¥</i><input id="product-cost" name="productCost" value={product.cost} onChange={update("cost")} inputMode="decimal" placeholder="15" disabled={running} /></div></label>
        <label><span>销售价格 *</span><div><i>¥</i><input id="product-price" name="productPrice" value={product.price} onChange={update("price")} inputMode="decimal" placeholder="39.9" disabled={running} /></div></label>
        <label><span>运费 *</span><div><i>¥</i><input id="product-shipping" name="productShipping" value={product.shipping} onChange={update("shipping")} inputMode="decimal" placeholder="5" disabled={running} /></div></label>
        <label><span>平台费用</span><div><i>¥</i><input id="product-platform-fee" name="productPlatformFee" value={product.platformFee} onChange={update("platformFee")} inputMode="decimal" placeholder="0" disabled={running} /></div></label>
      </div>
      <label className="full-field"><span>备注</span><textarea id="product-note" name="productNote" value={product.note} onChange={update("note")} rows="3" maxLength="300" placeholder="例如：夏季商品、小件、一件代发；供应商售后一般" disabled={running} /></label>
      {error && <p className="input-error">{error}</p>}
      <button className="analyze-button" type="submit" disabled={running}>
        {running ? <><span className="button-loader" /> Agent 正在分析</> : <>开始商业分析 <span>→</span></>}
      </button>
      <p className="form-note">利润使用你的真实数字计算；需求与竞争先做规则初评。</p>
    </form>
  );
}

function BottomPanel({ title, eyebrow, onClose, children, footer }) {
  return (
    <div className="history-layer" role="dialog" aria-modal="true" aria-label={title}>
      <button className="history-backdrop" type="button" onClick={onClose} aria-label={`关闭${title}`} />
      <section className="history-panel">
        <header><div><small>{eyebrow}</small><h2>{title}</h2></div><button type="button" onClick={onClose}>×</button></header>
        {children}
        {footer}
      </section>
    </div>
  );
}

function HistoryPanel({ history, onSelect, onClose, onClear }) {
  return (
    <BottomPanel title="任务历史" eyebrow="本机保存" onClose={onClose} footer={history.length > 0 && <button className="clear-history" type="button" onClick={onClear}>清空本机历史</button>}>
      <div className="history-list">
        {history.length === 0 && <p className="empty-history">还没有任务记录。</p>}
        {history.map((task) => (
          <button key={task.id} type="button" onClick={() => onSelect(task)}>
            <span className={`status-dot status-${task.status.toLowerCase()}`} />
            <div><b>{task.goal}</b><small>{STATUS_TEXT[task.status]} · {formatTime(task.createdAt)}</small></div><i>›</i>
          </button>
        ))}
      </div>
    </BottomPanel>
  );
}

function ProductPanel({ products, onClose, onClear }) {
  return (
    <BottomPanel title="商品库" eyebrow="PRODUCTS · 本机保存" onClose={onClose} footer={products.length > 0 && <button className="clear-history" type="button" onClick={onClear}>清空本机商品库</button>}>
      <div className="product-list">
        {products.length === 0 && <p className="empty-history">分析完成的商品会保存在这里。</p>}
        {products.map((product) => (
          <article key={product.id}>
            <div><b>{product.name}</b><small>{formatTime(product.created_time)} · {product.recommendation}</small></div>
            <span><b>{product.score}</b><small>分</small></span>
            <p>成本 {money(product.cost + product.shipping + product.platformFee)} · 售价 {money(product.price)} · 利润 {money(product.profit)}</p>
          </article>
        ))}
      </div>
    </BottomPanel>
  );
}

export default function App() {
  const agent = useMemo(() => createCommerceAgent({ stepDelay: 300 }), []);
  const [mode, setMode] = useState("product");
  const [product, setProduct] = useState({ ...EMPTY_PRODUCT });
  const [goal, setGoal] = useState("");
  const [currentTask, setCurrentTask] = useState(null);
  const [history, setHistory] = useState(() => agent.getHistory());
  const [products, setProducts] = useState(() => agent.getProducts());
  const [historyOpen, setHistoryOpen] = useState(false);
  const [productsOpen, setProductsOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [inputError, setInputError] = useState("");
  const [installEvent, setInstallEvent] = useState(null);

  useEffect(() => {
    const handleInstall = (event) => { event.preventDefault(); setInstallEvent(event); };
    window.addEventListener("beforeinstallprompt", handleInstall);
    return () => window.removeEventListener("beforeinstallprompt", handleInstall);
  }, []);

  function handleUpdate(updatedTask) {
    setCurrentTask({ ...updatedTask });
    setHistory(agent.getHistory());
  }

  async function analyzeProduct(event) {
    event.preventDefault();
    if (running) return;
    const fields = event.currentTarget.elements;
    const submittedProduct = {
      name: fields.productName.value,
      cost: fields.productCost.value,
      price: fields.productPrice.value,
      shipping: fields.productShipping.value,
      platformFee: fields.productPlatformFee.value,
      note: fields.productNote.value,
    };
    if (!submittedProduct.name.trim()) return setInputError("先填写商品名称。");
    if (submittedProduct.cost === "" || submittedProduct.price === "" || submittedProduct.shipping === "") return setInputError("请填写采购价格、销售价格和运费。");
    setProduct(submittedProduct);
    setInputError("");
    setRunning(true);
    setCurrentTask(null);
    try {
      await agent.runProductAnalysis(submittedProduct, handleUpdate);
      setProducts(agent.getProducts());
    } catch (error) {
      setInputError(error?.message || "商品分析失败，请检查输入。");
    } finally {
      setHistory(agent.getHistory());
      setRunning(false);
    }
  }

  async function runGoal(selectedGoal = goal) {
    const value = String(selectedGoal || "").trim();
    if (!value) return setInputError("先告诉我你想完成什么卖货目标。");
    if (running) return;
    setGoal(value);
    setInputError("");
    setRunning(true);
    setCurrentTask(null);
    try { await agent.run(value, handleUpdate); }
    finally { setHistory(agent.getHistory()); setRunning(false); }
  }

  async function installApp() {
    if (!installEvent) return;
    await installEvent.prompt();
    setInstallEvent(null);
  }

  function selectHistory(task) {
    setCurrentTask(task);
    setMode(task.type === "PRODUCT_ANALYSIS" ? "product" : "goal");
    setHistoryOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function startNew() {
    setCurrentTask(null);
    setInputError("");
    if (mode === "product") setProduct({ ...EMPTY_PRODUCT });
    else setGoal("");
  }

  return (
    <main className={`app-shell mode-${mode}`}>
      <header className="topbar">
        <div className="brand"><span>H</span><div><b>Hammer Commerce</b><small>Agent V0.2</small></div></div>
        <div className="top-actions">
          {installEvent && <button type="button" onClick={installApp}>安装</button>}
          <button type="button" onClick={() => setProductsOpen(true)}>商品 <i>{products.length}</i></button>
          <button type="button" onClick={() => setHistoryOpen(true)}>历史 <i>{history.length}</i></button>
        </div>
      </header>

      {!currentTask && (
        <nav className="mode-tabs" aria-label="Agent 模式">
          <button className={mode === "product" ? "active" : ""} type="button" onClick={() => { setMode("product"); setInputError(""); }}>商品分析</button>
          <button className={mode === "goal" ? "active" : ""} type="button" onClick={() => { setMode("goal"); setInputError(""); }}>目标任务</button>
        </nav>
      )}

      {!currentTask && mode === "product" && (
        <><section className="hero product-hero"><div className="agent-badge"><span /> AI 选品员工</div><h1>输入成本，<br /><em>判断能不能卖。</em></h1><p>自动计算利润、保本价和五维评分，先把赚钱判断做清楚。</p><div className="capability-row"><span>成本分析</span><span>利润计算</span><span>风险判断</span><span>销售建议</span></div></section><ProductForm product={product} setProduct={setProduct} running={running} error={inputError} onSubmit={analyzeProduct} /></>
      )}

      {!currentTask && mode === "goal" && (
        <><section className="hero"><div className="agent-badge"><span /> AI 电商执行助手</div><h1>告诉我目标，<br /><em>我来拆解执行。</em></h1><p>建立选品任务、利润条件和执行方案，无需学习复杂工具。</p></section><section className="examples"><small>你可以这样说</small>{EXAMPLES.map((example) => <button key={example} type="button" onClick={() => runGoal(example)}>{example}<span>↗</span></button>)}</section></>
      )}

      <TaskProgress task={currentTask} />
      <ExecutionReport report={currentTask?.result} />
      {currentTask?.status === TASK_STATUS.SUCCESS && <button className="new-task-button" type="button" onClick={startNew}>＋ {mode === "product" ? "分析另一个商品" : "创建新任务"}</button>}

      {mode === "goal" && !currentTask && (
        <section className="composer-wrap">
          <label htmlFor="goal-input">告诉我你想卖什么？</label>
          <div className="composer"><textarea id="goal-input" rows="2" maxLength="300" value={goal} disabled={running} onChange={(event) => setGoal(event.target.value)} placeholder="例如：找适合闲鱼卖的高利润小商品" /><button type="button" disabled={running || !goal.trim()} onClick={() => runGoal()} aria-label="开始执行">{running ? <span className="button-loader" /> : "↑"}</button></div>
          {inputError && <p className="input-error">{inputError}</p>}<p className="local-note">任务记录仅保存在当前手机浏览器</p>
        </section>
      )}

      {historyOpen && <HistoryPanel history={history} onSelect={selectHistory} onClose={() => setHistoryOpen(false)} onClear={() => { agent.store.clear(); setHistory([]); setCurrentTask(null); setHistoryOpen(false); }} />}
      {productsOpen && <ProductPanel products={products} onClose={() => setProductsOpen(false)} onClear={() => { agent.productStore.clear(); setProducts([]); setProductsOpen(false); }} />}
    </main>
  );
}
