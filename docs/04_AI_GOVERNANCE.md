# RMMV3AI 引擎治理文档
> 版本：S10-AI-Baseline | 更新日期：2026-04-01
> 适用范围：`src/services/aiService.ts` 及所有未来 AI 服务扩展

---

## 一、背景与定位

RMMV3 自 S10 阶段起接入 **Google Gemini 视觉大模型**，赋能「全能记账舱」的拍照识票功能。
本文档确立 AI 引擎的版本治理规则、降级熔断机制与演进路线图，
确保任何未来的代码重构、Prompt 优化或依赖升级都**不会意外引发能力断崖**。

---

## 二、当前 AI 引擎基准线

| 维度 | 当前值 | 说明 |
|---|---|---|
| **AI 服务提供商** | Google Generative AI | SDK: `@google/generative-ai` |
| **SDK 版本** | `0.24.x` | 通过 `npm install @google/generative-ai` 引入 |
| **部署模型** | `gemini-2.5-flash` | 视觉 + 文本解析最优均衡点（速度 × 能力） |
| **调用入口** | `src/services/aiService.ts` | 全项目唯一 AI 调用层，其他模块禁止直接调用 SDK |
| **API Key 来源** | `VITE_GEMINI_API_KEY` (.env.local) | 禁止硬编码，禁止提交到 Git |

---

## 三、AI 模型版本治理（Model Versioning）

### 3.1 最低可用版本底线（Baseline）

```
最低基准线：gemini-2.5-flash
```

**gemini-2.5-flash 作为基准线的理由**：
- `1.0` / `1.5` 系列在 Google AI Studio 的 API 端点已逐步进入维护期，部分接口返回 404
- `2.5-flash` 具备完整的多模态视觉能力，可稳定处理中英混排小票图片
- 响应速度（P90 约 3-6s）和成本开销（每次调用约 $0.0001）满足前端交互要求

### 3.2 降级熔断规则（严格红线 🚨）

以下操作**绝对禁止**，违反即视为引入破坏性变更：

| 禁止行为 | 原因 |
|---|---|
| 将模型回退至 `gemini-1.0-*` 系列 | API 端点停用，调用必然返回 404 |
| 将模型回退至 `gemini-1.5-*` 系列 | 能力低于当前基准，视觉解析精度下降 |
| 在 `aiService.ts` 之外硬编码模型名称 | 版本管理失控，升级时漏改 |
| 将 `VITE_GEMINI_API_KEY` 提交至 Git | 密钥泄露，Google 会自动吊销 |

> ⚠️ CI 卡口建议（未来接入 GitHub Actions 时）：
> 在 pre-push hook 中 grep `gemini-1\.[0-9]` 字符串，若存在则阻断提交。

### 3.3 平滑演进路线（Future-proof ✅）

鼓励随 Google AI 迭代主动升级，演进原则如下：

```
当前：gemini-2.5-flash
                ↓ 当 Google 发布稳定版时
未来：gemini-3.0-flash / gemini-3.5-flash / ...（版本号持续演进）
```

**升级操作规范**：
1. 仅修改 `src/services/aiService.ts` 第 36 行的 `model` 字段
2. 使用一张标准测试小票（见第五章）验证 JSON 输出格式不变
3. 更新本文档「二、当前 AI 引擎基准线」表格中的「部署模型」行
4. 在 `SESSION.md` 记录版本变更日期

**单一修改点原则**：全项目仅 `aiService.ts` 一处声明模型名称，
其他任何文件均通过调用 `analyzeReceipt()` 接口使用 AI 能力，不关心具体模型版本。

---

## 四、aiService.ts 架构规范

### 4.1 调用层职责边界

```
aiService.ts 负责：
  ✅ Gemini SDK 初始化
  ✅ Prompt Engineering（专业财务助理角色 + 合法分类枚举）
  ✅ Base64 图片传输
  ✅ JSON 解析与字段合法性校验
  ✅ 语义化错误分类（quota / auth / network）

aiService.ts 不负责：
  ❌ Firestore 写入（由 billService.ts 负责）
  ❌ Zustand Store 操作（由 useBills hook 负责）
  ❌ UI 交互（由 OmniInputModal.tsx 负责）
```

### 4.2 Prompt Engineering 红线

当前 Prompt 包含以下约束，**修改时不得破坏**：

1. **合法分类白名单穷举**：防止模型"发明"系统外的分类值
2. **纯 JSON 输出强制**：禁止 Markdown 代码块包裹（否则 `JSON.parse` 失败）
3. **今日日期 fallback**：无日期小票时使用 `todayStr()` 而非返回 `null`
4. **Markdown 清洗层**：即使模型违规输出 ` ```json `，也会自动剥离

### 4.3 返回类型契约（不可缩减）

```typescript
// 此接口是 aiService 与上游调用方的契约
// 任何字段都不得删除，可以扩展但不能破坏
export interface ReceiptAnalysisResult {
  amount:   number         // 正数金额
  category: SystemCategory // 严格限定在 12 个合法分类
  date:     string         // YYYY-MM-DD 格式
  notes:    string         // 商品名/商家名（≤ 50 字符）
}
```

---

## 五、测试基准（Standard Test Receipt）

### 5.1 黄金测试用例

升级模型版本或修改 Prompt 后，必须用以下场景验证：

| 测试场景 | 期望 amount | 期望 category | 期望 date |
|---|---|---|---|
| 星巴克小票（¥38.00，含日期） | `38` | `餐饮` | 正确日期 |
| 滴滴出行截图（¥23.5） | `23.5` | `交通` | 正确日期 |
| 无日期超市小票 | 正确金额 | `购物` | 今天日期 |
| 手写金额（字迹清晰） | 正确金额 | 合理分类 | 正确/今天 |

### 5.2 最佳拍摄建议

> 光线充足 · 小票铺平 · 镜头垂直俯拍 · 字迹清晰
> 图片大小 ≤ 4MB · 支持 JPG / PNG / HEIC

---

## 六、错误码与降级策略

| 错误类型 | 触发条件 | 前端展示 | 运维动作 |
|---|---|---|---|
| `quota` / `429` | API 配额耗尽 | "AI 请求配额已用完，请稍后再试" | 检查 Google AI Studio 用量面板 |
| `API_KEY` / `401` / `403` | Key 无效或过期 | "Gemini API Key 无效，请检查配置" | 重新生成 Key，更新 .env.local |
| JSON 解析失败 | 模型返回非法格式 | "AI 返回结果格式异常，请重新拍照" | 检查 Prompt 是否被意外截断 |
| 网络超时 | 连接失败 | "AI 服务暂时不可用" | 检查网络 / Google AI 服务状态 |
| 金额 ≤ 0 | 模型识别失败 | "AI 未能识别有效金额，请手动录入" | 换一张清晰的图片 |

所有错误均为 **Graceful Degradation**：降级至手动录入，不中断用户操作流程。

---

## 七、文档变更记录

| 日期 | 版本 | 变更内容 |
|---|---|---|
| 2026-04-01 | S10-AI-Baseline | 初始版本，确立 gemini-2.5-flash 基准线与治理规则 |
