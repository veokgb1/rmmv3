# SESSION.md — 当前阶段状态追踪

---

## ✅ S18 — 适老化双轨登录与实时越权阻断（封板）

### S18 完成清单（V3-指令-18，2026-04-02）

- [x] `src/services/authService.ts`：追加邮箱认证方法
  - `loginWithEmail(email, password)` — `signInWithEmailAndPassword`
  - `registerWithEmail(email, password)` — `createUserWithEmailAndPassword`（注册即登录）
- [x] `src/pages/LoginPage.tsx`：双轨登录 UI 全量重写
  - **轨道 A**：Google 弹窗一键登录（原 S16 功能保留）
  - **分隔线**：「──── 或 ────」视觉分隔双轨
  - **轨道 B**：邮箱密码表单
    - `登录 / 注册新账号` 模式 Tab（切换时清空密码，防填错复用）
    - 邮箱输入框、密码输入框（含显示/隐藏眼睛按钮）
    - 注册模式额外展示「确认密码」字段
    - 客户端预校验（格式/长度/一致性）+ Firebase 错误码中文映射（11 种）
  - 外层改为 `overflow-y-auto` 可滚动，防小屏截断
  - 统一 Loading 互斥（Google 与邮箱同一时刻只能一个 in-flight）
- [x] `src/store/ledgerStore.ts`：S18 实时越权阻断版（全量重写）
  - 新增 `EjectionInfo` 类型：`{ ledgerId, ledgerName, ejectedAt }`
  - Store 新增字段：`ejectionInfo: EjectionInfo | null`
  - Store 新增 Action：`setEjectionInfo()` / `clearEjection()`
  - `startLedgerListener` 检测逻辑分两阶段：
    - **首次快照**（`prevLedgers.length === 0`）：静默切换（持久化数据可能已过期）
    - **后续快照**：`prevLedgers` 有 activeLedger 且 `myLedgers` 无此账套 → 越权事件
      1. `setEjectionInfo({ ledgerId, ledgerName, ejectedAt })` — 记录被踢账套名称
      2. 强制 `setActiveLedgerId(myLedgers[0]?.id ?? '')` — 切到第一个合法账套
- [x] `src/components/ledger/EjectionBlocker.tsx`：全屏阻断层（全新文件）
  - `z-[200]`，高于所有业务 Modal（z-50），物理覆盖一切
  - 红色渐变警示头部（警告图标 + 标题 + 副标题）
  - 被踢账套名称 + 精确时间（`toLocaleString('zh-CN')`）
  - 若仍有其他账套：绿色提示"已自动切换至 X 账套"
  - 若无账套剩余：提示创建新账套
  - 唯一出口：「我已知晓，继续使用」→ `clearEjection()` → 阻断层消失
  - 无遮罩点击关闭（`stopPropagation`），彻底阻断穿透操作
- [x] `src/App.tsx`：MainApp 挂载 EjectionBlocker（全局单例，路由树之外）
- [x] TypeScript 零错误（tsc --noEmit 无输出）

**Firebase Console 需额外开启的开关**：
- Authentication → Sign-in method → **电子邮件/密码** → 启用

**越权阻断完整时序**：
```
Owner 在 LedgerManagerModal 移除成员 A
  → Firestore updateDoc(members: filtered)
  → 成员 A 的 onSnapshot 回调触发（实时，约 1-2 秒内）
  → startLedgerListener 检测：prevLedgers 有此账套，myLedgers 无
  → setEjectionInfo({ ledgerName: '全家福', ... })
  → setActiveLedgerId(fallback)
  → EjectionBlocker 渲染全屏红色警告（z-200，无法穿透）
  → 成员 A 点击「我已知晓」→ clearEjection() → 正常使用剩余账套
```

---

## ✅ S17 — 开启协作纪元：账套管理与成员邀请（封板）

### S17 完成清单（V3-指令-17，2026-04-02）

- [x] `src/services/firebase/userService.ts`：用户档案服务（全新文件）
  - `ensureUserProfile(user)`：首次 / 每次登录 setDoc merge:true 同步 `users/{uid}`
    - 首次登录写全量字段（uid/displayName/email/photoURL/createdAt/updatedAt）
    - 后续登录仅更新可变字段（displayName/photoURL/updatedAt）
    - email 统一小写存储，保证邀请查询一致性
  - `findUserByEmail(email)`：查询 `users` where `email ==` 归一化邮箱
    - ⚠️ 需在 Firebase Console 为 `users.email` 添加单字段索引
