// 涉及产品的唯一取数口径：年度回顾、偏差、供应商审计台账都从这份产品目录取。
// 任何不在目录里的产品一律按无效值处理（见 normalizeProductSet / isKnownProduct）。
export const PRODUCT_CATALOG: { code: string; name: string }[] = [
  { code: 'P-A01', name: '氯化钠注射液' },
  { code: 'P-A02', name: '葡萄糖注射液' },
  { code: 'P-B01', name: '注射用头孢曲松钠' },
  { code: 'P-B02', name: '阿莫西林胶囊' },
  { code: 'P-C01', name: '维生素C片' },
]

export const PRODUCT_NAMES: string[] = PRODUCT_CATALOG.map((item) => item.name)

const PRODUCT_BY_NAME: Map<string, string> = new Map(
  PRODUCT_CATALOG.map((item) => [item.name, item.code]),
)

const INVALID_PRODUCT = '无效产品'

// 旧记录里涉及产品可能用「、」「,」「，」「/」「;」「；」分隔，统一拆开。
function splitProducts(raw: string): string[] {
  return raw
    .split(/[、,，/;；\n]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

// 把任意涉及产品文本归一化：全部在目录内 -> 去重后的产品名（按目录顺序）；否则按无效值。
export function normalizeProductSet(raw: unknown): string {
  if (raw === null || raw === undefined) {
    return INVALID_PRODUCT
  }
  const names = splitProducts(String(raw))
  if (names.length === 0) {
    return INVALID_PRODUCT
  }
  const unique = new Set(names)
  // 任何一个产品超出目录范围，整组按无效值
  if (names.some((name) => !PRODUCT_BY_NAME.has(name))) {
    return INVALID_PRODUCT
  }
  return PRODUCT_NAMES.filter((name) => unique.has(name)).join('、')
}

export function isKnownProductSet(value: unknown): boolean {
  const normalized = normalizeProductSet(value)
  return normalized !== INVALID_PRODUCT && splitProducts(normalized).length > 0
}

// 归一化后的「涉及产品」可能是多个产品的串联，拆成目录内的产品名数组；无效值返回空数组。
export function productNamesOf(value: unknown): string[] {
  const normalized = normalizeProductSet(value)
  return normalized === INVALID_PRODUCT ? [] : splitProducts(normalized)
}

export const INVALID_PRODUCT_VALUE = INVALID_PRODUCT
