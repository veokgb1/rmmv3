# SKILL_DATA_PARSING.md — 数据解析专用技能
> 处理混乱输入的标准作业流程。遇到任何账单解析任务，必须按此流程执行。

---

## 技能触发条件
当用户提到以下任何一项时，激活此技能：
- "解析账单"、"导入CSV"、"处理微信账单"、"支付宝数据"
- 用户上传了 .csv 或 .xlsx 文件

---

## 第一步：识别来源（Source Detection）

```typescript
// 通过文件头部特征识别账单来源
function detectBillSource(rawContent: string): 'wechat' | 'alipay' | 'unknown' {
  // 微信账单特征：第一行包含"微信支付账单"
  if (rawContent.includes('微信支付账单')) return 'wechat';
  // 支付宝账单特征：第一行包含"支付宝"
  if (rawContent.includes('支付宝')) return 'alipay';
  return 'unknown';
}
```

---

## 第二步：跳过元数据行（Skip Header Lines）

微信账单：前 **16 行** 是说明文字，**第 17 行** 是表头，从**第 18 行** 开始是数据。

支付宝账单：前 **4 行** 是说明文字，**第 5 行** 是表头，从**第 6 行** 开始是数据。

---

## 第三步：字段映射表

### 微信账单字段映射
| 原始字段 | 目标字段 | 处理规则 |
|----------|----------|----------|
| `交易时间` | `date` | 取前10位 `YYYY-MM-DD` |
| `金额(元)` | `amount` | 去掉¥符号，收入为正，支出为负 |
| `交易类型` | `category` | 见分类映射表 |
| `交易对方` | `description` | 直接映射 |
| `商品` | `description` | 与交易对方拼接 |
| `收/支` | - | 决定 amount 正负 |

### 支付宝账单字段映射
| 原始字段 | 目标字段 | 处理规则 |
|----------|----------|----------|
| `交易创建时间` | `date` | 取前10位 |
| `金额` | `amount` | 根据`收/支`字段决定正负 |
| `交易分类` | `category` | 见分类映射表 |
| `交易对方` | `description` | 直接映射 |
| `商品说明` | `description` | 优先使用此字段 |

---

## 第四步：分类关键词映射

```typescript
// 关键词 → 一级分类 映射表
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  '餐饮': ['美团', '饿了么', '麦当劳', '肯德基', '星巴克', '餐厅', '外卖', '食堂'],
  '交通': ['滴滴', '地铁', '公交', '加油', '停车', '高铁', '机票', '打车'],
  '购物': ['淘宝', '京东', '拼多多', '超市', '便利店', '亚马逊'],
  '娱乐': ['爱奇艺', '优酷', '网易云', 'Steam', '游戏', '电影', 'KTV'],
  '医疗': ['医院', '药店', '诊所', '体检'],
  '居住': ['房租', '水费', '电费', '燃气', '物业'],
  '教育': ['学费', '书本', '课程', '培训'],
};

function autoCategory(description: string): string {
  // 遍历关键词映射，返回匹配的分类
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some(kw => description.includes(kw))) {
      return category; // 返回匹配的分类
    }
  }
  return '未分类'; // 无匹配则归入未分类
}
```

---

## 第五步：错误处理规则
- **金额解析失败** → 记录 `amount: null`，标记 `parseError: 'AMOUNT_PARSE_FAILED'`。
- **日期解析失败** → 记录 `date: null`，标记 `parseError: 'DATE_PARSE_FAILED'`。
- **整行解析失败** → 存入 `rawErrors[]` 数组，不丢弃，等待用户手动处理。
- **任何情况下不中断整个导入流程**，失败的行单独收集，成功的行正常入库。
