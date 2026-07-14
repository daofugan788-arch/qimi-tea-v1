import assert from "node:assert/strict";
import { AgentCore } from "../js/agent/AgentCore.js";
import { AgentExecutor, ExecutorStatus } from "../js/agent/AgentExecutor.js";
import { IntentRouter, IntentRouterStatus } from "../js/agent/IntentRouter.js";
import { AutomationEngine } from "../js/automation/AutomationEngine.js";
import { AutomationRepository } from "../js/automation/AutomationRepository.js";
import { EchoTool } from "../js/tools/examples/EchoTool.js";

class MemoryStorage {
  constructor() { this.data = new Map(); }
  getItem(key) { return this.data.get(key) || null; }
  setItem(key, value) { this.data.set(key, value); }
  removeItem(key) { this.data.delete(key); }
}

// 自定义规则验证：用户输入 -> IntentRouter -> AgentCore Task -> Executor -> EchoTool。
const agentCore = new AgentCore();
const executor = new AgentExecutor({ getTask: (taskId) => agentCore.getTask(taskId) });
executor.registerTool("echo", new EchoTool());
const router = new IntentRouter({
  agentCore,
  executor,
  useDefaultRules: false,
  rules: [{
    id: "test-echo",
    intent: "echo_text",
    toolName: "echo",
    description: "测试回显意图",
    priority: 10,
    patterns: [/^(?:请)?回显\s*(.+)$/i],
    extractParams: ({ match }) => ({ text: match[1].trim() }),
  }],
});

const recognized = router.recognize("请回显 暮曦 Intent Router");
assert.equal(recognized.matched, true);
assert.equal(recognized.intent, "echo_text");
assert.equal(recognized.taskType, "echo");
assert.deepEqual(recognized.params, { text: "暮曦 Intent Router" });

const dispatched = await router.dispatch("请回显 暮曦 Intent Router");
assert.equal(dispatched.status, IntentRouterStatus.SUCCESS);
assert.equal(dispatched.task.kind, "echo");
assert.equal(dispatched.task.status, "completed");
assert.equal(dispatched.execution.status, ExecutorStatus.SUCCESS);
assert.equal(dispatched.execution.output.text, "暮曦 Intent Router");
assert.equal(agentCore.getTask(dispatched.task.id).metadata.routeIntent, "echo_text");

const unmatched = await router.dispatch("这句话没有对应规则");
assert.equal(unmatched.matched, false);
assert.equal(unmatched.status, IntentRouterStatus.UNMATCHED);
assert.equal(unmatched.task, null);
assert.equal(unmatched.execution, null);

// 默认规则验证：只判断任务类型，不调用远程模型。
const defaultCore = new AgentCore();
const defaultExecutor = new AgentExecutor({ getTask: (taskId) => defaultCore.getTask(taskId) });
defaultExecutor.registerTool("automation", () => ({ status: "success", handled: true }));
const defaultRouter = new IntentRouter({ agentCore: defaultCore, executor: defaultExecutor });
const defaultInputs = [
  "打开设置",
  "打开聊天",
  "打开暮曦",
  "复制启动命令",
  "生成启动暮曦的 Termux 命令",
  "查看自动化历史",
  "停止当前任务",
  "清空任务记录",
  "解压最新的暮曦 ZIP",
  "启动暮曦",
  "检查暮曦服务",
  "重启暮曦",
  "部署新版",
];
for (const input of defaultInputs) assert.equal(defaultRouter.recognize(input).taskType, "automation", input);
assert.equal(defaultRouter.recognize("检查暮曦服务").intent, "muxi_service_management");
assert.equal(defaultRouter.recognize("删除下载目录文件").intent, "restricted_automation_request");

// 实际 AutomationEngine 对接验证：复用旧 Parser/Planner/Validator，不改变现有执行链。
const repository = new AutomationRepository({ storage: new MemoryStorage(), key: "test.intent.router" });
const webActions = [];
const automation = new AutomationEngine({
  repository,
  executor: {
    async execute(action) {
      webActions.push(action.type);
      return { status: "completed", message: "网页内动作完成" };
    },
  },
});

const navigationRoute = automation.recognizeIntent("打开设置");
assert.equal(navigationRoute.taskType, "automation");
const navigation = await automation.dispatchIntent("打开设置");
assert.equal(navigation.status, IntentRouterStatus.SUCCESS);
assert.equal(navigation.task.status, "completed");
assert.deepEqual(webActions, ["navigate", "show_message"]);

const confirmation = await automation.dispatchIntent("启动暮曦");
assert.equal(confirmation.status, IntentRouterStatus.WAITING_CONFIRMATION);
assert.equal(confirmation.task.status, "waiting_confirmation");
assert.equal(confirmation.execution, null);
const confirmed = await automation.dispatchIntentTask(confirmation.task.id, { confirmed: true });
assert.equal(confirmed.status, IntentRouterStatus.SUCCESS);
assert.equal(confirmed.task.status, "completed");

const blocked = await automation.dispatchIntent("删除下载目录文件");
assert.equal(blocked.status, IntentRouterStatus.BLOCKED);
assert.equal(blocked.task.status, "blocked");
assert.equal(blocked.execution, null);

console.log(JSON.stringify({
  localRuleRecognition: "passed",
  defaultRuleMatching: `${defaultInputs.length} commands passed`,
  taskTypeRouting: ["echo", "automation"],
  agentCoreIntegration: "passed",
  executorIntegration: "passed",
  parameterExtraction: "passed",
  unmatchedHandling: "passed",
  confirmationFlow: "passed",
  highRiskStillBlocked: true,
  remoteModelUsed: false,
}, null, 2));
