// aiService — Gemini AI 视觉 + 语言中枢 (S10 视觉 / S11 智能识别)
// 职责：
//   analyzeReceipt()            — 图片 → Base64 → Gemini Vision → 结构化账单（单条）
//   parseVoiceRecord()          — 口语文本 → Gemini Text → 结构化账单（单条）
//   parseNaturalLanguageBatch() — 长文本/多笔流水 → Gemini Text → 结构化账单数组（批量）
//
// 设计约定：
//   - 仅负责 AI 调用，不写 Firestore、不操作 Store
//   - API Key 从 VITE_GEMINI_API_KEY 环境变量读取
//   - 若模型返回不符合预期的 JSON，抛出语义化错误供 UI 层捕获并展示
//   - 两个方法共享同一 ReceiptAnalysisResult 结构（数据契约统一）

import { GoogleGenerativeAI } from '@google/generative-ai'
import type { SystemCategory } from '@/types/Category.types'

// ─────────────────────────────────────────────────────────────
// 环境变量校验（避免无意义的网络请求）
// ─────────────────────────────────────────────────────────────
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY as string | undefined

if (!GEMINI_API_KEY) {
  console.warn(
    '[aiService] 缺少 VITE_GEMINI_API_KEY 环境变量。',
    '请在 .env.local 中添加：VITE_GEMINI_API_KEY=your_key_here',
  )
}

// ─────────────────────────────────────────────────────────────
// SDK 初始化（lazy-safe：API key 缺失时也不会 throw，调用时才报错）
// ─────────────────────────────────────────────────────────────
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY ?? '')

/**
 * 模型版本：gemini-2.5-flash（S10 基准线，最低可用版本底线）
 *
 * 选型理由：
 *   - 多模态视觉能力强（可直接理解中英混排小票图片）
 *   - 响应速度快（P90 约 3-6s，满足前端交互要求）
 *   - 成本低（适合高频 OCR 场景，每次约 $0.0001）
 *
 * ⚠️ 版本治理红线（见 docs/04_AI_GOVERNANCE.md R9）：
 *   - 禁止回退至 1.0 / 1.5 系列（API 端点停用，导致 404）
 *   - 未来升级至 3.x+ 时，只需修改此处 model 字段，并同步更新治理文档
 */
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })

// ─────────────────────────────────────────────────────────────
// 返回类型：Gemini 解析结果
// ─────────────────────────────────────────────────────────────
export interface ReceiptAnalysisResult {
  /** 账单金额（正数，人民币） */
  amount:   number
  /** 最匹配的一级分类（严格限定在 SystemCategory 范围内） */
  category: SystemCategory
  /** 账单日期，YYYY-MM-DD 格式 */
  date:     string
  /** 提取的商品名或商家名（简短描述） */
  notes:    string
}

// ─────────────────────────────────────────────────────────────
// 今天日期字符串（作为模型 Prompt 的默认日期参考）
// ─────────────────────────────────────────────────────────────
function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ─────────────────────────────────────────────────────────────
// 共享工具：JSON 输出格式约束说明（两个 Prompt 复用）
// ─────────────────────────────────────────────────────────────
function jsonOutputRules(): string {
  return `⚠️ 输出格式要求（极度重要）：
- 只返回一个纯 JSON 对象，绝对不要包含 Markdown 代码块标记（如 \`\`\`json）
- 不要在 JSON 前后加任何说明文字
- 直接输出 { ... } 即可

JSON 字段规则：
{
  "amount": 数字（金额，正数，不含货币符号，如 38.5）。手写数字识别规则：零=0、一/壹=1、二/两/贰=2、三/叁=3、四/肆=4、五/伍=5、六/陆=6、七/柒=7、八/捌=8、九/玖=9、十=10、百=100、千=1000。**此字段必填，绝不能为 null 或 0**，
  "currency": "CNY",
  "category": "从以下选项中选择最匹配的一个（只能选这些，不能创造新值）：餐饮、交通、购物、娱乐、医疗、居住、教育、工资、副业收入、理财收益、转账、未分类",
  "date": "日期，严格使用 YYYY-MM-DD 格式。若无明确日期则使用今天：${todayStr()}",
  "notes": "简洁精准的描述（不超过20字，直接提取图中的消费品名/商家名/活动名，如"星巴克拿铁"、"滴滴打车"、"超市购物"）"
}

分类选择参考：
- 餐饮：餐厅、外卖、咖啡、奶茶、超市食品、吃饭
- 交通：地铁、公交、打车、加油、停车、滴滴
- 购物：服装、电子产品、日用品、网购、超市日用
- 娱乐：电影、KTV、游戏、健身、旅游
- 医疗：药店、医院、诊所
- 居住：房租、水电、物业
- 教育：书籍、课程、培训`
}

