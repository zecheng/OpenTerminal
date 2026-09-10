import type { Quote, Candle } from "./yahoo.js";

// A 股（沪深京）数据源 —— 东方财富为主 + 腾讯兜底（均免费、无 key）。
//
// 东方财富三个域名职责不同：
//   - push2.eastmoney.com       实时行情（批量 ulist）
//   - push2his.eastmoney.com    历史 K 线（日/周/月/分钟，含复权）
//   - searchapi.eastmoney.com   代码/名称/拼音搜索（独立服务）
//
// ⚠️ push2 / push2his 两个行情域名有 IP 级风控，对连续、无 UA、无 Referer 的
// 快速请求会临时封禁（表现为连接被重置 / 空响应，约几分钟后自动恢复）。因此
// 本模块带浏览器 UA + Referer，并做并发限制 + 请求间隔 + 空响应冷却；同时把
// 腾讯（qt.gtimg.cn 实时 / web.ifzq.gtimg.cn K 线）作为兜底，东财被风控时
// 自动切换，保证终端不中断。搜索域名 searchapi 不受风控影响，无需兜底。

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// ---- 共享限速器：并发限制 + 最小请求间隔（东财/腾讯共用）----

const MAX_CONCURRENT = 3;
const MIN_SPACING_MS = 180;
let active = 0;
let nextSlotAt = 0;
const waiters: Array<() => void> = [];
let cooldownUntil = 0; // 仅作用于东财行情域名

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquire(): Promise<void> {
  if (active >= MAX_CONCURRENT) {
    await new Promise<void>((resolve) => waiters.push(resolve));
  }
  active++;
  const wait = nextSlotAt - Date.now();
  nextSlotAt = Math.max(Date.now(), nextSlotAt) + MIN_SPACING_MS;
  if (wait > 0) await sleep(wait);
}

function release(): void {
  active--;
  waiters.shift()?.();
}

const n = (v: unknown): number | null => {
  if (typeof v === "number" && isFinite(v)) return v;
  if (typeof v === "string") {
    const x = Number(v);
    return isFinite(x) ? x : null;
  }
  return null;
};

// ---- symbol 约定 ----

// 两种合法形态：
//   1. 纯 6 位代码 "600519"（按前缀推断交易所）
//   2. 带市场前缀 "1.000001"（上证指数与深市 000001 平安银行代码冲突时，
//      指数由搜索接口直接用 QuoteID 返回，避免歧义）
export function isChinaSymbol(symbol: string): boolean {
  return /^\d{6}$/.test(symbol) || /^\d\.\d{6}$/.test(symbol);
}

// 从 symbol 提取纯 6 位代码（去掉 "1."/"0." 市场前缀）。
function bareCode(symbol: string): string {
  return symbol.includes(".") ? symbol.split(".")[1] : symbol;
}

function exchangeOf(code: string, market: number): string {
  // 北交所代码 8/4/92 开头，东财统一挂在 0 前缀下，单独标注交易所。
  if (code.startsWith("8") || code.startsWith("4") || code.startsWith("92")) return "BSE";
  return market === 1 ? "SSE" : "SZSE";
}

// ---- 东方财富 ----

const QUOTE_REFERER = "https://quote.eastmoney.com/";

