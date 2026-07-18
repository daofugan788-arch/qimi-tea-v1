# Hammer Commerce Agent V0.2

个人使用的移动端 AI 电商智能体。V0.2 在 V0.1 Agent Core 基础上完成 Sprint 02 商品分析 Agent，让系统具备初步的“赚钱判断能力”。

## V0.2 已完成

- 手机端商品信息输入：名称、采购价、售价、运费、平台费用、备注
- `ProfitCalculatorTool` 利润计算工具
- 毛利润、销售利润、利润率、保本价和建议售价
- 商品 100 分评分
- 评分权重：利润 30%、需求 25%、竞争 20%、售后安全 15%、运输 10%
- 推荐等级：A / B / C / D
- 成本分析、风险判断、销售建议
- 商业分析报告
- Products 本机商品库
- 保留 V0.1 目标任务、Planner、Executor、Tool Registry 和任务历史
- PWA 安装与离线缓存基础

## 商品分析流程

```text
输入商品信息
  → 创建 PRODUCT_ANALYSIS 任务
  → Agent Planner 拆解五个步骤
  → 校验商品数据
  → ProfitCalculatorTool 计算利润
  → ProductScoreTool 五维评分
  → 生成商业分析报告
  → 保存到 Products 商品库
```

## 利润公式

```text
毛利润 = 售价 - 采购价 - 运费
销售利润 = 毛利润 - 平台费用
利润率 = 销售利润 ÷ 售价 × 100%
最低成交价 = 采购价 + 运费 + 平台费用
```

## Products 字段

```text
id
name
cost
price
profit
score
created_time
```

同时保存运费、平台费用、利润率、推荐等级和备注，方便后续数据中心使用。

## 运行与测试

```bash
npm install
npm run dev
npm test
npm run build
```

## 当前边界

需求、竞争、售后和运输评分目前依据商品名称、备注与成本结构进行规则初评，尚未接入实时平台数据。系统会明确提示数据依据，不会虚构销量、货源或市场价格。

本版本不包含自动发布闲鱼、自动登录平台、自动下单、支付、库存或大型后台。