// ─────────────────────────────────────────────────────────────
// Prompt A — 视觉小票解析（图片模态）
// ─────────────────────────────────────────────────────────────
// 设计原则：
//   1. 超级 OCR 模式：手写潦草字专项激活，明确要求推断而非放弃
//   2. 角色扮演 → 提升分类精准度
//   3. 穷举合法分类 → 杜绝模型"发明"新分类
//   4. 强调"纯 JSON 无 Markdown" → 避免 ```json 包裹导致解析失败
//   5. 提供今天日期作为 fallback → 防止无日期小票返回 null
//   6. 杂质过滤指引 → 忽略纸张边缘/背景/人影等无关内容
// ─────────────────────────────────────────────────────────────
function buildPrompt(): string {
  return `你是一位顶级的财务 OCR 专家，具备超强的手写文字识别能力，专门从各类账单、小票、手写记账本图片中提取关键财务信息。

## 🔍 超级 OCR 模式（最高优先级）

**你必须执行以下 OCR 策略，无论图像质量如何：**

1. **强制推断手写潦草字**：即使图像中的文字是极其潦草、连笔、歪斜、模糊的手写草稿，你也必须优先尝试光学字符识别（OCR）。绝对不能因为"字迹不清楚"就放弃识别——要根据上下文（数字大小、常见消费品名称、金额范围）进行合理推断，给出你认为最可能的答案。

2. **提取所有行，绝不丢弃**：图片中有几行记录就提取几行，不要只取第一行或最大金额的那行。每一行独立的"描述 + 金额"组合都是一条独立记录。

3. **聚焦数字与消费内容**：重点扫描图像中所有看起来像"金额数字"（含¥、元、块等货币符号周围的数字）或"消费描述"（商品名、商家名、消费类目）的区域，哪怕字迹潦草也要尝试识别。

4. **自动过滤干扰因素**：主动忽略以下内容：纸张边缘、折痕、阴影、手指、水印、背景花纹、模糊的非财务文字。只关注与金额和消费描述直接相关的内容。

5. **多候选推断**：如果某个字符有歧义（例如"8"和"6"形状相似），请结合周围数字的语境（如常见消费金额范围）选择最合理的判断。

6. **手写特征识别**：中国用户手写记账时常见格式包括：
   - 表格式多行记账本：每行"描述 金额"或"金额 描述"
   - "XXX 元 / XX.X" 的金额写法
   - "吃饭/打车/买X" 等口语化描述
   - 日期格式如"X月X日"、"X/X"

## 📋 你的任务

分析这张图片，识别**所有**可见的消费记录（不论几条），每条记录单独提取，并以 JSON **数组**格式一次性返回全部结果。

⚠️ 输出格式要求（极度重要，严格遵守）：
- 只返回一个 JSON **数组** [ {...}, {...}, ... ]
- 即使只识别到 1 条记录，也必须以数组形式返回：[{...}]
- 绝对不要包含 Markdown 代码块标记（如 \`\`\`json）
- 不要在数组前后加任何说明文字，直接输出 [ ... ]

每条记录的 JSON 字段：
{
  "amount": 数字（金额，正数，不含货币符号，如 38.5）。手写汉字数字转换：零→0、十→10、百→100、千→1000，"三十五"→35，"两百"→200。**此字段必填，绝不能为 null 或 0**，
  "category": "从以下选项中选择最匹配的一个（只能选这些）：餐饮、交通、购物、娱乐、医疗、居住、教育、工资、副业收入、理财收益、转账、未分类",
  "date": "日期，严格使用 YYYY-MM-DD 格式。若无明确日期则使用今天：${todayStr()}",
  "notes": "简洁精准的描述，直接来自图片中该行的文字内容（不超过20字）"
}

分类参考：餐饮=吃饭/外卖/咖啡，交通=打车/地铁/加油，购物=超市/网购/服装，娱乐=电影/游戏/健身，医疗=药/医院，居住=房租/水电，教育=书/课程

## ⚡ 最终指令

**即使你对某个字段不完全确定，也必须给出你最佳推断的答案，绝不能返回空数组。** 图片中有几行就返回几条，你的完整提取能力是这个系统的核心价值所在。

现在请分析图片并直接返回 JSON 数组：`
}