- [x] `src/services/firebase/ledgerService.ts`：账套 CRUD 服务（全新文件）
  - `createLedger(ownerUid, input)`：addDoc 创建账套，owner 自动写入 members[]
  - `inviteMemberByEmail(ledgerId, email, currentMembers)`：
    - 查邮箱 → 检重 → 覆写 members 数组追加 `{ role: 'editor' }` 新成员
    - 若用户未注册或已是成员，抛出中文友好错误
  - `removeMember(ledgerId, targetUid, currentMembers)`：过滤后覆写 members 数组
  - `updateLedger(ledgerId, patch)`：更新 name/description/currency/isArchived
- [x] `src/components/ledger/LedgerManagerModal.tsx`：账套管理中心（全新文件）
  - 三视图状态机：`list` → `create` | `detail`
  - **list 视图**：所有用户账套，`👑 创建者` / `👤 参与者` 徽标；Owner 点击进入详情
  - **create 视图**：名称 + 三类型卡片选择 + 货币下拉 + 时区下拉 + 描述；一键创建
  - **detail 视图**（Owner Only）：成员列表（角色/加入日期） + ✕移除按钮 + 邀请表单（邮箱输入）
  - onSnapshot 驱动：创建/邀请/移除后 Firestore 推送 → ledgerStore 自动更新 → UI 实时刷新
- [x] `src/store/authStore.ts`：`startAuthListener` 注入 `ensureUserProfile`
  - fire-and-forget：不阻塞 App 启动，profile 同步失败只 warn，不 crash
- [x] `src/pages/SettingsPage.tsx`：全面升级（重写）
  - 真实用户卡片：Google photoURL / 首字母渐变头像 fallback / displayName / email / 已登录徽标
  - 账套管理入口：「🗂️ 账套管理」→ `<LedgerManagerModal>`；展示参与账套数量
  - 退出登录按钮：`logout()` → `onAuthStateChanged(null)` → App 自动跳回 LoginPage
- [x] `src/components/ledger/LedgerSwitcher.tsx`：新增 `onManage?` prop
  - 「管理账套」按钮从 disabled S7 占位 → 真实可点击（齿轮图标 + 调用 `onManage()`）
- [x] `src/pages/HomePage.tsx`：
  - 引入 `LedgerManagerModal`，新增 `managerOpen` 状态
  - `<LedgerSwitcher onManage={() => setManagerOpen(true)} />`
  - 末尾挂载 `<LedgerManagerModal isOpen={managerOpen} onClose={...} />`
- [x] TypeScript 零错误（tsc --noEmit 无输出）

**数据流闭环**：
```
创建账套：createLedger() → Firestore addDoc → onSnapshot → ledgerStore.setLedgers()
          → 列表自动出现（无需手动 reload）

邀请成员：findUserByEmail() → inviteMemberByEmail() → Firestore updateDoc(members[])
          → onSnapshot → ledgerStore → detail 视图成员列表实时刷新

首次登录：onAuthStateChanged → ensureUserProfile() → users/{uid} 写入
          → findUserByEmail() 后续查询可命中
```

**Firestore 数据结构变化**（见下方交付说明）

---

## ✅ S16 — 铸造护城墙：Firebase Auth 真实账号系统（封板）

### S16 完成清单（V3-指令-16，2026-04-02）

- [x] `src/config/firebase.ts`：新增 `getAuth(app)` → 导出 `auth: Auth` 单例
- [x] `src/services/authService.ts`：轻量认证服务（全新文件）
  - `loginWithGoogle()`：`GoogleAuthProvider` + `signInWithPopup`，强制账号选择弹窗
  - `logout()`：`signOut(auth)` 登出
  - `subscribeToAuth(callback)`：封装 `onAuthStateChanged`，供 authStore 统一调用
- [x] `src/store/authStore.ts`：Auth 全局状态机（全新文件）
  - `user: User | null`（来自 Firebase Auth 的真实用户对象）
  - `authReady: boolean`（Firebase SDK 完成持久化登录恢复后置为 true）
  - `startAuthListener()`：建立 onAuthStateChanged 监听，返回 unsubscribe
  - 设计：不使用 persist（Firebase SDK 自行管理 IndexedDB 持久化）
