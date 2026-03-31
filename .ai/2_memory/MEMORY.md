# MEMORY.md — 全局上下文长期记忆
> 跨会话持久化。记录已确定的决策和背景，每次对话开始前读取，避免重复解释。

---

## 项目基本信息
- **项目名称**：RMM V3 — 个人资金管理系统第三版
- **开发者**：单人开发
- **立项日期**：2026年3月31日
- **目标用户**：个人用户，管理微信/支付宝/银行多渠道账单

## 为什么做 V3（不要问了，记住它）
V1/V2 已验证了核心需求（账单导入、手动记账、分类统计），但代码无类型注解、架构混乱、难以维护。
V3 目标：**用正确的架构从零重写**，支持多账单来源、自动分类、数据可视化，为后续扩展留空间。

---

## 技术决策日志（已锁定，不再讨论）

| 决策 | 选择 | 锁定原因 |
|------|------|----------|
| 构建工具 | Vite | 比 CRA 快，配置更灵活 |
| 前端框架 | React 18 + TypeScript | 类型安全，生态完善 |
| 样式方案 | Tailwind CSS | 快速构建，无需维护 CSS 文件 |
| 后端 | Firebase | 零运维，快速验证，BaaS 方案 |
| 状态管理 | Zustand | 轻量，比 Redux 简洁 |
| 路由 | React Router v6 | 社区标准 |
| 旧代码 | **禁止复制 V2 代码** | V2 无类型，直接污染 V3 |

---

## 命名规范（全局统一）

| 类型 | 规范 | 示例 |
|------|------|------|
| React 组件文件 | PascalCase + `.tsx` | `BillList.tsx` |
| Hook 文件 | `use` 前缀 + camelCase + `.ts` | `useBills.ts` |
| Service 文件 | camelCase + `Service` 后缀 + `.ts` | `billService.ts` |
| 工具函数文件 | camelCase + `Utils` 后缀 + `.ts` | `dateUtils.ts` |
| 类型定义文件 | PascalCase + `.types.ts` | `Transaction.types.ts` |
| 常量文件 | SCREAMING_SNAKE + `.constants.ts` | `CATEGORIES.constants.ts` |
| Firestore 集合 | 小写复数英文 | `transactions`, `categories` |

---

## Firestore 数据路径结构

```
users/
  {userId}/
    transactions/   ← 所有账单记录
    categories/     ← 用户自定义分类
    settings/       ← 用户偏好设置
```

---

## 里程碑完成记录

- [x] S0 — AI 治理矩阵初始化（2026-03-31）
- [ ] S1 — Vite 项目初始化 + Firebase 接入
- [ ] S2 — 用户认证（登录/注册/路由守卫）
- [ ] S3 — 数据模型与 Firestore 结构
- [ ] S4 — 账单解析引擎（微信/支付宝 CSV）
- [ ] S5 — 手动记账功能
- [ ] S6 — 统计与图表
- [ ] S7 — 分类管理
- [ ] S8 — 数据导出
- [ ] S9 — 性能优化与 Firebase Hosting 部署
