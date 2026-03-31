# SKILL_DATA_PARSING.md — 混乱输入数据解析标准技能
> 处理微信/支付宝账单的完整标准作业流程（SOP）。
> 遇到任何账单解析任务，必须按此文件的顺序执行，不得跳步。

---

## 技能触发条件

当用户提到以下任意内容时，激活本技能：
- "解析账单"、"导入CSV"、"处理微信账单"、"支付宝数据"
- 上传了 `.csv` 或 `.xlsx` 文件

---

## STEP 1 — 来源识别（Source Detection）

```typescript
// 通过读取文件前100个字符识别账单来源
function detectBillSource(rawContent: string): 'wechat' | 'alipay' | 'unknown' {
  // 微信账单：文件第一行包含"微信支付账单明细"
  if (rawContent.includes('微信支付账单明细')) return 'wechat';
  // 支付宝账单：文件第一行包含"支付宝交易记录明细"
  if (rawContent.includes('支付宝交易记录明细')) return 'alipay';
  // 无法识别来源，提示用户手动选择
  return 'unknown';
}
```

---

## STEP 2 — 元数据行跳过（Skip Header Lines）

账单文件前 N 行是说明文字，**必须跳过**，否则解析出乱码：

| 来源 | 跳过行数 | 真正的表头所在行 | 数据起始行 |
|------|----------|-----------------|-----------|
| 微信 | 跳过前 16 行 | 第 17 行 | 第 18 行起 |
| 支付宝 | 跳过前 4 行 | 第 5 行 | 第 6 行起 |

```typescript
// 按来源跳过元数据行，返回净数据行数组
function skipMetaRows(lines: string[], source: 'wechat' | 'alipay'): string[] {
  const skipCount = source === 'wechat' ? 16 : 4; // 微信跳16行，支付宝跳4行
  return lines.slice(skipCount); // 从表头行开始，第一行即为列名
}
```

---

## STEP 3 — 字段映射（Field Mapping）

### 微信账单列名 → Transaction 字段

```typescript
// 微信账单字段映射函数
function mapWechatRow(row: Record<string, string>): Partial<Transaction> {
  return {
    date: row['交易时间']?.substring(0, 10) ?? null,    // 取前10位得到 YYYY-MM-DD
    amount: parseAmount(row['金额(元)'], row['收/支']), // 去¥符号，收入为正支出为负
    category: mapCategory(row['交易类型'], row['商品']), // 关键词映射分类
    description: `${row['交易对方'] ?? ''} ${row['商品'] ?? ''}`.trim(), // 拼接描述
    source: 'wechat',                                    // 标记来源
    rawData: { ...row },                                 // 完整保留原始数据
  };
}
```

### 支付宝账单列名 → Transaction 字段

```typescript
// 支付宝账单字段映射函数
function mapAlipayRow(row: Record<string, string>): Partial<Transaction> {
  return {
    date: row['交易创建时间']?.substring(0, 10) ?? null,  // 取前10位
    amount: parseAmount(row['金额'], row['收/支']),       // 根据方向决定正负
    category: mapCategory(row['交易分类'], row['商品说明']),
    description: (row['商品说明'] || row['交易对方'] || '').trim(), // 优先商品说明
    source: 'alipay',
    rawData: { ...row },
  };
}
```

---

## STEP 4 — 金额解析（Amount Parser）

```typescript
// 解析金额字符串为数字，根据收支方向决定正负
function parseAmount(rawAmount: string, direction: string): number | null {
  // 去除货币符号和空格，保留数字和小数点
  const cleaned = rawAmount?.replace(/[¥￥$,\s]/g, '');
  const num = parseFloat(cleaned);

  // 解析失败则返回 null，由上层记录 parseError
  if (isNaN(num)) return null;

  // 支出方向返回负数，收入方向返回正数
  return direction?.includes('支出') ? -Math.abs(num) : Math.abs(num);
}
```

---

## STEP 5 — 自动分类（Auto Category）

```typescript
// 关键词 → 一级分类映射表（优先级从上到下）
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  '餐饮': ['美团', '饿了么', '麦当劳', '肯德基', '星巴克', '必胜客', '海底捞', '外卖', '餐厅', '食堂', '奶茶'],
  '交通': ['滴滴', '高德', '地铁', '公交', '加油', '停车', '高铁', '飞机', '机票', '打车', '出行'],
  '购物': ['淘宝', '天猫', '京东', '拼多多', '超市', '便利店', '沃尔玛', '盒马', '亚马逊'],
  '娱乐': ['爱奇艺', '优酷', '腾讯视频', '网易云', 'B站', 'bilibili', 'Steam', '游戏', '电影', 'KTV', '网吧'],
  '医疗': ['医院', '药店', '诊所', '体检', '药房'],
  '居住': ['房租', '水费', '电费', '燃气', '物业', '宽带', '网费'],
  '教育': ['学费', '书本', '课程', '培训', '知乎', '得到', '慕课'],
  '转账': ['转账', '红包'],   // 转账类型特殊处理，不计入支出统计
};

// 根据描述文本自动匹配最可能的一级分类
function mapCategory(typeText: string, descText: string): string {
  const combined = `${typeText ?? ''} ${descText ?? ''}`; // 合并类型和描述
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some(kw => combined.includes(kw))) {
      return category; // 返回第一个匹配的分类
    }
  }
  return '未分类'; // 无匹配关键词，归入未分类
}
```

---

## STEP 6 — 错误处理与收集（Error Collection）

```typescript
// 解析结果汇总结构
interface ParseResult {
  success: Transaction[];           // 解析成功的记录
  errors: { row: number; raw: string; reason: string }[]; // 失败行详情
  duplicates: Transaction[];        // 疑似重复记录
  total: number;                    // 总行数
}
```

**错误处理原则**：
- `amount` 解析失败 → `parseError: 'AMOUNT_PARSE_FAILED'`，仍写入 `success[]`
- `date` 解析失败 → `parseError: 'DATE_PARSE_FAILED'`，仍写入 `success[]`
- 整行 JSON 解析失败 → 存入 `errors[]`，记录行号和原始文本
- **黄金原则：单行失败不中断整批导入，失败行单独收集让用户处理**

---

## STEP 7 — 重复检测（Duplicate Detection）

```typescript
// 基于三元组检测重复：(date, amount, description前20字)
function detectDuplicate(incoming: Transaction, existing: Transaction[]): boolean {
  return existing.some(t =>
    t.date === incoming.date &&           // 同日期
    t.amount === incoming.amount &&       // 同金额
    t.description.substring(0, 20) === incoming.description.substring(0, 20) // 描述相似
  );
  // 注意：只标记 isDuplicate: true，不自动删除，由用户确认
}
```