- [x] `src/pages/LoginPage.tsx`：全屏科技感登录页（全新文件）
  - 深色渐变背景（gray-950）+ 多层放射状光晕 + 40px 细网格线装饰
  - 居中卡片：backdrop-blur 毛玻璃 + 渐变 Logo 图标 + "RMM V3" 标题
  - 「使用 Google 账号登录」按钮（白底/Google SVG Logo）
  - 登录中旋转圈 Loading 态 + 失败 Toast 错误展示
  - `getAuthErrorMessage()`：auth/* 错误码友好翻译（8 种常见错误中文映射）
- [x] `src/App.tsx`：Auth 路由状态机（全面重写）
  - `useEffect` 启动 `startAuthListener()`（一次，全局生命周期）
  - `!authReady` → `GlobalLoadingScreen`（旋转圈 + "RMM V3 启动中…"）
  - `authReady && !user` → `LoginPage`（未登录，无任何主应用路由暴露）
  - `authReady && user` → `MainApp`（独立子组件，挂载时才调用 useFirestoreSync）
  - **关键架构**：`MainApp` 独立组件确保 Firestore 监听只在登录后启动
- [x] `src/hooks/useFirestoreSync.ts`：S16 Auth 版
  - 从 `useAuthStore` 读取 `user!.uid`（此 Hook 仅在 MainApp 中运行，uid 必定有效）
  - 将 uid 传给 `startLedgerListener(uid)` — 按用户成员关系过滤账套
- [x] `src/store/ledgerStore.ts`：`startLedgerListener(uid)` 新增 uid 参数
  - 客户端过滤：`allLedgers.filter(l => l.members?.some(m => m.userId === uid))`
  - TODO S17：改为服务端 `collectionGroup('members')` 查询 + Security Rules
- [x] `src/components/input/OmniInputModal.tsx`：废弃 `userId: 'mock-user'`
  - 引入 `useAuthStore`，在 SmartPanel 和手写 Tab 两处读取 `user!.uid`
  - 所有 `addTransaction` / `writeBatch` 写入均携带真实 Firebase Auth UID
- [x] TypeScript 零错误（tsc --noEmit 无输出）

**Auth 状态机完整流程**：
```
页面加载 → authReady=false → GlobalLoadingScreen
          ↓ Firebase SDK 恢复持久化登录（~200-500ms）
          → onAuthStateChanged 触发 → authReady=true
          → user=null → LoginPage
          → user≠null → MainApp → useFirestoreSync(uid) → Firestore 监听建立
用户登出  → onAuthStateChanged(null) → user=null → 自动跳回 LoginPage
```

**Firebase Console 必须操作**（见下方交付说明）

---

## ✅ S13 — 弹窗布局全局架构重构（三段式 Flex，封板）

### S13 完成清单（V3-指令-13，2026-04-02）

- [x] `src/components/input/OmniInputModal.tsx`：彻底抛弃 `overflow-y-auto` 补丁，重构为三段式 Flex 架构
  - **根容器**：`max-h-[90dvh] flex flex-col`（dvh 适配移动浏览器工具栏）
  - **① Header（flex-shrink-0）**：把手 + 标题行 + Tab 切换栏，物理固定，不参与滚动
  - **② Body（flex-1 min-h-0 flex flex-col）**：弹性内容区，各 Tab 内部独立管理滚动
  - **③ Footer（flex-shrink-0）**：操作按钮区，永远悬浮贴底，不被任何内容遮挡
  - 手写 Tab：表单字段 `flex-1 min-h-0 overflow-y-auto` / 保存按钮 `flex-shrink-0` + 阴影分隔
  - 智能 Tab（SmartPanel）：统一根容器 `flex flex-col flex-1 min-h-0`
    - Review 态内部再次三段式：标题 `flex-shrink-0` / 卡片列表 `flex-1 min-h-0 overflow-y-auto` / 双按钮 `flex-shrink-0`
    - 其他态（input/parsing/error）：单一 `flex-1 min-h-0 overflow-y-auto` 弹性滚动区
  - 拍照 Tab（OcrPanel）：统一根容器 `flex flex-col flex-1 min-h-0`，每状态内部均 `flex-1 overflow-y-auto`
  - 移除所有硬编码补丁（`pb-32`、`max-h-[45vh]` 写死高度）
  - 恢复并保证 `🚫 重来` 按钮始终在 `flex-shrink-0` footer 内，物理不可遮挡
  - PC 端：`sm:max-w-lg sm:mx-auto sm:bottom-4 sm:rounded-2xl` 居中悬浮卡片
- [x] TypeScript 零错误（tsc --noEmit 无输出）

**三端走查**：手机竖屏内部滚动 ✓ / 手机横屏受限高度可滚 ✓ / PC 居中悬浮 ✓ / iPhone 安全区兼容 ✓

---

## ✅ S12 — UX 三项精修（语音引擎重构 + 响应式 + 卡片遮挡修复，封板）

### S12 完成清单（V3-指令-12，2026-04-02）

- [x] `src/components/input/OmniInputModal.tsx`：
  - **语音引擎重构**：`continuous = true`（持续录音，不自动打断）；`toggleVoice()` 显式开关（点击开始/再点停止）；`voiceSeconds` 60 秒倒计时 state；`useEffect` 驱动 `setInterval`，`isListening` 变化时启停并重置；归零自动 `recognition.stop()`；按钮内实时显示剩余秒数，`< 10s` 文字变亮黄色警告；旁边提示 `< 10s` 时切换为 `⚠️ 即将自动停止`（红色加粗）
  - **响应式**：弹窗外层 `max-h-[92vh]` → `max-h-[85vh]`，新增 `sm:max-w-lg sm:mx-auto sm:inset-x-0 sm:bottom-4 sm:rounded-2xl`
  - **底部遮挡（临时补丁）**：卡片列表容器追加 `pb-32`（后被 S13 彻底重构替代）

---

## ✅ S11 — 智能识别舱（语音 + 批量文本 + 审核舱 + writeBatch，封板）

### S11 完成清单（V3-指令-11-终极版，2026-04-02）

- [x] `src/services/aiService.ts`：
  - 新增 `parseNaturalLanguageBatch(text)`：返回 `Promise<ReceiptAnalysisResult[]>`
  - `buildBatchPrompt(text)`：多条记录批量提取 Prompt（含 JSON 数组示例、中文数字转换规则）
  - 每条逐项校验（金额无效静默跳过），JSON 解析失败优雅降级返回 `[]`
  - 单对象响应自动包裹为数组
- [x] `src/components/input/OmniInputModal.tsx`：✨ 智能识别 Tab 全面落地
  - **DraftItem** 类型：`{ _id, amount, category, date, notes }`（本地临时 ID 用于 React key）
  - **DraftCard** 子组件：内联可编辑卡片（number/select/date/text 四字段 + 🗑️ 移除按钮）
  - **SmartPanel** 子组件：6 态状态机（input → parsing → review → saving → done / error）
    - input 态：大 textarea + 语音辅助追加 + 示例提示卡 + 「智能提取账单」按钮
    - parsing 态：Gemini 解析中居中 Loading 动画
    - review 态：审核舱 — 绿色标题栏 + 可滚动 DraftCard 列表 + `🚫 重来 / 💾 确认入账` 双按钮
    - saving 态：按钮转为旋转圈 + "写入云端…"
    - done 态：关闭弹窗（onSnapshot 驱动 UI 重绘）
    - error 态：错误信息 + 重新输入
  - **writeBatch** 批量写入：一次 commit 写入多条 Transaction，无手动 Store 操作
  - Web Speech API：`continuous = false` → S12 升级为 `true`
- [x] TypeScript 零错误：自定义 ISpeechRecognition 接口 + ISpeechRecognitionCtor 解决 TS 未内置 Speech API 类型问题
- [x] `src/components/ledger/LedgerSwitcher.tsx`：紧急 Bug 修复
  - 增加 `if (!ledgersReady || !activeLedger)` 早返回骨架屏
  - 彻底修复 Firestore 异步加载时 `Cannot read properties of undefined (reading 'name')` 崩溃

---

## ✅ S10 — AI 视觉引擎接入（Gemini 拍小票，封板）

### S10 完成清单（V3-指令-10，2026-04-01）

- [x] `npm install @google/generative-ai`：Google AI SDK v0.24.1 引入
- [x] `src/services/aiService.ts`：Gemini AI 视觉神经（全新文件）
  - 模型：`gemini-2.5-flash`（视觉 + 速度 + 成本最优均衡点）
  - `analyzeReceipt(base64Image, mimeType)`：图片 → 结构化 `ReceiptAnalysisResult`
  - Prompt Engineering：专业财务助理角色 + R4 分类白名单穷举 + 强制纯 JSON 输出 + todayStr() fallback
  - 防御层：Markdown 代码块自动清洗 + 分类合法性白名单校验 + 金额有效性验证
  - 错误语义化分类：quota / auth / network / JSON 解析 → 各自对应中文用户提示
- [x] `src/components/input/OmniInputModal.tsx`：📸 拍小票 Tab 全面点亮（移除 disabled + 🚧 标记）
  - `OcrPanel` 子组件：5 级状态机（idle → preview → analyzing → done / error）
  - idle：引导上传区（点击选图 / 拍照，input capture="environment"）+ Gemini 功能说明条
  - preview：图片缩略图 + 「让 Gemini 识别」按钮 + 右上角重选入口
  - analyzing：扫描线动画 + 4 条滚动文案（每 1.8s 切换）+ 进度点指示器
  - done：自动切回手写 Tab，表单字段已自动填满（amount / category / date / notes）
  - error：用户可见错误 + 重新识别 / 换图 双入口
  - 魔法时刻：拍照 → 识别 → **切回手写 Tab，表单全自动填满**，用户一键确认即保存
- [x] `tailwind.config.js`：新增 `scanline` 关键帧动画（AI 扫描线效果）
- [x] `src/pages/HomePage.tsx`：OmniInputModal 补传 `showToast` prop（AI 识别成功/失败 Toast 反馈）
- [x] `docs/04_AI_GOVERNANCE.md`：AI 引擎治理文档（全新文件）
  - 确立 `gemini-2.5-flash` 为最低可用版本底线
  - 明确降级熔断红线（禁止回退 1.x 系列）
  - 演进路线（未来平滑升级至 3.x+）
  - 错误码与降级策略完整表格
  - 测试基准（黄金测试用例 4 个场景）
- [x] `.ai/1_harness/RULES.md`：新增 R9 — AI 模型版本治理（摘要条目 + 指向详细文档）
- [x] TypeScript 零错误 + Vite build 成功（3.18s，735 模块）

**单向数据流闭环**（AI 路径）：
```
图片文件 → FileReader → Base64 → Gemini API → JSON → 填表单 → addTransaction → Firestore
→ onSnapshot → billStore → useBills → UI 自动重绘
```

### S10 已知限制（后续迭代）
- 4MB 图片大小限制（Gemini inline data 上限）
- 语音 Tab（🎤）仍为 S11 占位，尚未接入
- AI 识别结果无法二次纠偏至 OCR 工作流（ocrStatus 字段预留，S11+ 实现）

---

## ✅ S9 — CRUD 完整闭环（删除 + 纠偏云端化，封板）

### S9 完成清单（V3-指令-09，2026-04-01）

- [x] `src/services/firebase/billService.ts`：新增 `deleteTransaction(id)` — `deleteDoc` 实现
  - 仅删除 Firestore 文档，不触碰本地 Store，onSnapshot 负责移除 UI 账单行
- [x] `src/hooks/useBills.ts`：`correct()` 升级为 async，返回 `Promise<number>`（matchedCount）
  - 等待 Firestore 写入完成（而非 fire-and-forget），供上层驱动 Loading 态
  - 新增 `deleteOne(id)` — 调用 `deleteTransaction` + 打日志，不改 Store
  - `UseBillsReturn` 接口补充 `deleteOne` 和新签名
- [x] `src/components/ledger/CorrectionPolicyModal.tsx`：Loading 态
  - `onConfirm` 类型升级为 `(policy) => Promise<void>`
  - 内部 `handleConfirm` 变为 async，await 期间显示旋转圈 + "写入云端…"
  - isSubmitting 期间禁止关闭弹窗（防止重复提交）
- [x] `src/pages/HomePage.tsx`：
  - `BillItem` 新增 `onDelete` prop + 内联二次确认 UI（确认删除? ✓ ✗）
  - 🗑️ 删除按钮 hover 可见，红色调，独立于纠偏按钮
  - `handleCorrectionConfirm` 升级为 async，await correct()，retroactive 时弹 Toast 显示更新条数
  - `handleDeleteBill` — 调 `deleteOne` + 成功 Toast "账单已删除"
  - 全局 `Toast` 轻量组件（success / warning / error 三态，3s 自动消失）
- [x] TypeScript 零错误 + Vite build 成功

**铁律坚守**：S9 全程无任何手动 Store 操作，100% 遵循"云端改动 → onSnapshot → Store → UI 重绘"红线。

---

## ✅ 当前阶段：S4 — 账单解析引擎（战略升级版，封板归档）

### S4 基础解析引擎（完成清单）
- [x] `src/types/ParseResult.types.ts`：S4 战略升级版（ParsedTransaction 含三大战略字段）
- [x] `src/services/parsers/parseUtils.ts`：公共工具（mapCategory / parseAmount / parseDate / parseCsvLine / buildRowMap）
- [x] `src/services/parsers/wechatParser.ts`：微信账单解析器（STEP 1-7）
- [x] `src/services/parsers/alipayParser.ts`：支付宝账单解析器（STEP 1-7）
- [x] `src/services/parsers/index.ts`：主入口（detectSource + parseBillText）
- [x] `src/components/import/ImportModal.tsx`：导入弹窗（粘贴→解析→预览三阶段）
- [x] `HomePage.tsx`：导入按钮接入 ImportModal

### S4 战略升级（三大支柱注入，完成清单）
- [x] `src/types/Account.types.ts`：资金账户类型 + `guessAccountId()` 自动推断
- [x] `src/types/Transaction.types.ts`：注入 tags / accountId / sourceType / originalParsedData / isManuallyEdited / ocrStatus / ocrConfidence / ocrDoubtSpans / CorrectionPolicy / CorrectionIntent
- [x] `src/types/ParseResult.types.ts`：ParsedTransaction 同步三大战略字段
- [x] `src/services/parsers/wechatParser.ts`：填充 tags / accountId / sourceType / originalParsedData / ocrConfidence / ocrDoubtSpans
- [x] `src/services/parsers/alipayParser.ts`：同上
- [x] `.ai/4_planning/PLAN.md`：S6 OCR UI 规格 / S7 CorrectionPolicyModal / SX.2 模型中控台适配层 全部更新
- [x] TypeScript 零错误，Vite build 成功（1.14s）

### S4 未完成（等待 Firebase Config）
- [ ] `src/services/firebase/billService.ts`：解析后写入 Firestore
- [ ] 导入弹窗"确认导入"按钮真正入库（当前 disabled）

---

## 🔔 战略备忘（永久保留）

### 备忘 ①：多账套隔离（Multi-Ledger）
系统需支持多账套逻辑隔离，底层已预留 `ledgerId` 字段。
账套：personal / ledger-elderly / mingpao-ca / mingpao-to
切换 UI 在 S7 实现，当前只预留字段。

### 备忘 ②：换皮肤冻结至 SX
全局换皮肤 / 深色模式 / 多主题 → SX 收尾阶段统一实现。

---

## ▶ 当前进行：S7 核心 UI 骨架（Mock 驱动，第一波交付）

### S7 第一波完成清单
- [x] `src/mock/ledgers.mock.ts`：三个预设账套 Mock 数据（personal / mingpao-ca / ledger-elderly）
- [x] `src/components/ledger/LedgerSwitcher.tsx`：账套切换器（下拉菜单 + Toast + 点外关闭）
- [x] `src/components/ledger/CorrectionPolicyModal.tsx`：纠偏策略弹窗（三选一：仅限本次/创建规则/溯及既往）
- [x] `src/pages/HomePage.tsx`：集成 LedgerSwitcher（顶部导航）+ CorrectionPolicyModal（演示入口条 + 账单行 hover 触发）
- [x] TypeScript 零错误，Vite build 1.09s，51 模块通过

### S7 第二波完成清单（逻辑层）
- [x] `npm install zustand`：引入全局状态管理
- [x] `src/mock/transactions.mock.ts`：补齐全部 Transaction 必填字段（ledgerId/tags/accountId/sourceType/createdAt/updatedAt），三账套各分配真实数据
- [x] `src/store/ledgerStore.ts`：账套状态机（persist 持久化 activeLedgerId 至 localStorage）
- [x] `src/store/billStore.ts`：账单状态层（全量存储 + updateOne/batchUpdate/appendTransactions）
- [x] `src/services/correctionService.ts`：纠偏引擎（三策略路由 + 账套安全红线 assertLedgerScope + 数据血缘兼容注释）
- [x] `src/hooks/useLedger.ts`：账套业务 Hook（封装 ledgerStore）
- [x] `src/hooks/useBills.ts`：账单业务 Hook（自动按 activeLedgerId 过滤 + 统计计算 + correct 入口）
- [x] `src/components/ledger/LedgerSwitcher.tsx`：改为直接读写 ledgerStore，移除 Props 依赖
- [x] `src/pages/HomePage.tsx`：全面接入 useBills/useLedger，账套切换 → 数据物理联动
- [x] TypeScript 零错误，Vite build 1.16s，60 模块

### S7 综合封板补丁（V3-指令-03-综合，2026-04-01）
- [x] `src/types/Transaction.types.ts`：注入预支出基因（§3.10）
  - `status: 'expected' | 'cleared' | 'void'`（必填，默认 cleared）
  - `offsetByTxId?: string`（平替/报销轧账关联字段）
- [x] `src/mock/transactions.mock.ts`：所有 20 条记录补齐 `status: 'cleared'`
- [x] `src/pages/HomePage.tsx`：账单视图 Tab 栏（已结清 + 预支出🚧 S9 占位，disabled）
- [x] `.ai/4_planning/PLAN.md`：SX.5 垫资报销与公私隔离审批流规划注入
- [x] TypeScript 零错误（tsc --noEmit）

### S7 待完成（后续波次）
- [ ] `src/services/firebase/correctionService.ts`：S5 接入后写入 Firestore（替换 Mock 打印）
- [ ] Firestore Security Rules：多账套 RBAC 权限规则
- [ ] `LedgerSettingsPage.tsx`：账套管理页面（目前"管理账套"按钮已预留入口）

### ⚠️ S7 RBAC 架构补丁（2026-04-01 注入）
> **架构转变备忘**：已完成从「单用户私有账本」→「多用户共享账套」的底层模型升级。
> 核心变更：`Ledger.ownerUid: string` → `Ledger.members: LedgerMember[]`
>
> **S5 接入 Firebase 时强制约束**：
> - 数据库读写必须兼容成员鉴权逻辑（Security Rules 基于 `members` 数组，非 `ownerUid`）
> - `billService.ts` 写入账单前须调用 `canWrite(ledger, uid)` 验证权限
> - `ledgerService.fetchUserLedgers()` 须通过子集合 `collectionGroup('members').where('userId','==',uid)` 反查用户所属账套
> - 任何跨账套操作须通过 `assertLedgerScope()` 红线守卫

已同步文档：
- [x] `src/types/Ledger.types.ts`：成员集合制类型 + 四个 RBAC 工具函数
- [x] `src/mock/ledgers.mock.ts`：三账套 Mock 数据（含多角色演示）
- [x] `docs/03_FIRESTORE_SCHEMA.md`：Schema 升级至 S8-RBAC-Prep 版本
- [x] `.ai/4_planning/PLAN.md`：新增 S8 协作与权限隔离阶段

---

## ✅ S8 — 全能记账舱与云端写入闭环（封板）

### S8 完成清单（V3-指令-08，2026-04-01）
- [x] `src/services/firebase/billService.ts`：新增 `addTransaction()`（addDoc + serverTimestamp，返回新文档 ID）
- [x] `src/components/input/OmniInputModal.tsx`：底部抽屉全能记账舱
  - 三 Tab：✍️ 手写录入（激活）/ 🎤 语音（S9占位）/ 📸 拍照（S9占位）
  - 手写表单：支出/收入/预支出切换、大字金额输入框、分类 Tag 选择、日期、备注
  - 保存：表单校验（金额>0）→ addTransaction() → 成功关闭（不手动更新 Store，onSnapshot 自动重绘）
  - 提交状态机：idle → saving → success(✅) / error(❌)
- [x] `src/pages/HomePage.tsx`：FAB 悬浮按钮（右下角，bottom-20 避开底部导航）+ OmniInputModal 挂载
- [x] `tailwind.config.js`：新增 `slideUp` 关键帧动画（抽屉滑入效果）
- [x] TypeScript 零错误 + Vite build 3.09s

**单向数据流闭环**：表单保存 → Firestore addDoc → onSnapshot 推送 → billStore 更新 → 看板自动重绘

## ✅ S7 — Firestore 实时联动全面落地（封板）

### S7 实时化完成清单（V3-指令-07，2026-04-01）
- [x] `src/store/ledgerStore.ts`：接入 `onSnapshot(collection('ledgers'))`，废弃 MOCK_LEDGERS
  - 新增 `ledgersReady: boolean`（首次快照到达标志）
  - `startLedgerListener()` 独立函数（避免 Function 类型污染 persist 序列化）
- [x] `src/store/billStore.ts`：接入 `onSnapshot(query('transactions', where('ledgerId','==',id)))`
  - 新增 `billsReady: boolean` / `_listeningLedgerId` 竞态防护
  - `startBillsListener(ledgerId)` 独立函数，切换账套时自动重建监听
  - _allTransactions 从 MOCK_TRANSACTIONS 改为 Firestore 实时推送
- [x] `src/hooks/useFirestoreSync.ts`：全局监听生命周期管理 Hook
  - App 挂载 → 启动 ledgers 监听；activeLedgerId 变化 → 切换 transactions 监听
  - useRef 存储 unsubscribe，不触发重渲染
- [x] `src/hooks/useLedger.ts`：新增 `ledgersReady` 透传
- [x] `src/hooks/useBills.ts`：correct() 接入 Firestore 双写
  - 乐观更新本地 Store → 异步调用 billService.updateTransaction()/batchUpdateTransactions()
  - onSnapshot 确认最终一致性
  - 新增 `billsReady` 透传给 UI 层
- [x] `src/services/firebase/billService.ts`：updateTransaction / batchUpdateTransactions
- [x] `src/components/ui/Skeleton.tsx`：骨架屏组件（Skeleton / StatCardsSkeleton / ChartSkeleton / BillListSkeleton）
- [x] `src/App.tsx`：挂载 `useFirestoreSync()`（全局唯一实例）
- [x] `src/pages/HomePage.tsx`：billsReady 驱动骨架屏 ↔ 真实数据切换

**实时效果**：在 Firebase Console 手动修改任意账单金额 → 前端看板约 1-2 秒内自动跳动更新（无需刷新页面）

## ✅ S5 — Firebase 云端接入（初始同步封板）

### S5 完成清单（V3-指令-05，2026-04-01）
- [x] `npm install firebase`：Firebase SDK v10 引入
- [x] `src/vite-env.d.ts`：补充缺失的 Vite 类型声明（`import.meta.env` 类型支持）
- [x] `src/config/firebase.ts`：Firebase 初始化引擎
  - 6个 `VITE_FIREBASE_*` 环境变量校验（缺失则抛出明确错误）
  - 导出 `db`（Firestore）和 `storage`（Storage）单例
  - 连接就绪日志（绿色标注，含 projectId）
- [x] `src/services/dbSync.ts`：初始数据云端同步服务
  - `pushInitialData()`：3 账套（含 members[]）+ 20 条账单（含 status/tags/accountId 等全字段）
  - 账套：`Promise.all` 并发写入；账单：`writeBatch` 批量原子写入
  - 返回 `SyncResult`（ledgersWritten / transactionsWritten / durationMs）
- [x] `src/pages/HomePage.tsx`：「⚡ 激活云端数据」按钮（状态机驱动，idle→loading→success/error）
  - 成功展开条：显示写入数量 + 耗时 + Firebase Console 导航提示
  - 失败展开条：错误信息 + 常见原因提示
- [x] TypeScript 零错误 + Vite build 2.94s（含 Firebase SDK）

## ✅ S6 — 数据可视化看板（全景封板）

### S6 第二波完成清单（V3-指令-06，2026-04-01）
- [x] `src/components/statistics/StatCards.tsx`：三件套 KPI 卡片（收入/支出/净结余，多货币符号适配）
- [x] `src/components/statistics/BudgetProgressBar.tsx`：月度预算进度条
  - Mock 预算：personal ¥8000 / family ¥5000 / enterprise ¥3000
  - 四色预警：< 60% 绿 → 60-80% 琥珀 → 80-95% 橙 → ≥95% 红色脉冲
  - 80% 警戒线刻度可见，超支显示"超支 ¥XX"
  - 架构备注：预算字段未进入 Firestore Schema，S9 阶段接入 budgets 集合
- [x] `src/components/statistics/ExpenseRankingList.tsx`：支出碎钞机 Top 5
  - 水平进度条（相对于第一名 100%），颜色与 CategoryPieChart 语义一致
  - 前三名奖牌徽章（🥇🥈🥉），类别来源严格限定 SystemCategory 字段
- [x] `src/pages/HomePage.tsx`：统计看板重排为六段结构
  - ① StatCards → ② BudgetProgressBar → ③ MonthlyBarChart → ④ ExpenseRankingList → ⑤ CategoryPieChart → ⑥ 预支出占位
  - 所有组件 props 来自 useBills()/useLedger()，切换账套 → 全部组件瞬时重绘
- [x] TypeScript 零错误 + Vite build 3.12s

### S6 第一波完成清单（V3-指令-04，2026-04-01）
- [x] `npm install recharts`：轻量图表库引入
- [x] `npm install -D @types/node`：修复 vite.config.ts 类型问题（顺带封板历史 Bug）
- [x] `src/hooks/useBills.ts`：新增 `allLedgerBills`（全量账套账单，供图表使用）
- [x] `src/components/statistics/MonthlyBarChart.tsx`：月度收支趋势图（Recharts BarChart，最近 6 月，emerald 收入 + rose 支出）
- [x] `src/components/statistics/CategoryPieChart.tsx`：消费分类环形图（Donut Pie，自定义 Tooltip + Legend，10 色现代色盘）
- [x] `src/pages/HomePage.tsx`：明细/统计双 Tab 切换，图表订阅 ledgerStore，切换账套即重绘
- [x] 顺带修复 3 个历史 Bug：
  - `correctionService.ts`：`assertLedgerScope` 从未被实际调用 → 已在 `applyRetroactiveCorrection` 内注入
  - `User.types.ts`：`uid` 参数未使用 → 改为 `_uid`（约定：前缀 `_` 表示有意忽略）
  - `vite.config.ts`：缺少 `@types/node` → 已补充安装
- [x] TypeScript 零错误 + Vite build 2.80s（709 模块，含 recharts）

## ✅ 历史封板阶段
- S4（战略升级）：三大支柱字段注入 + 治理文档全局对齐（2026-04-01）
- S3：Firestore Schema + 类型体系（ledgerId 预留）
- S2：UI 增强（Clock / Weather / Mock 数据 / 首页精美化）
- S1：Vite 工程骨架
- S0：AI 治理矩阵

## 历史会话摘要
| 会话 | 日期 | 主要工作 |
|------|------|----------|
| #1-2 | 2026-03-31 | 治理矩阵初始化+重建 |
| #3 | 2026-03-31 | S1 前端骨架 |
| #4 | 2026-03-31 | GitHub 推送，S2 规划 |
| #5 | 2026-03-31 | S2 首波：Mock+首页+样式 |
| #6 | 2026-03-31 | S2 第二波：Clock + Weather |
| #7 | 2026-03-31 | S2 封板，S3 数据模型设计 |
| #8 | 2026-04-01 | S4 解析引擎 + ImportModal |
| #9  | 2026-04-01 | S4 战略升级：三大支柱字段注入（Account/Transaction/Parser 全线升级）|
| #10 | 2026-04-01 | 治理全局对齐：三处代码 Bug 修复 + RULES/MEMORY/CONVENTIONS 文档同步 |
| #11 | 2026-04-01 | S7 第一波：LedgerSwitcher + CorrectionPolicyModal + 首页集成 |
| #12 | 2026-04-01 | S7 第二波：Zustand 状态机 + 纠偏引擎 + 账套物理联动 + RBAC 架构补丁（members[]） |