// ─────────────────────────────────────────────────────────────
// Prompt B — 语音口语解析（纯文本模态，S11）
// ─────────────────────────────────────────────────────────────
// 与 Prompt A 的核心区别：
//   1. 输入是口语化的中文自然语言（非图片），理解相对时间表达
//   2. 明确告知今日日期，帮助模型推算"昨天""上周"等相对时间
//   3. 金额理解：支持汉字数字（"三十五" → 35，"两百" → 200）
//   4. 对"我昨天花了XX元""刚刚在XX买了"等口语句式鲁棒
// ─────────────────────────────────────────────────────────────
function buildVoicePrompt(text: string): string {
  // 计算常用相对日期，辅助模型推断（减少模型推理负担）
  const today     = new Date()
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1)
  const dayBefore = new Date(today); dayBefore.setDate(today.getDate() - 2)

  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`

  return `你是一位智能记账助手，专门从用户口语化的语音转写文字中提取财务记账信息。

用户说的话（已经过语音转文字处理，可能有口语化表达）：
「${text}」

日期参考（帮助理解相对时间表达）：
- 今天   = ${fmt(today)}
- 昨天   = ${fmt(yesterday)}
- 前天   = ${fmt(dayBefore)}
- 若用户说"刚刚/刚才/今天/今日"或未提及时间 → 使用今天日期
- 若用户说"上周X" → 请自行推算上周对应星期的日期

金额理解规则：
- 汉字数字需转换：三十五→35，两百→200，一百零八→108，千五→1500
- 若口述含小数（"五块八"）→ amount=5.8
- 忽略货币单位（元/块/钱），只提取数字

${jsonOutputRules()}