// 东财行情请求：带 UA + Referer + 空响应冷却（cooldown 只针对行情域名）。
async function efetch(url: string, referer = QUOTE_REFERER, cooldown = true): Promise<any> {
  if (cooldown && Date.now() < cooldownUntil) {
    throw new Error("eastmoney rate-limited (cooling down)");
  }
  await acquire();
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json, text/plain, */*", Referer: referer },
    });
    if (!res.ok) throw new Error(`eastmoney ${res.status} for ${url}`);
    const text = await res.text();
    if (!text.trim()) {
      if (cooldown) cooldownUntil = Date.now() + 60_000;
      throw new Error("eastmoney empty response (rate limited)");
    }
    return JSON.parse(text);
  } catch (err) {
    if (cooldown && err instanceof Error && /fetch failed|ECONNRESET|empty response/i.test(err.message)) {
      cooldownUntil = Date.now() + 60_000;
    }
    throw err;
  } finally {
    release();
  }
}

// 东财 secid 规则：沪市 1 前缀、深市/北交所 0 前缀。
function secidFor(symbol: string): string {
  if (symbol.includes(".")) return symbol;
  if (!/^\d{6}$/.test(symbol)) throw new Error(`china: unsupported symbol ${symbol}`);
  const p = symbol[0];
  if (p === "6" || p === "5" || p === "9") return `1.${symbol}`;
  return `0.${symbol}`;
}

// ulist 字段（fltt=2 返回数值）：
//   f2 最新价  f3 涨跌幅%  f4 涨跌额  f5 成交量(手)  f8 换手率%  f9 市盈率(动态)
//   f12 代码  f13 市场(1沪0深)  f14 名称  f15 最高  f16 最低  f17 今开  f18 昨收
//   f20 总市值(元)  f21 流通市值(元)  f23 市净率
async function eastmoneyQuotes(symbols: string[]): Promise<Quote[]> {
  const secids = symbols.map(secidFor).join(",");
  const fields = "f2,f3,f4,f5,f8,f9,f12,f13,f14,f15,f16,f17,f18,f20,f21,f23";
  const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=${encodeURIComponent(secids)}&fields=${fields}`;
  const json = await efetch(url);
  const diff: any[] = json?.data?.diff ?? [];
  return diff
    .filter((d) => d?.f12)
    .map((d) => {
      const vol = n(d.f5);
      return {
        symbol: String(d.f12),
        name: d.f14 ?? null,
        price: n(d.f2),
        change: n(d.f4),
        changePercent: n(d.f3),
        open: n(d.f17),
        high: n(d.f15),
        low: n(d.f16),
        previousClose: n(d.f18),
        bid: null,
        ask: null,
        // 东财成交量单位「手」，×100 转股，与美股 K 线 volume 语义一致。
        volume: vol !== null ? Math.round(vol * 100) : null,
        avgVolume: null,
        marketCap: n(d.f20),
        pe: n(d.f9),
        eps: null,
        dividendYield: null,
        week52High: null,
        week52Low: null,
        beta: null,
        sharesOutstanding: null,
        currency: "CNY",
        exchange: exchangeOf(String(d.f12), Number(d.f13)),
        marketState: null,
        time: null,
        source: "eastmoney",
      };
    });
}

// klt 周期：5/15/60=分钟，101=日，102=周，103=月；fqt=1 前复权（与东财/同花顺
// 默认一致，避免除权跳空干扰技术指标。极端高分红股 MAX 全量范围前复权后早期
// 价格可能为负，属前复权固有特性，非 bug）。
const RANGE_KL: Record<string, { klt: number; days: number }> = {
  "1D": { klt: 5, days: 3 },
  "5D": { klt: 15, days: 10 },
  "1M": { klt: 60, days: 40 },
  "6M": { klt: 101, days: 190 },
  YTD: { klt: 101, days: 260 },
  "1Y": { klt: 101, days: 400 },
  "5Y": { klt: 102, days: 0 },
  MAX: { klt: 103, days: 0 },
};

function begDate(days: number): string {
  if (days <= 0) return "0";
  const d = new Date(Date.now() - days * 86_400_000);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

// klines 每行 "日期,开盘,收盘,最高,最低,成交量,成交额"（f51-f57）。
// 注意字段顺序是 开→收→高→低（不是 OHLC 常规顺序），解析时勿搞混。
function parseChinaTime(s: string): number {
  // 支持三种日期格式：东财 "2026-09-10" / "2026-09-10 09:35"、腾讯分钟线 "202609101450"。
  if (/^\d{12}$/.test(s)) {
    const y = s.slice(0, 4);
    const mo = s.slice(4, 6);
    const d = s.slice(6, 8);
    const h = s.slice(8, 10);
    const mi = s.slice(10, 12);
    return Math.floor(new Date(`${y}-${mo}-${d}T${h}:${mi}:00+08:00`).getTime() / 1000);
  }
  const iso = s.includes(" ") ? `${s.replace(" ", "T")}:00` : `${s}T00:00:00`;
  return Math.floor(new Date(`${iso}+08:00`).getTime() / 1000);
}

async function eastmoneyHistory(symbol: string, rangeKey: string): Promise<Candle[]> {
  const { klt, days } = RANGE_KL[rangeKey] ?? RANGE_KL["6M"];
  const secid = secidFor(symbol);
  const url =
    `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}` +
    `&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57` +
    `&klt=${klt}&fqt=1&beg=${begDate(days)}&end=20500101`;
  const json = await efetch(url);
  const klines: string[] = json?.data?.klines ?? [];
  const candles: Candle[] = [];
  for (const line of klines) {
    const [date, open, close, high, low, volume] = line.split(",");
    const o = Number(open);
    const h = Number(high);
    const l = Number(low);
    const c = Number(close);
    if (!isFinite(o) || !isFinite(h) || !isFinite(l) || !isFinite(c)) continue;
    candles.push({
      time: parseChinaTime(date),
      open: o,
      high: h,
      low: l,
      close: c,
      volume: isFinite(Number(volume)) ? Math.round(Number(volume) * 100) : 0,
    });
  }
  return candles;
}

// ---- 腾讯（兜底）----

const TENCENT_REFERER = "https://gu.qq.com/";

// 腾讯实时行情返回 GBK 编码文本，需用 TextDecoder("gbk") 解码。
async function tencentText(url: string): Promise<string> {
  await acquire();
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Referer: TENCENT_REFERER } });
    if (!res.ok) throw new Error(`tencent ${res.status} for ${url}`);
    return new TextDecoder("gbk").decode(await res.arrayBuffer());
  } finally {
    release();
  }
}

// 腾讯代码前缀：sh 沪市 / sz 深市 / bj 北交所。
function tencentSymbol(symbol: string): string {
  if (symbol.includes(".")) {
    const [mkt, code] = symbol.split(".");
    return mkt === "1" ? `sh${code}` : `sz${code}`;
  }
  const p = symbol[0];
  if (p === "6" || p === "5" || p === "9") return `sh${symbol}`;
  if (p === "8" || p === "4" || symbol.startsWith("92")) return `bj${symbol}`;
  return `sz${symbol}`;
}

// 腾讯实时字段（~ 分隔）：[1]名称 [3]现价 [4]昨收 [5]今开 [6]量(手)
// [31]涨跌额 [32]涨跌幅% [33]最高 [34]最低 [39]市盈率TTM
// [44]总市值(亿) [45]流通市值(亿) [46]市净率
async function tencentQuotes(symbols: string[]): Promise<Quote[]> {
  const out: Quote[] = [];
  const BATCH = 50;
  for (let i = 0; i < symbols.length; i += BATCH) {
    const batch = symbols.slice(i, i + BATCH);
    const text = await tencentText(`https://qt.gtimg.cn/q=${batch.map(tencentSymbol).join(",")}`);
    const byCode = new Map<string, Quote>();
    for (const line of text.split(";")) {
      const m = line.match(/(?:v_)?(sh|sz|bj)(\d{6})="([^"]*)"/);
      if (!m) continue;
      const prefix = m[1];
      const code = m[2];
      const f = m[3].split("~");
      if (f.length < 40) continue;
      const vol = n(f[6]);
      const mktCap = n(f[44]);
      byCode.set(code, {
        symbol: code,
        name: f[1] || null,
        price: n(f[3]),
        change: n(f[31]),
        changePercent: n(f[32]),
        open: n(f[5]),
        high: n(f[33]),
        low: n(f[34]),
        previousClose: n(f[4]),
        bid: null,
        ask: null,
        volume: vol !== null ? Math.round(vol * 100) : null,
        avgVolume: null,
        marketCap: mktCap !== null ? mktCap * 1e8 : null, // 腾讯单位「亿」→ 元
        pe: n(f[39]),
        eps: null,
        dividendYield: null,
        week52High: null,
        week52Low: null,
        beta: null,
        sharesOutstanding: null,
        currency: "CNY",
        exchange: prefix === "sh" ? "SSE" : prefix === "bj" ? "BSE" : "SZSE",
        marketState: null,
        time: null,
        source: "tencent",
      });
    }
    for (const s of batch) {
      const q = byCode.get(bareCode(s));
      if (q) out.push({ ...q, symbol: s });
    }
  }
  return out;
}

// 腾讯 K 线 period：day/week/month/m5/m15/m60；日/周/月用 qfq 前复权。
const TENCENT_PERIOD: Record<string, { period: string; count: number; fq: boolean }> = {
  "1D": { period: "m5", count: 48, fq: false }, // 5 分钟线，一天约 48 根
  "5D": { period: "m15", count: 80, fq: false }, // 15 分钟线，5 天约 80 根
  "1M": { period: "m60", count: 160, fq: false }, // 60 分钟线，40 天约 160 根
  "6M": { period: "day", count: 130, fq: true },
  YTD: { period: "day", count: 200, fq: true },
  "1Y": { period: "day", count: 250, fq: true },
  "5Y": { period: "week", count: 260, fq: true },
  MAX: { period: "month", count: 400, fq: true },
};

async function tencentHistory(symbol: string, rangeKey: string): Promise<Candle[]> {
  const { period, count, fq } = TENCENT_PERIOD[rangeKey] ?? TENCENT_PERIOD["6M"];
  const t = tencentSymbol(symbol);
  // 分钟线走 mkline 接口（fqkline/get 对分钟线返回 bad params）；日/周/月走 fqkline/get。
  // 注意 month 也以 "m" 开头，必须用精确正则区分（m5/m15/m60 才是分钟线）。
  const isMinute = /^m\d+$/.test(period);
  const url = isMinute
    ? `https://ifzq.gtimg.cn/appstock/app/kline/mkline?param=${t},${period},,${count}`
    : `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${t},${period},,,${count}${fq ? ",qfq" : ""}`;
  await acquire();
  let json: any;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Referer: TENCENT_REFERER } });
    if (!res.ok) throw new Error(`tencent ${res.status} for ${url}`);
    json = await res.json();
  } finally {
    release();
  }
  const node = json?.data?.[t] ?? {};
  const rows: any[] = isMinute ? node[period] ?? [] : node[`qfq${period}`] ?? node[period] ?? [];
  const candles: Candle[] = [];
  for (const r of rows) {
    // 每条 [日期, 开盘, 收盘, 最高, 最低, 成交量(手)] —— 顺序同为 开→收→高→低。
    const o = Number(r[1]);
    const h = Number(r[3]);
    const l = Number(r[4]);
    const c = Number(r[2]);
    if (!isFinite(o) || !isFinite(h) || !isFinite(l) || !isFinite(c)) continue;
    candles.push({
      time: parseChinaTime(String(r[0])),
      open: o,
      high: h,
      low: l,
      close: c,
      volume: isFinite(Number(r[5])) ? Math.round(Number(r[5]) * 100) : 0,
    });
  }
  return candles;
}

// ---- 顶层：东财为主，腾讯兜底 ----

export async function quotes(symbols: string[]): Promise<Quote[]> {
  if (symbols.length === 0) return [];
  try {
    return await eastmoneyQuotes(symbols);
  } catch (err) {
    try {
      return await tencentQuotes(symbols);
    } catch {
      throw err;
    }
  }
}

export async function history(symbol: string, rangeKey: string): Promise<Candle[]> {
  try {
    return await eastmoneyHistory(symbol, rangeKey);
  } catch (err) {
    try {
      return await tencentHistory(symbol, rangeKey);
    } catch {
      throw err;
    }
  }
}

// ---- 搜索（东方财富，独立服务，无需兜底）----

export type SearchResult = { symbol: string; name: string; exchange: string; type: string };

// Classify: AStock 股票 / Fund 基金(ETF) / Index 指数 / BStock B股。
// 指数类直接用 QuoteID（如 "1.000001"）作为 symbol，规避「上证指数 000001」
// 与「平安银行 000001」的 6 位代码冲突 —— 纯数字 000001 默认解析为深市股票。
export async function search(query: string): Promise<SearchResult[]> {
  const url = `https://searchapi.eastmoney.com/api/suggest/get?input=${encodeURIComponent(query)}&type=14&count=10`;
  // 第三个参数 cooldown=false：搜索域名不受行情接口的风控冷却影响。
  const json = await efetch(url, "https://www.eastmoney.com/", false);
  const rows: any[] = json?.QuotationCodeTable?.Data ?? [];
  const typeOf = (c: string) => (c === "Index" ? "index" : c === "Fund" ? "etf" : "stock");
  return rows
    .filter((r) => ["AStock", "Fund", "Index", "BStock"].includes(r.Classify))
    .map((r) => ({
      symbol: r.Classify === "Index" ? String(r.QuoteID) : String(r.Code),
      name: r.Name ?? "",
      exchange: r.SecurityTypeName ?? "",
      type: typeOf(r.Classify),
    }));
}
