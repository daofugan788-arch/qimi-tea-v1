import React, { useEffect, useMemo, useState } from "react";
import { createCommerceAgent } from "./core/create-agent.js";
import { STEP_STATUS, TASK_STATUS } from "./core/task-status.js";

const EXAMPLES = [
  "找适合闲鱼卖的高利润小商品",
  "帮我筛选利润率30%以上的商品",
  "规划一个低成本个人卖货测试",
];

const STATUS_TEXT = {
  [TASK_STATUS.WAITING]: "等待执行",
  [TASK_STATUS.RUNNING]: "正在执行",
  [TASK_STATUS.SUCCESS]: "执行完成",
  [TASK_STATUS.FAILED]: "执行失败",
};

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
        <div>
          <span className={`status-dot status-${task.status.toLowerCase()}`} />
          <b>{STATUS_TEXT[task.status]}</b>
        </div>
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

function ExecutionReport({ report }) {
  if (!report) return null;
  return (
    <section className="report-card">
      <div className="report-kicker">AGENT REPORT</div>
      <h2>{report.title}</h2>
      <p className="report-summary">{report.summary}</p>
      <div className="metric-grid">
        {report.metrics.map((metric) => (
          <div key={metric.label}><small>{metric.label}</small><b>{metric.value}</b></div>
        ))}
      </div>
      <div className="report-section">
        <h3>筛选条件</h3>
        <ul>{report.filters.map((item) => <li key={item}>{item}</li>)}</ul>
      </div>
      <div className="report-section">
        <h3>接下来执行</h3>
        <ol>{report.actions.map((item) => <li key={item}>{item}</li>)}</ol>
      </div>
      <div className="input-needed">
        <b>下一阶段需要的商品信息</b>
        <p>{report.requiredInputs.join(" · ")}</p>
      </div>
      <p className="report-notice">{report.notice}</p>
    </section>
  );
}

function HistoryPanel({ history, onSelect, onClose, onClear }) {
  return (
    <div className="history-layer" role="dialog" aria-modal="true" aria-label="任务历史">
      <button className="history-backdrop" type="button" onClick={onClose} aria-label="关闭历史" />
      <section className="history-panel">
        <header><div><small>本机保存</small><h2>任务历史</h2></div><button type="button" onClick={onClose}>×</button></header>
        <div className="history-list">
          {history.length === 0 && <p className="empty-history">还没有任务记录。</p>}
          {history.map((task) => (
            <button key={task.id} type="button" onClick={() => onSelect(task)}>
              <span className={`status-dot status-${task.status.toLowerCase()}`} />
              <div><b>{task.goal}</b><small>{STATUS_TEXT[task.status]} · {formatTime(task.createdAt)}</small></div>
              <i>›</i>
            </button>
          ))}
        </div>
        {history.length > 0 && <button className="clear-history" type="button" onClick={onClear}>清空本机历史</button>}
      </section>
    </div>
  );
}

export default function App() {
  const agent = useMemo(() => createCommerceAgent({ stepDelay: 360 }), []);
  const [goal, setGoal] = useState("");
  const [currentTask, setCurrentTask] = useState(null);
  const [history, setHistory] = useState(() => agent.getHistory());
  const [historyOpen, setHistoryOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [inputError, setInputError] = useState("");
  const [installEvent, setInstallEvent] = useState(null);

  useEffect(() => {
    const handleInstall = (event) => {
      event.preventDefault();
      setInstallEvent(event);
    };
    window.addEventListener("beforeinstallprompt", handleInstall);
    return () => window.removeEventListener("beforeinstallprompt", handleInstall);
  }, []);

  async function runGoal(selectedGoal = goal) {
    const value = String(selectedGoal || "").trim();
    if (!value) {
      setInputError("先告诉我你想完成什么卖货目标。");
      return;
    }
    if (running) return;
    setGoal(value);
    setInputError("");
    setRunning(true);
    setCurrentTask(null);
    try {
      await agent.run(value, (updatedTask) => {
        setCurrentTask({ ...updatedTask });
        setHistory(agent.getHistory());
      });
    } finally {
      setHistory(agent.getHistory());
      setRunning(false);
    }
  }

  async function installApp() {
    if (!installEvent) return;
    await installEvent.prompt();
    setInstallEvent(null);
  }

  function selectHistory(task) {
    setCurrentTask(task);
    setHistoryOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function clearHistory() {
    agent.store.clear();
    setHistory([]);
    setCurrentTask(null);
    setHistoryOpen(false);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><span>H</span><div><b>Hammer Commerce</b><small>Agent V0.1</small></div></div>
        <div className="top-actions">
          {installEvent && <button type="button" onClick={installApp}>安装</button>}
          <button type="button" onClick={() => setHistoryOpen(true)}>历史 <i>{history.length}</i></button>
        </div>
      </header>

      {!currentTask && (
        <section className="hero">
          <div className="agent-badge"><span /> AI 电商执行助手</div>
          <h1>告诉我目标，<br /><em>我来拆解执行。</em></h1>
          <p>先帮你建立选品任务、利润条件和执行方案。无需学习复杂工具。</p>
          <div className="capability-row"><span>任务拆解</span><span>利润思路</span><span>执行报告</span></div>
        </section>
      )}

      <TaskProgress task={currentTask} />
      <ExecutionReport report={currentTask?.result} />

      {!currentTask && (
        <section className="examples">
          <small>你可以这样说</small>
          {EXAMPLES.map((example) => (
            <button key={example} type="button" onClick={() => runGoal(example)}>{example}<span>↗</span></button>
          ))}
        </section>
      )}

      {currentTask?.status === TASK_STATUS.SUCCESS && (
        <button className="new-task-button" type="button" onClick={() => { setCurrentTask(null); setGoal(""); }}>＋ 创建新任务</button>
      )}

      <section className="composer-wrap">
        <label htmlFor="goal-input">告诉我你想卖什么？</label>
        <div className="composer">
          <textarea
            id="goal-input"
            rows="2"
            maxLength="300"
            value={goal}
            disabled={running}
            onChange={(event) => setGoal(event.target.value)}
            placeholder="例如：找适合闲鱼卖的高利润小商品"
          />
          <button type="button" disabled={running || !goal.trim()} onClick={() => runGoal()} aria-label="开始执行">
            {running ? <span className="button-loader" /> : "↑"}
          </button>
        </div>
        {inputError && <p className="input-error">{inputError}</p>}
        <p className="local-note">任务记录仅保存在当前手机浏览器</p>
      </section>

      {historyOpen && (
        <HistoryPanel
          history={history}
          onSelect={selectHistory}
          onClose={() => setHistoryOpen(false)}
          onClear={clearHistory}
        />
      )}
    </main>
  );
}