现在请分析用户说的话并直接返回 JSON：`
}

// ─────────────────────────────────────────────────────────────
// 内部工具：将 Gemini 图片识别原始文本解析为 ReceiptAnalysisResult[]
// 专为 analyzeReceipt 使用（数组格式，与 parseGeminiJson 单体版平行）
// ─────────────────────────────────────────────────────────────
function parseGeminiJsonArray(rawText: string): ReceiptAnalysisResult[] {
  // 清洗步骤 1：去除 Markdown 代码块
  let cleaned = rawText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()

  // 清洗步骤 2：从文本中提取第一个 [...] 数组块（处理 Gemini 2.5 思考链前缀）
  const arrMatch = cleaned.match(/\[[\s\S]*\]/)
  if (arrMatch) cleaned = arrMatch[0]

  // 尝试解析：若模型意外返回单对象，包裹成数组
  let parsed: unknown[]
  try {
    const raw = JSON.parse(cleaned)
    parsed = Array.isArray(raw) ? raw : [raw]
  } catch {
    console.error('[aiService·image] Gemini 返回了非法 JSON：', rawText)
    throw new Error('AI 返回结果格式异常，请重新拍照或手动录入')
  }

  const VALID_CATEGORIES: SystemCategory[] = [
    '餐饮','交通','购物','娱乐','医疗','居住','教育',
    '工资','副业收入','理财收益','转账','未分类',
  ]
  const today = todayStr()
  const results: ReceiptAnalysisResult[] = []

  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue
    const obj = item as Record<string, unknown>

    const amount = typeof obj.amount === 'number'
      ? obj.amount
      : parseFloat(String(obj.amount ?? '0'))

    // 金额无效的条目跳过（不影响其他条目）
    if (isNaN(amount) || amount <= 0) continue

    const rawCat  = String(obj.category ?? '')
    const category: SystemCategory = VALID_CATEGORIES.includes(rawCat as SystemCategory)
      ? (rawCat as SystemCategory)
      : '未分类'

    const rawDate = String(obj.date ?? '')
    const date    = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : today

    const notes   = String(obj.notes ?? '').slice(0, 50) || category

    results.push({ amount, category, date, notes })
  }

  if (results.length === 0) {
    throw new Error('AI 未能识别出有效金额，请重新拍照或手动录入')
  }

  console.info(`[aiService·image] 从图片中解析出 ${results.length} 条账单`)
  return results
}

// ─────────────────────────────────────────────────────────────
// analyzeReceipt — 核心公开方法（批量版）
//
// @param base64Image  图片的纯 Base64 字符串（不含 data:image/xxx;base64, 前缀）
// @param mimeType     图片 MIME 类型（如 'image/jpeg' / 'image/png'）
// @returns            结构化账单数组（1 张图可返回多条记录）
// @throws             API 调用失败或 JSON 解析失败时抛出带语义的 Error
// ─────────────────────────────────────────────────────────────
export async function analyzeReceipt(
  base64Image: string,
  mimeType    = 'image/jpeg',
): Promise<ReceiptAnalysisResult[]> {

  if (!GEMINI_API_KEY) {
    throw new Error('未配置 VITE_GEMINI_API_KEY，无法调用 AI 功能')
  }

  // ── 构建 Gemini Vision 请求（文本 Prompt + 图片 inlineData）
  const imagePart = {
    inlineData: { data: base64Image, mimeType },
  }

  let rawText = ''
  try {
    const response = await model.generateContent([buildPrompt(), imagePart])
    rawText = response.response.text().trim()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('quota') || msg.includes('429')) {
      throw new Error('AI 请求配额已用完，请稍后再试')
    }
    if (msg.includes('API_KEY') || msg.includes('401') || msg.includes('403')) {
      throw new Error('Gemini API Key 无效或已过期，请检查 .env.local 配置')
    }
    throw new Error(`AI 服务暂时不可用：${msg.slice(0, 80)}`)
  }

  const results = parseGeminiJsonArray(rawText)
  console.info('[aiService·vision] Gemini 批量解析成功：', results)
  return results
}

// ─────────────────────────────────────────────────────────────
// 内部工具：将 Gemini 原始文本解析为 ReceiptAnalysisResult
// analyzeReceipt / parseVoiceRecord 共享此逻辑，避免代码重复
// ─────────────────────────────────────────────────────────────
function parseGeminiJson(
  rawText:    string,
  errorHint:  string,   // 错误提示中指引用户的操作（如"重新拍照"/"重新录音"）
): ReceiptAnalysisResult {

  // 清洗步骤 1：去除 Markdown 代码块
  let cleaned = rawText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()

  // 清洗步骤 2：Gemini 2.5 Flash 有时在 JSON 前输出思考链文本
  // 从文本中提取第一个完整的 { ... } 对象块
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
  if (jsonMatch) cleaned = jsonMatch[0]

  // 解析 JSON
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(cleaned) as Record<string, unknown>
  } catch {
    console.error('[aiService] Gemini 返回了非法 JSON：', rawText)
    throw new Error(`AI 返回结果格式异常，请${errorHint}`)
  }

  // 金额校验
  const amount = typeof parsed.amount === 'number'
    ? parsed.amount
    : parseFloat(String(parsed.amount ?? '0'))

  if (isNaN(amount) || amount <= 0) {
    throw new Error(`AI 未能识别出有效金额，请${errorHint}`)
  }

  // 分类：白名单校验，fallback 到未分类
  const VALID_CATEGORIES: SystemCategory[] = [
    '餐饮','交通','购物','娱乐','医疗','居住','教育',
    '工资','副业收入','理财收益','转账','未分类',
  ]
  const rawCategory = String(parsed.category ?? '')
  const category: SystemCategory = VALID_CATEGORIES.includes(rawCategory as SystemCategory)
    ? (rawCategory as SystemCategory)
    : '未分类'
  if (!VALID_CATEGORIES.includes(rawCategory as SystemCategory)) {
    console.error(`[aiService] 分类 fallback：Gemini 返回 "${rawCategory}"，不在白名单，已替换为"未分类"`)
  }

  // 日期：校验格式，fallback 到今天
  const rawDate  = String(parsed.date ?? '')
  const today    = todayStr()
  const date     = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : today
  if (rawDate && !/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
    console.error(`[aiService] 日期 fallback：Gemini 返回 "${rawDate}"，格式不符 YYYY-MM-DD，已替换为 ${today}`)
  }

  const rawNotes = String(parsed.notes ?? '').slice(0, 50)
  if (!rawNotes) {
    console.warn(`[aiService] 说明字段为空，已 fallback 到分类名 "${category}"`)
  }
  const notes = rawNotes || category

  console.info('[aiService] 解析结果：', { amount, category, date, notes })
  return { amount, category, date, notes }
}

// ─────────────────────────────────────────────────────────────
// parseVoiceRecord — 口语语音转写文本 → 结构化账单 (S11)
//
// 调用路径：浏览器 SpeechRecognition → 转写文本 → 此方法 → ReceiptAnalysisResult
// 与 analyzeReceipt 的区别：输入为纯文本（不含图片 inlineData），
// Prompt 针对口语中文优化（相对时间 / 汉字数字 / 口语句式）
//
// @param text    SpeechRecognition 识别到的最终文本字符串
// @returns       结构化账单（与视觉解析共享相同数据结构）
// @throws        API 失败或 JSON 解析失败时抛出带语义的 Error
// ─────────────────────────────────────────────────────────────
export async function parseVoiceRecord(text: string): Promise<ReceiptAnalysisResult> {

  if (!GEMINI_API_KEY) {
    throw new Error('未配置 VITE_GEMINI_API_KEY，无法调用 AI 功能')
  }

  if (!text.trim()) {
    throw new Error('未检测到有效语音内容，请重新说话')
  }

  // 纯文本请求（无图片 Part）
  let rawText = ''
  try {
    const response = await model.generateContent(buildVoicePrompt(text))
    rawText = response.response.text().trim()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('quota') || msg.includes('429')) {
      throw new Error('AI 请求配额已用完，请稍后再试')
    }
    if (msg.includes('API_KEY') || msg.includes('401') || msg.includes('403')) {
      throw new Error('Gemini API Key 无效或已过期，请检查 .env.local 配置')
    }
    throw new Error(`AI 服务暂时不可用：${msg.slice(0, 80)}`)
  }

  const result = parseGeminiJson(rawText, '重新录音或手动录入')
  console.info('[aiService·voice] Gemini 语音解析成功：', { input: text, result })
  return result
}

// ─────────────────────────────────────────────────────────────
// Prompt C — 长文本批量记账解析（S11 智能识别）
// ─────────────────────────────────────────────────────────────
// 与 Prompt B（单条语音）的核心区别：
//   1. 输入可能包含多笔消费记录（最多几十条）
//   2. 返回 JSON 数组 而非单个对象
//   3. 明确要求逐条剥离，即使格式混杂（口语/账单截图粘贴/表格文字）
//   4. 给出"一句话多条"的识别指引
// ─────────────────────────────────────────────────────────────
function buildBatchPrompt(text: string): string {
  const today     = new Date()
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1)
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`

  return `你是一位专业的智能记账助手，擅长从各种格式的文本中批量提取多笔消费记录。

用户输入的文本（可能是口语流水账、粘贴的消费记录、聊天记录截图文字等）：
「${text}」

日期参考：今天=${fmt(today)}，昨天=${fmt(yesterday)}

你的任务：
1. 识别文本中的每一笔独立消费记录（一句话可能包含多笔）
2. 每笔记录提取：金额、最合适的分类、日期、简短描述
3. 将所有识别到的记录整理为一个 JSON 数组返回

⚠️ 输出格式要求（极度重要）：
- 只返回一个 JSON 数组，如 [ {...}, {...} ]
- 绝对不要包含 Markdown 代码块标记（如 \`\`\`json）
- 不要加任何说明文字，直接输出 [ ... ]
- 若文本中没有任何可识别的消费记录，返回空数组 []

每条记录的字段规则：
{
  "amount": 数字（正数，汉字数字需转换：三十五→35，两百→200，千五→1500），
  "category": "只能从以下选项选择：餐饮、交通、购物、娱乐、医疗、居住、教育、工资、副业收入、理财收益、转账、未分类",
  "date": "YYYY-MM-DD 格式。相对日期（昨天/上周/本月X号）请换算为具体日期。无法确定则用今天：${fmt(today)}",
  "notes": "简洁描述（不超过20字）"
}

分类参考：餐饮=吃饭/外卖/咖啡，交通=打车/地铁/加油，购物=网购/超市/服装，娱乐=电影/游戏/健身，医疗=药/医院，居住=房租/水电，教育=课程/书

示例：
输入：「昨天打车35，中午外卖28.5，下午买了杯奶茶20」
输出：[{"amount":35,"category":"交通","date":"${fmt(yesterday)}","notes":"打车"},{"amount":28.5,"category":"餐饮","date":"${fmt(yesterday)}","notes":"外卖"},{"amount":20,"category":"餐饮","date":"${fmt(yesterday)}","notes":"奶茶"}]

现在请分析用户文本并直接返回 JSON 数组：`
}

