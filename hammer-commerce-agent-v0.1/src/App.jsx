import React, { useEffect, useMemo, useState } from "react";
import { createCommerceAgent } from "./core/create-agent.js";
import { STEP_STATUS, TASK_STATUS } from "./core/task-status.js";
import { CHAIN_STATUS, CHAIN_STEP_STATUS } from "./core/chain-status.js";

const EXAMPLES = [
  "找适合闲鱼卖的高利润小商品",
  "帮我筛选利润率30%以上的商品",
  "规划一个低成本个人卖货测试",
];

const CHAIN_EXAMPLES = [
  "帮我今天卖一个商品",
  "帮我今天赚100块",
  "从商品库找一个利润合适的商品并准备发布",
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

const CHAIN_STATUS_TEXT = {
  [CHAIN_STATUS.WAITING]: "等待执行",
  [CHAIN_STATUS.RUNNING]: "自动执行中",
  [CHAIN_STATUS.BLOCKED]: "等待继续条件",
  [CHAIN_STATUS.SUCCESS]: "任务链完成",
  [CHAIN_STATUS.FAILED]: "任务链失败",
  [CHAIN_STATUS.PAUSED]: "已暂停",
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

function ChainProgress({ chain }) {
  if (!chain) return null;
  return (
    <section className="task-card chain-card" aria-live="polite">
      <div className="task-heading">
        <div><span className={`status-dot status-${chain.status.toLowerCase()}`} /><b>{CHAIN_STATUS_TEXT[chain.status]}</b></div>
        <small>{chain.id}</small>
      </div>
      <p className="task-goal">“{chain.goal}”</p>
      {chain.context?.attempts?.length > 0 && <p className="retry-note">Agent 已自动放弃 {chain.context.attempts.length} 个不合格商品，并继续寻找。</p>}
      <ol className="step-list chain-step-list">
        {chain.steps.map((step) => (
          <li key={step.id} className={`step-${step.status.toLowerCase()}`}>
            <span>{step.status === CHAIN_STEP_STATUS.SUCCESS ? "✓" : step.status === CHAIN_STEP_STATUS.BLOCKED ? "!" : step.index + 1}</span>
            <div><b>{step.title}</b><small>{step.status === CHAIN_STEP_STATUS.RUNNING ? "Agent 正在自动处理…" : step.status === CHAIN_STEP_STATUS.SUCCESS ? "已完成" : step.status === CHAIN_STEP_STATUS.BLOCKED ? "等待条件后自动继续" : step.description}</small></div>
          </li>
        ))}
      </ol>
      {chain.error && <p className="error-message">{chain.error}</p>}
    </section>
  );
}

function ChainBlockedAction({ chain, running, saleResult, setSaleResult, quickProductText, setQuickProductText, error, onQuickProduct, onResume, onGoProduct, onCopy }) {
  if (chain?.status !== CHAIN_STATUS.BLOCKED || !chain.blocked) return null;
  const { actionType, reason, data } = chain.blocked;
  if (actionType === "NEED_PRODUCTS" || actionType === "NO_VIABLE_PRODUCTS") {
    return (
      <section className="chain-action-card quick-product-card">
        <span>Agent 只需要一句商品资料</span>
        <h2>{actionType === "NEED_PRODUCTS" ? "补充一个候选，自动继续" : "换一个候选，自动继续"}</h2>
        <p>{reason}</p>
        <textarea value={quickProductText} onChange={(event) => setQuickProductText(event.target.value)} rows="3" placeholder="例如：桌面风扇，成本15，售价39.9，运费5，备注夏季小件" disabled={running} />
        {error && <p className="input-error">{error}</p>}
        <div className="chain-action-buttons"><button type="button" className="secondary" onClick={onGoProduct}>使用完整表单</button><button type="button" onClick={onQuickProduct} disabled={running || !quickProductText.trim()}>{running ? "Agent 正在接管…" : "自动分析并继续 →"}</button></div>
        <small className="operation-saving">原来：跳页并填写 5 项　现在：粘贴一句，自动恢复任务链</small>
      </section>
    );
  }
  if (actionType === "CONFIRM_PUBLISH") {
    return (
      <section className="chain-action-card"><span>发布资料已准备</span><h2>等待发布确认</h2><p>{reason}</p>{data?.title && <div className="publish-preview"><b>{data.title}</b><p>{data.description}</p></div>}<div className="chain-action-buttons"><button type="button" className="secondary" onClick={() => onCopy(data)}>复制发布资料</button><button type="button" onClick={() => onResume({ published: true })} disabled={running}>我已发布，继续 →</button></div></section>
    );
  }
  if (actionType === "WAIT_SALE_RESULT") {
    return (
      <section className="chain-action-card"><span>任务正在等待</span><h2>填写真实成交结果</h2><p>{reason}</p><div className="sale-result-fields"><label><span>成交单价</span><div><i>¥</i><input value={saleResult.salePrice} onChange={(event) => setSaleResult((current) => ({ ...current, salePrice: event.target.value }))} inputMode="decimal" /></div></label><label><span>成交数量</span><input value={saleResult.quantity} onChange={(event) => setSaleResult((current) => ({ ...current, quantity: event.target.value }))} inputMode="numeric" /></label></div><div className="chain-action-buttons"><button type="button" className="secondary" onClick={() => onResume({ saleResult: { quantity: 0, salePrice: 0 } })} disabled={running}>今天未成交</button><button type="button" onClick={() => onResume({ saleResult })} disabled={running || !saleResult.salePrice}>记录成交并继续 →</button></div></section>
    );
  }
  return <section className="chain-action-card"><h2>任务链已暂停</h2><p>{reason}</p></section>;
}

function ChainFinalReport({ chain }) {
  if (chain?.status !== CHAIN_STATUS.SUCCESS || !chain.result) return null;
  const report = chain.result;
  return (
    <section className="report-card chain-final-report"><div className="report-kicker">OWNER REPORT · V1.0</div><h2>今日任务汇报</h2><p className="report-summary">{report.summary}</p><div className="chain-result-list"><div><span>成交数量</span><b>{report.quantity} 件</b></div><div><span>成交收入</span><b>{money(report.revenue)}</b></div><div><span>今日利润</span><b>{money(report.profit)}</b></div></div>{report.target !== null && <p className={`target-result ${report.targetReached ? "reached" : ""}`}>{report.targetReached ? "✓ 已达到" : "尚未达到"} {money(report.target)} 利润目标</p>}<div className="report-section"><h3>Agent 下一步</h3><p>{report.nextAction}</p></div></section>
  );
}

function ChainHome({ goal, setGoal, running, error, onRun, chains, onOpenChain }) {
  return (
    <><section className="hero chain-hero"><div className="agent-badge"><span /> Autonomous Commerce Agent</div><h1>只说目标，<br /><em>Agent 自己推进。</em></h1><p>尽量自动完成商业任务，只在登录、发布、下单和支付等必要节点请求确认。</p><div className="capability-row"><span>连续任务</span><span>自动跳过失败项</span><span>断点恢复</span><span>主人日报</span></div></section><section className="chain-command-card"><label htmlFor="chain-goal">今天想让 Agent 做什么？</label><textarea id="chain-goal" value={goal} onChange={(event) => setGoal(event.target.value)} rows="3" maxLength="300" placeholder="例如：帮我今天赚100块" disabled={running} />{error && <p className="input-error">{error}</p>}<button type="button" onClick={() => onRun(goal)} disabled={running || !goal.trim()}>{running ? <><span className="button-loader" /> 正在启动任务链</> : <>开始自动执行 <span>→</span></>}</button></section><section className="examples chain-examples"><small>一句话示例</small>{CHAIN_EXAMPLES.map((example) => <button key={example} type="button" onClick={() => onRun(example)}>{example}<span>↗</span></button>)}</section>{chains.length > 0 && <section className="recent-chains"><small>最近任务链</small>{chains.slice(0, 3).map((chain) => <button key={chain.id} type="button" onClick={() => onOpenChain(chain)}><span className={`status-dot status-${chain.status.toLowerCase()}`} /><div><b>{chain.goal}</b><small>{CHAIN_STATUS_TEXT[chain.status]} · {formatTime(chain.createdAt)}</small></div><i>›</i></button>)}</section>}</>
  );
}

function BusinessReport({ report }) {
  return (
    <section className="report-card business-report">
      <div className="report-kicker">COMMERCE REPORT · V0.3</div>
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

function SelectionReport({ report }) {
  return (
    <section className="report-card selection-report">
      <div className="report-kicker">SELECTION REPORT · V0.3</div>
      <h2>{report.title}</h2>
      <p className="report-summary">{report.summary}</p>
      {report.winner && (
        <div className="winner-card">
          <span>优先测试商品</span>
          <div><h3>{report.winner.name}</h3><b>{report.winner.score}<small>/100</small></b></div>
          <p>单件利润 {money(report.winner.profit)} · 利润率 {report.winner.profitRate}%</p>
        </div>
      )}
      <div className="ranking-list">
        {report.rankings.map((product) => (
          <article key={product.id} className={product.rank === 1 && report.winner ? "ranking-first" : ""}>
            <i>{product.rank}</i>
            <div><b>{product.name}</b><small>{product.decision}</small></div>
            <span><b>{product.score}</b><small>分</small></span>
            <p>利润 {money(product.profit)} · 利润率 {product.profitRate}% · 售价 {money(product.price)}</p>
          </article>
        ))}
      </div>
      <div className="report-section"><h3>测试顺序</h3><ol>{report.testPlan.map((item) => <li key={item}>{item}</li>)}</ol></div>
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
  if (report.kind === "PRODUCT_ANALYSIS") return <BusinessReport report={report} />;
  if (report.kind === "SELECTION_COMPARISON") return <SelectionReport report={report} />;
  return <GoalReport report={report} />;
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

function SelectionForm({ products, selectedIds, setSelectedIds, running, error, onSubmit, onGoProduct }) {
  function toggle(id) {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }
  if (products.length < 2) {
    return (
      <section className="selection-empty">
        <span>还差 {2 - products.length} 个商品</span>
        <h2>先分析至少两个商品</h2>
        <p>完成单品分析后，商品会自动进入商品库，再由 Agent 做横向排名。</p>
        <button type="button" onClick={onGoProduct}>去分析商品 →</button>
      </section>
    );
  }
  return (
    <section className="selection-form">
      <div className="form-heading"><span>选择候选商品</span><small>已选 {selectedIds.length} 个</small></div>
      <div className="candidate-list">
        {products.map((product) => {
          const selected = selectedIds.includes(product.id);
          return (
            <button key={product.id} type="button" className={selected ? "selected" : ""} aria-pressed={selected} onClick={() => toggle(product.id)} disabled={running}>
              <i>{selected ? "✓" : ""}</i>
              <div><b>{product.name}</b><small>利润 {money(product.profit)} · 利润率 {product.profitRate}%</small></div>
              <span><b>{product.score}</b><small>分</small></span>
            </button>
          );
        })}
      </div>
      {error && <p className="input-error">{error}</p>}
      <button className="analyze-button" type="button" onClick={onSubmit} disabled={running || selectedIds.length < 2}>
        {running ? <><span className="button-loader" /> Agent 正在对比</> : <>开始选品对比 <span>→</span></>}
      </button>
      <p className="form-note">对比使用已保存的利润和评分，不会调用或虚构平台数据。</p>
    </section>
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
  const [mode, setMode] = useState("chain");
  const [product, setProduct] = useState({ ...EMPTY_PRODUCT });
  const [selectedIds, setSelectedIds] = useState([]);
  const [goal, setGoal] = useState("");
  const [chainGoal, setChainGoal] = useState("");
  const [currentTask, setCurrentTask] = useState(null);
  const [currentChain, setCurrentChain] = useState(() => agent.getChains().find((chain) => [CHAIN_STATUS.BLOCKED, CHAIN_STATUS.RUNNING, CHAIN_STATUS.WAITING].includes(chain.status)) || null);
  const [history, setHistory] = useState(() => agent.getHistory());
  const [chains, setChains] = useState(() => agent.getChains());
  const [products, setProducts] = useState(() => agent.getProducts());
  const [historyOpen, setHistoryOpen] = useState(false);
  const [productsOpen, setProductsOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [inputError, setInputError] = useState("");
  const [saleResult, setSaleResult] = useState({ salePrice: "", quantity: "1" });
  const [quickProductText, setQuickProductText] = useState("");
  const [installEvent, setInstallEvent] = useState(null);

  useEffect(() => {
    const handleInstall = (event) => { event.preventDefault(); setInstallEvent(event); };
    window.addEventListener("beforeinstallprompt", handleInstall);
    return () => window.removeEventListener("beforeinstallprompt", handleInstall);
  }, []);

  useEffect(() => {
    if (currentChain?.blocked?.actionType !== "WAIT_SALE_RESULT" || saleResult.salePrice) return;
    const selectedProduct = currentChain.context?.outputs?.["chain.profit.screen"]?.product;
    if (selectedProduct?.price) setSaleResult({ salePrice: String(selectedProduct.price), quantity: "1" });
  }, [currentChain, saleResult.salePrice]);

  function handleUpdate(updatedTask) {
    setCurrentTask({ ...updatedTask });
    setHistory(agent.getHistory());
  }

  function handleChainUpdate(updatedChain) {
    setCurrentChain({ ...updatedChain });
    setChains(agent.getChains());
    if (updatedChain.blocked?.actionType === "WAIT_SALE_RESULT" && !saleResult.salePrice) {
      const selectedProduct = updatedChain.context?.outputs?.["chain.profit.screen"]?.product;
      if (selectedProduct?.price) setSaleResult({ salePrice: String(selectedProduct.price), quantity: "1" });
    }
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

  async function compareProducts() {
    if (running) return;
    if (selectedIds.length < 2) return setInputError("至少选择 2 个商品进行对比。");
    setInputError("");
    setRunning(true);
    setCurrentTask(null);
    try { await agent.runProductComparison(selectedIds, handleUpdate); }
    catch (error) { setInputError(error?.message || "选品对比失败。"); }
    finally { setHistory(agent.getHistory()); setRunning(false); }
  }

  async function runChain(selectedGoal = chainGoal) {
    const value = String(selectedGoal || "").trim();
    if (!value) return setInputError("先告诉 Agent 今天要完成什么目标。");
    if (running) return;
    setMode("chain");
    setChainGoal(value);
    setInputError("");
    setRunning(true);
    setCurrentTask(null);
    setCurrentChain(null);
    try { await agent.runTaskChain(value, handleChainUpdate); }
    catch (error) { setInputError(error?.message || "任务链启动失败。"); }
    finally { setChains(agent.getChains()); setRunning(false); }
  }

  async function resumeChain(signals) {
    if (!currentChain || running) return;
    setRunning(true);
    setInputError("");
    try { await agent.resumeTaskChain(currentChain.id, signals, handleChainUpdate); }
    catch (error) { setInputError(error?.message || "任务链恢复失败。"); }
    finally { setChains(agent.getChains()); setRunning(false); }
  }

  async function quickAddCandidate() {
    if (!currentChain || running) return;
    setRunning(true);
    setInputError("");
    try {
      await agent.addCandidateAndResume(currentChain.id, quickProductText, handleChainUpdate);
      setQuickProductText("");
      setProducts(agent.getProducts());
      setHistory(agent.getHistory());
    } catch (error) {
      setInputError(error?.message || "一句话商品信息识别失败。");
    } finally {
      setChains(agent.getChains());
      setRunning(false);
    }
  }

  async function copyPublishData(data) {
    const text = `${data?.title || ""}\n\n${data?.description || ""}`.trim();
    if (!text) return;
    try { await navigator.clipboard.writeText(text); }
    catch { setInputError("复制失败，请长按发布内容复制。"); }
  }

  async function installApp() {
    if (!installEvent) return;
    await installEvent.prompt();
    setInstallEvent(null);
  }

  function selectHistory(task) {
    setCurrentChain(null);
    setCurrentTask(task);
    setMode(task.type === "PRODUCT_ANALYSIS" ? "product" : task.type === "PRODUCT_COMPARISON" ? "selection" : "goal");
    setHistoryOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function startNew() {
    setCurrentTask(null);
    setCurrentChain(null);
    setInputError("");
    if (mode === "chain") { setChainGoal(""); setSaleResult({ salePrice: "", quantity: "1" }); }
    else if (mode === "product") setProduct({ ...EMPTY_PRODUCT });
    else if (mode === "selection") setSelectedIds([]);
    else setGoal("");
  }

  return (
    <main className={`app-shell mode-${mode}`}>
      <header className="topbar">
        <div className="brand"><span>H</span><div><b>Hammer Commerce</b><small>Autonomous Agent V1.0</small></div></div>
        <div className="top-actions">
          {installEvent && <button type="button" onClick={installApp}>安装</button>}
          <button type="button" onClick={() => setProductsOpen(true)}>商品 <i>{products.length}</i></button>
          <button type="button" onClick={() => setHistoryOpen(true)}>历史 <i>{history.length}</i></button>
        </div>
      </header>

      {!currentTask && !currentChain && (
        <nav className="mode-tabs" aria-label="Agent 模式">
          <button className={mode === "chain" ? "active" : ""} type="button" onClick={() => { setMode("chain"); setInputError(""); }}>自动任务</button>
          <button className={mode === "product" ? "active" : ""} type="button" onClick={() => { setMode("product"); setInputError(""); }}>商品分析</button>
          <button className={mode === "selection" ? "active" : ""} type="button" onClick={() => { setMode("selection"); setInputError(""); }}>选品对比</button>
          <button className={mode === "goal" ? "active" : ""} type="button" onClick={() => { setMode("goal"); setInputError(""); }}>目标任务</button>
        </nav>
      )}

      {!currentTask && !currentChain && mode === "product" && (
        <><section className="hero product-hero"><div className="agent-badge"><span /> AI 选品员工</div><h1>输入成本，<br /><em>判断能不能卖。</em></h1><p>自动计算利润、保本价和五维评分，先把赚钱判断做清楚。</p><div className="capability-row"><span>成本分析</span><span>利润计算</span><span>风险判断</span><span>销售建议</span></div></section><ProductForm product={product} setProduct={setProduct} running={running} error={inputError} onSubmit={analyzeProduct} /></>
      )}

      {!currentTask && !currentChain && mode === "goal" && (
        <><section className="hero"><div className="agent-badge"><span /> AI 电商执行助手</div><h1>告诉我目标，<br /><em>我来拆解执行。</em></h1><p>建立选品任务、利润条件和执行方案，无需学习复杂工具。</p></section><section className="examples"><small>你可以这样说</small>{EXAMPLES.map((example) => <button key={example} type="button" onClick={() => runGoal(example)}>{example}<span>↗</span></button>)}</section></>
      )}

      {!currentTask && !currentChain && mode === "selection" && (
        <><section className="hero product-hero"><div className="agent-badge"><span /> AI 选品助手</div><h1>多个商品，<br /><em>选出先卖哪个。</em></h1><p>横向比较评分、利润率和单件利润，生成优先测试顺序。</p></section><SelectionForm products={products} selectedIds={selectedIds} setSelectedIds={setSelectedIds} running={running} error={inputError} onSubmit={compareProducts} onGoProduct={() => setMode("product")} /></>
      )}

      {!currentTask && !currentChain && mode === "chain" && <ChainHome goal={chainGoal} setGoal={setChainGoal} running={running} error={inputError} onRun={runChain} chains={chains} onOpenChain={(chain) => { setCurrentChain(chain); setMode("chain"); setInputError(""); }} />}

      <TaskProgress task={currentTask} />
      <ExecutionReport report={currentTask?.result} />
      <ChainProgress chain={currentChain} />
      <ChainBlockedAction chain={currentChain} running={running} saleResult={saleResult} setSaleResult={setSaleResult} quickProductText={quickProductText} setQuickProductText={setQuickProductText} error={inputError} onQuickProduct={quickAddCandidate} onResume={resumeChain} onGoProduct={() => { setCurrentChain(null); setMode("product"); setInputError(""); }} onCopy={copyPublishData} />
      <ChainFinalReport chain={currentChain} />
      {currentTask?.status === TASK_STATUS.SUCCESS && <button className="new-task-button" type="button" onClick={startNew}>＋ {mode === "product" ? "分析另一个商品" : mode === "selection" ? "重新选择商品" : "创建新任务"}</button>}
      {currentChain?.status === CHAIN_STATUS.SUCCESS && <button className="new-task-button" type="button" onClick={startNew}>＋ 创建新的自动任务</button>}

      {mode === "goal" && !currentTask && !currentChain && (
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