// ─────────────────────────────────────────────────────────────
// parseNaturalLanguageBatch — 长文本 → 多条结构化账单数组（S11）
//
// 调用路径：textarea 输入 / 语音连续拼接文本 → 此方法 → ReceiptAnalysisResult[]
// 支持场景：
//   - 口语连珠炮（"昨天打车35，吃饭80，今天买书150"）
//   - 粘贴的微信/支付宝流水截图文字
//   - 400字以上的长段复杂账单
//
// @param text    用户输入的长文本（无长度上限）
// @returns       账单数组（可能为空数组，表示文本中无可识别记录）
// @throws        API 调用失败时抛出语义错误；JSON 解析失败时返回空数组（降级）
// ─────────────────────────────────────────────────────────────
export async function parseNaturalLanguageBatch(
  text: string,
): Promise<ReceiptAnalysisResult[]> {

  if (!GEMINI_API_KEY) {
    throw new Error('未配置 VITE_GEMINI_API_KEY，无法调用 AI 功能')
  }

  const trimmed = text.trim()
  if (!trimmed) {
    throw new Error('文本内容为空，请输入消费记录')
  }

  // ── 调用 Gemini（纯文本，无图片 Part）
  let rawText = ''
  try {
    const response = await model.generateContent(buildBatchPrompt(trimmed))
    rawText = response.response.text().trim()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('quota') || msg.includes('429')) {
      throw new Error('AI 请求配额已用完，请稍后再试')
    }
    if (msg.includes('API_KEY') || msg.includes('401') || msg.includes('403')) {
      throw new Error('Gemini API Key 无效或已过期，请检查 .env.local 配置')
    }
    throw new Error(`AI 服务暂时不可用：${msg.slice(0, 80)}`)
  }

  // ── 清洗步骤 1：去除 Markdown 代码块
  let cleaned = rawText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()

  // ── 清洗步骤 2：从文本中提取第一个 [...] 数组块（处理思考链前缀）
  const arrMatch = cleaned.match(/\[[\s\S]*\]/)
  if (arrMatch) cleaned = arrMatch[0]

  // ── 解析 JSON 数组
  let parsed: unknown[]
  try {
    const raw = JSON.parse(cleaned)
    // 兼容模型偶尔返回单对象而非数组的情况
    parsed = Array.isArray(raw) ? raw : [raw]
  } catch {
    console.error('[aiService·batch] Gemini 返回了非法 JSON：', rawText)
    // 批量场景：JSON 解析失败降级为空数组，不抛出（让 UI 显示"未识别到记录"）
    return []
  }

  // ── 逐条校验，过滤无效条目
  const VALID_CATEGORIES: SystemCategory[] = [
    '餐饮','交通','购物','娱乐','医疗','居住','教育',
    '工资','副业收入','理财收益','转账','未分类',
  ]
  const today = todayStr()

  const results: ReceiptAnalysisResult[] = []

  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue
    const obj = item as Record<string, unknown>

    const amount = typeof obj.amount === 'number'
      ? obj.amount
      : parseFloat(String(obj.amount ?? '0'))

    // 金额无效的条目直接跳过（不影响其他条目）
    if (isNaN(amount) || amount <= 0) continue

    const rawCat  = String(obj.category ?? '未分类')
    const category: SystemCategory = VALID_CATEGORIES.includes(rawCat as SystemCategory)
      ? (rawCat as SystemCategory)
      : '未分类'

    const rawDate = String(obj.date ?? '')
    const date    = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : today

    const notes = String(obj.notes ?? '').slice(0, 50) || category

    results.push({ amount, category, date, notes })
  }

  console.info(`[aiService·batch] 从 ${trimmed.length} 字文本中解析出 ${results.length} 条账单`)
  return results
}

// ─────────────────────────────────────────────────────────────
// mapCategoryBatch — 批量 AI 分类映射（ImportModal 本地解析兜底）
//
// 用途：当本地关键词表（mapCategory）返回"未分类"时，
//   批量发送原始描述给 Gemini，一次请求覆盖所有未命中条目。
//
// 设计原则：
//   · 失败时静默降级（返回空 Map），不抛出错误——调用方保持"未分类"即可
//   · 一次批量请求，不为每条单独调用（节省配额）
//
// @param items  需要映射的条目数组（id + 描述文本）
// @returns      id → SystemCategory 的 Map（未找到的 id 不在 Map 中）
// ─────────────────────────────────────────────────────────────
export async function mapCategoryBatch(
  items: Array<{ id: string; description: string }>,
): Promise<Map<string, SystemCategory>> {

  // 无 API Key 或无数据时，直接返回空 Map
  if (!GEMINI_API_KEY || items.length === 0) return new Map()

  // 所有合法的一级分类
  const VALID: SystemCategory[] = [
    '餐饮', '交通', '购物', '娱乐', '医疗', '居住', '教育',
    '工资', '副业收入', '理财收益', '转账', '未分类',
  ]

  const prompt = `你是一个账单分类助手。将每条账单描述映射到最匹配的标准分类。

标准分类（只能从以下选项中选一个，不得创造新值）：
${VALID.filter(c => c !== '未分类').join('、')}、未分类

输入（JSON 数组，每条含 id 和 description）：
${JSON.stringify(items)}

输出要求：
- 只返回纯 JSON 数组，绝不使用 Markdown 代码块（如 \`\`\`json）
- 格式：[{"id":"xxx","category":"餐饮"},{"id":"yyy","category":"交通"},...]
- 每个 id 必须与输入中的 id 对应，category 必须从标准分类中选取`

  try {
    const resp   = await model.generateContent(prompt)
    const raw    = resp.response.text().trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim()
    const parsed = JSON.parse(raw) as Array<{ id: string; category: string }>
    const result = new Map<string, SystemCategory>()
    for (const { id, category } of parsed) {
      result.set(
        id,
        VALID.includes(category as SystemCategory)
          ? (category as SystemCategory)
          : '未分类',
      )
    }
    console.info(`[aiService·mapCategoryBatch] AI 映射了 ${result.size} 个分类`)
    return result
  } catch (err) {
    // 静默降级：分类映射失败不阻断导入流程
    console.warn('[aiService·mapCategoryBatch] AI 分类映射失败，降级为"未分类":', err)
    return new Map()
  }
}
