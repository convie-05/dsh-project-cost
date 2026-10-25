/**
 * dsh-project-cost —— 宿主半边
 *
 * 目标：按「项目」统计 Token 花费。DSH 没有“项目”这个对象，但每个会话都带一个
 * 工作目录（cwd，创建后基本不变），所以这里把 **cwd 当作项目**，把全部会话的累计
 * token 用量按 cwd 归并。
 *
 * 数据来源（全部只读）：
 *   1. DSH 会话投影缓存 `$DSH_HOME/storages/session_projcache/sessions/<id>.json`
 *      → `record.rows.tokenUsage.val.totals` 是该会话跨天的累计用量（首选，最完整）。
 *   2. `$DSH_HOME/dsh-usage/usage-ledger.json`（装了 @linxin666/dsh-usage 才有）
 *      → 提供今日 / 近 N 天的 token，以及能计价时的金额。
 *   3. live 会话列表（ctx.sessions + ctx.sessionProjections）→ 补上尚未落盘的会话。
 *
 * 计价：以「每百万 token 单价」× total token 估算（单价在插件配置里改）；
 * dsh-usage 自己算出了金额时，把它的金额单独列出来做对照。
 */

import { readFile, readdir, mkdir, writeFile, rename, unlink, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, sep } from 'node:path'

const PLUGIN_ID = 'project-cost'
const DAY_MS = 24 * 60 * 60 * 1000
const SETTINGS_NAMESPACE = 'project-cost'

/** Cordis Schema 的 volatile 字段会包一层引用，取值时两种都兼容。 */
function readField(field, fallback) {
  if (field === undefined || field === null) return fallback
  if (typeof field === 'object' && typeof field.get === 'function') {
    try {
      const value = field.get()
      return value === undefined || value === null ? fallback : value
    } catch {
      return fallback
    }
  }
  return field
}

function num(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function round(value, digits = 4) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/**
 * DSH 数据根目录。优先级：插件配置 > 环境变量 > ~/.dsh。
 * 开源版把这条链做成可配置，用户装在非默认位置（WSL / 便携版 / 自定义 profile）时也能用。
 */
function resolveDshHome(override) {
  const explicit = typeof override === 'string' ? expandHome(override.trim()) : ''
  if (explicit.length > 0) return explicit
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return expandHome(fromEnv.trim())
  return join(homedir(), '.dsh')
}

/**
 * 在若干候选路径里挑第一个存在的文件。
 * 用于兼容不同版本的目录布局（例如 cost-meter 账本位置曾变动）。
 * @returns 第一个存在且可读的路径；都不存在时返回 null。
 */
async function firstExisting(paths) {
  for (const candidate of paths) {
    if (typeof candidate !== 'string' || candidate.length === 0) continue
    try {
      await stat(candidate)
      return candidate
    } catch {}
  }
  return null
}

function expandHome(input) {
  if (typeof input !== 'string' || input.length === 0) return input
  if (input === '~') return homedir()
  if (input.startsWith('~/') || input.startsWith('~\\')) return join(homedir(), input.slice(2))
  return input
}

/** 统一 cwd 写法：去尾部分隔符、统一成 /、盘符大写，用作项目主键。 */
function normalizeKey(cwd) {
  if (typeof cwd !== 'string') return ''
  let value = cwd.trim()
  if (value.length === 0) return ''
  value = value.replace(/[\\/]+$/, '')
  if (value.length === 0) value = sep
  value = value.replace(/[\\/]/g, '/')
  if (/^[a-zA-Z]:/.test(value)) value = value[0].toUpperCase() + value.slice(1)
  return value
}

function basename(p) {
  const parts = String(p || '').split(/[\\/]/).filter(Boolean)
  return parts.length > 0 ? parts[parts.length - 1] : String(p || '')
}

function localDateKey(ms) {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function emptyTokens() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, tokens: 0 }
}

function addTokens(target, source) {
  if (!source || typeof source !== 'object') return target
  target.input += num(source.input, 0)
  target.output += num(source.output, 0)
  target.cacheRead += num(source.cacheRead, 0)
  target.cacheWrite += num(source.cacheWrite, 0)
  target.reasoning += num(source.reasoning, 0)
  target.tokens += num(source.tokens, 0)
  return target
}

function makeRecord(input) {
  const tokens = emptyTokens()
  addTokens(tokens, input.totals)
  return {
    id: input.id,
    cwd: typeof input.cwd === 'string' ? input.cwd : '',
    projectKey: normalizeKey(input.cwd),
    title: typeof input.title === 'string' ? input.title : '',
    createdAt: num(input.createdAt, 0),
    origin: typeof input.origin === 'string' ? input.origin : '',
    parentSession: typeof input.parentSession === 'string' ? input.parentSession : '',
    tokens,
  }
}

function totalsFromCache(usageTotals) {
  const t = usageTotals && typeof usageTotals === 'object' ? usageTotals : {}
  const input = num(t.uncachedInputTokens, num(t.inputTokens, 0))
  const output = num(t.outputTokens, 0)
  const cacheRead = num(t.cacheReadTokens, 0)
  const cacheWrite = num(t.cacheWriteTokens, 0)
  const reasoning = num(t.reasoningTokens, 0)
  return { input, output, cacheRead, cacheWrite, reasoning, tokens: input + output + cacheRead + cacheWrite }
}

/** 读一个投影缓存文件 → 会话记录。任何异常一律返回 null。 */
async function readProjectionFile(file, idFromName) {
  let doc
  try {
    doc = JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return null
  }
  const record = doc?.record
  const identity = record?.identity
  if (!identity || typeof identity !== 'object') return null
  const rows = record?.rows ?? {}
  const titleVal = rows.title?.val
  return makeRecord({
    id: idFromName,
    cwd: identity.cwd,
    title: typeof titleVal === 'string' ? titleVal : '',
    createdAt: identity.createdAt,
    origin: identity.origin,
    parentSession: identity.parentSession,
    totals: totalsFromCache(rows.tokenUsage?.val?.totals),
  })
}

/**
 * 读 dsh-usage 台账（`$DSH_HOME/dsh-usage/usage-ledger.json`）。
 *
 * 台账的结构是「日 → provider → model → 桶」，**不含会话 id**，所以它没法直接把用量
 * 摊到项目上。这里只把它当作“这一天的总量”使用：今日合计 / 近 N 天合计都是全局口径，
 * 与 dsh-usage 自己的页面一致；按项目分摊只做在「今日」这一列上
 * （按各项目当天的执行次数加权，见 build()）。
 */
async function readUsageLedger(file, recentDays) {
  const result = { ok: false, days: 0, recentTotal: 0, todayTotal: 0, costPerToken: 0, recentCost: 0, todayCost: 0 }
  let doc
  try {
    doc = JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return result
  }
  const days = doc?.days
  if (!days || typeof days !== 'object') return result
  const dayKeys = Object.keys(days)
    .filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k))
    .sort()
  if (dayKeys.length === 0) return result
  result.ok = true
  result.days = dayKeys.length
  const recentSet = new Set(dayKeys.slice(-recentDays))
  const todayKey = localDateKey(Date.now())
  let recentTokens = 0
  let todayTokens = 0
  let recentCost = 0
  let todayCost = 0

  const bucketsOf = (entry) => {
    const input = num(entry.inputTokens, num(entry.input, 0))
    const output = num(entry.outputTokens, num(entry.output, 0))
    const cacheRead = num(entry.cacheReadTokens, num(entry.cacheRead, 0))
    const cacheWrite = num(entry.cacheWriteTokens, num(entry.cacheWrite, 0))
    return { tokens: input + output + cacheRead + cacheWrite, cost: num(entry.cost, 0) }
  }

  for (const dateKey of dayKeys) {
    const day = days[dateKey]
    if (!day || typeof day !== 'object') continue
    const inRecent = recentSet.has(dateKey)
    const isToday = dateKey === todayKey
    if (!inRecent && !isToday) continue
    let tokens = 0
    let cost = 0
    const visit = (entry) => {
      if (!entry || typeof entry !== 'object') return
      // 只认桶（带 inputTokens / outputTokens 等数字），跳过嵌套结构
      if (!Array.isArray(entry) && (entry.inputTokens !== undefined || entry.outputTokens !== undefined || entry.cacheReadTokens !== undefined)) {
        const values = bucketsOf(entry)
        tokens += values.tokens
        cost += values.cost
        return
      }
      for (const child of Object.values(entry)) visit(child)
    }
    visit(day)
    if (inRecent) {
      recentTokens += tokens
      recentCost += cost
    }
    if (isToday) {
      todayTokens += tokens
      todayCost += cost
    }
  }

  result.recentTotal = recentTokens
  result.todayTotal = todayTokens
  result.recentCost = round(recentCost, 4)
  result.todayCost = round(todayCost, 4)
  result.costPerToken = recentTokens > 0 && recentCost > 0 ? recentCost / recentTokens : 0
  return result
}

/**
 * 读 cost-meter 的账本（`$DSH_HOME/storages/cost-meter/ledger.json`）。
 *
 * 这是目前**最准**的一手数据：它按「日 → 会话」记账，每条会话记录都带
 * `costCny` / `cost` / `apiCostCny`（真实金额，不是估算），还有 input/output/cacheRead 等桶。
 * 装了 dsh-cost-meter 才读得到；读不到就退回投影缓存 + 单价估算。
 */
async function readCostMeterLedger(file) {
  const result = { ok: false, days: 0, sessions: new Map(), todayBySession: new Map(), currency: 'CNY', latestDay: '' }
  let doc
  try {
    doc = JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return result
  }
  const days = doc?.days
  if (!days || typeof days !== 'object') return result
  const dayKeys = Object.keys(days)
    .filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k))
    .sort()
  if (dayKeys.length === 0) return result
  result.ok = true
  result.days = dayKeys.length
  result.latestDay = dayKeys[dayKeys.length - 1]
  const currency = typeof doc?.config?.currency === 'string' ? doc.config.currency.toUpperCase() : 'CNY'
  result.currency = currency === 'USD' || currency === 'EUR' ? currency : 'CNY'

  for (const dateKey of dayKeys) {
    const rows = days[dateKey]?.sessions
    if (!Array.isArray(rows)) continue
    for (const row of rows) {
      const id = typeof row?.id === 'string' ? row.id : ''
      if (id.length === 0) continue
      const input = num(row.input, 0)
      const output = num(row.output, 0)
      const cacheRead = num(row.cacheRead, 0)
      const cacheWrite = num(row.cacheWrite, 0)
      const reasoning = num(row.reasoning, 0)
      // 优先用该币种的金额字段；缺了就按 cost → apiCost 的顺序取。
      const cost =
        currency === 'USD'
          ? num(row.cost, num(row.apiCost, 0))
          : currency === 'EUR'
            ? num(row.costEur, num(row.apiCostEur, num(row.cost, 0)))
            : num(row.costCny, num(row.apiCostCny, num(row.cost, 0)))
      let entry = result.sessions.get(id)
      if (entry === undefined) {
        entry = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, cost: 0, calls: 0, firstAt: 0, lastAt: 0 }
        result.sessions.set(id, entry)
      }
      entry.input += input
      entry.output += output
      entry.cacheRead += cacheRead
      entry.cacheWrite += cacheWrite
      entry.reasoning += reasoning
      entry.cost += cost
      entry.calls += num(row.calls, 0)
      const at = num(row.at, 0)
      if (at > 0) {
        if (entry.firstAt === 0 || at < entry.firstAt) entry.firstAt = at
        if (at > entry.lastAt) entry.lastAt = at
      }
      // 今天这一份单独存一份，供「今日」列使用（口径与账本一致）。
      if (dateKey === localDateKey(Date.now())) {
        let today = result.todayBySession.get(id)
        if (today === undefined) {
          today = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, tokens: 0, cost: 0 }
          result.todayBySession.set(id, today)
        }
        today.input += input
        today.output += output
        today.cacheRead += cacheRead
        today.cacheWrite += cacheWrite
        today.reasoning += reasoning
        today.tokens += input + output + cacheRead + cacheWrite
        today.cost += cost
      }
    }
  }
  return result
}

async function readJsonFile(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return null
  }
}

async function writeJsonAtomic(file, value) {
  await mkdir(dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`
  try {
    await writeFile(temp, JSON.stringify(value, null, 1), 'utf8')
    await rename(temp, file)
  } catch (error) {
    try {
      await unlink(temp)
    } catch {}
    throw error
  }
}

function loopbackOnly(req) {
  const host = String(req?.headers?.host ?? '').toLowerCase()
  const name = host.split(':')[0]
  if (name === '') return true
  return name === '127.0.0.1' || name === 'localhost' || name === '[::1]' || name === '::1'
}

function sendJson(res, status, value) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(value))
}

function optionalService(ctx, key) {
  try {
    return ctx.get(key) ?? undefined
  } catch {
    return undefined
  }
}

function createAggregator(ctx, readConfig) {
  /** 投影缓存目录（DSH 自己维护的会话投影）。 */
  const projectionDir = () => {
    const cfg = readConfig()
    const home = resolveDshHome(cfg.dshHome)
    return join(home, 'storages', 'session_projcache', 'sessions')
  }

  /** dsh-usage 台账：多个历史位置都试一遍。 */
  const usageLedgerCandidates = () => {
    const cfg = readConfig()
    const home = resolveDshHome(cfg.dshHome)
    return [
      join(home, 'dsh-usage', 'usage-ledger.json'),
      join(home, 'storages', 'dsh-usage', 'usage-ledger.json'),
    ]
  }

  /** dsh-cost-meter 账本：支持用户覆盖，然后按历史布局逐个探测。 */
  const costMeterCandidates = () => {
    const cfg = readConfig()
    const home = resolveDshHome(cfg.dshHome)
    const list = []
    if (typeof cfg.costMeterPath === 'string' && cfg.costMeterPath.trim().length > 0) {
      list.push(expandHome(cfg.costMeterPath.trim()))
    }
    list.push(join(home, 'storages', 'cost-meter', 'ledger.json'))
    list.push(join(home, 'cost-meter', 'ledger.json'))
    return list
  }

  const snapshotPath = () => {
    const cfg = readConfig()
    return join(resolveDshHome(cfg.dshHome), 'storages', 'project-cost', 'overview.json')
  }

  async function scanCache() {
    const dir = projectionDir()
    let files
    try {
      files = await readdir(dir)
    } catch {
      return []
    }
    const records = []
    for (const fileName of files) {
      if (!fileName.toLowerCase().endsWith('.json')) continue
      const record = await readProjectionFile(join(dir, fileName), fileName.replace(/\.json$/i, ''))
      if (record !== null) records.push(record)
    }
    return records
  }

  /** live 会话：投影缓存可能还没写，用服务现算一份。 */
  function scanLive(knownIds) {
    const sessions = optionalService(ctx, 'sessions')
    const projections = optionalService(ctx, 'sessionProjections')
    if (!sessions || typeof sessions.list !== 'function') return []
    let list = []
    try {
      list = sessions.list()
    } catch {
      return []
    }
    const records = []
    for (const session of list) {
      try {
        const header = session?.header ?? {}
        const id = header.id ?? session?.id
        if (typeof id !== 'string' || knownIds.has(id)) continue
        let totals = {}
        if (projections && typeof projections.stateOf === 'function') {
          const state = projections.stateOf(session, 'tokenUsage')
          totals = state?.totals ?? {}
        }
        records.push(
          makeRecord({
            id,
            cwd: header.cwd,
            title: typeof header.title === 'string' ? header.title : '',
            createdAt: header.createdAt,
            origin: header.origin,
            parentSession: header.parentSession,
            totals: totalsFromCache(totals),
          }),
        )
      } catch {}
    }
    return records
  }

  async function build() {
    const started = Date.now()
    const cfg = readConfig()
    const cached = await scanCache()
    const known = new Set(cached.map((r) => r.id))
    const live = cfg.includeLiveSessions ? scanLive(known) : []
    const records = [...cached, ...live]
    const meterFile = await firstExisting(costMeterCandidates())
    const meter = meterFile === null
      ? { ok: false, days: 0, sessions: new Map(), todayBySession: new Map(), currency: 'CNY', latestDay: '' }
      : await readCostMeterLedger(meterFile)
    const usageFile = await firstExisting(usageLedgerCandidates())
    const usage = usageFile === null
      ? { ok: false, days: 0, recentTotal: 0, todayTotal: 0, costPerToken: 0, recentCost: 0, todayCost: 0 }
      : await readUsageLedger(usageFile, cfg.recentDays)
    const symbols = { CNY: '¥', USD: '$', EUR: '€' }
    const costSymbol = symbols[meter.currency] ?? '¥'

    const projects = new Map()
    const ensure = (record) => {
      let project = projects.get(record.projectKey)
      if (project === undefined) {
        const alias = cfg.aliasFor(record.cwd)
        project = {
          key: record.projectKey,
          path: record.cwd || '(未知目录)',
          name: alias || basename(record.cwd) || '(未知目录)',
          sessions: 0,
          subagentSessions: 0,
          total: emptyTokens(),
          today: emptyTokens(),
          firstAt: 0,
          lastAt: 0,
          meterCost: 0,
          meterCalls: 0,
          meterSessions: 0,
          topSessions: [],
        }
        projects.set(record.projectKey, project)
      }
      return project
    }

    for (const record of records) {
      if (record.tokens.tokens <= 0) continue
      const project = ensure(record)
      project.sessions += 1
      if (record.origin === 'subagent') project.subagentSessions += 1
      addTokens(project.total, record.tokens)
      // cost-meter 的一手账：真金白银的金额 + 精确分桶，按会话 id 直接归到项目。
      const billed = meter.sessions.get(record.id)
      if (billed !== undefined) {
        project.meterSessions += 1
        project.meterCost += billed.cost
        project.meterCalls += billed.calls
        // 「今天」只取账本里今天那一条（账本已按日切分，不会重复计入）。
        const today = meter.todayBySession.get(record.id)
        if (today !== undefined) addTokens(project.today, today)
      }
      if (record.createdAt > 0) {
        if (project.firstAt === 0 || record.createdAt < project.firstAt) project.firstAt = record.createdAt
        if (record.createdAt > project.lastAt) project.lastAt = record.createdAt
      }
      project.topSessions.push({
        id: record.id,
        title: record.title || record.id.slice(0, 8),
        tokens: record.tokens.tokens,
        cost: billed !== undefined ? round(billed.cost, 4) : 0,
        createdAt: record.createdAt,
        origin: record.origin,
      })
    }

    const price = cfg.pricePerMillion
    const list = [...projects.values()].map((project) => {
      project.topSessions.sort((a, b) => b.tokens - a.tokens)
      return {
        key: project.key,
        path: project.path,
        name: project.name,
        sessions: project.sessions,
        subagentSessions: project.subagentSessions,
        total: project.total,
        today: project.today,
        firstAt: project.firstAt,
        lastAt: project.lastAt,
        cost: {
          // 一手金额优先（装了 dsh-cost-meter 才有）；没有就按单价估算。
          actual: round(project.meterCost, 4),
          estimated: round((project.total.tokens / 1e6) * price, 4),
          calls: project.meterCalls,
          billedSessions: project.meterSessions,
          pricePerMillion: price,
        },
        topSessions: project.topSessions.slice(0, 10),
      }
    })
    list.sort((a, b) => b.total.tokens - a.total.tokens)

    const grand = { ...emptyTokens(), todayTokens: 0, estimatedCost: 0, actualCost: 0, calls: 0 }
    for (const project of list) {
      addTokens(grand, project.total)
      grand.todayTokens += project.today.tokens
      grand.estimatedCost += project.cost.estimated
      grand.actualCost += project.cost.actual
      grand.calls += project.cost.calls
    }
    grand.estimatedCost = round(grand.estimatedCost, 4)
    grand.actualCost = round(grand.actualCost, 4)
    if (!meter.ok) grand.todayTokens = usage.todayTotal

    const overview = {
      generatedAt: Date.now(),
      tookMs: Date.now() - started,
      settings: {
        pricePerMillion: price,
        priceUnit: cfg.priceUnit,
        recentDays: cfg.recentDays,
        includeLive: cfg.includeLiveSessions,
        currencySymbol: cfg.priceUnit === 'usd' ? '$' : '¥',
        costCurrency: meter.currency,
        costSymbol,
      },
      sources: {
        projectionCache: {
          dir: projectionDir(),
          sessions: cached.length,
          liveSessions: live.length,
          ok: cached.length > 0 || live.length > 0,
        },
        costMeter: {
          file: meterFile,
          ok: meter.ok,
          days: meter.days,
          sessions: meter.sessions.size,
          currency: meter.currency,
          latestDay: meter.latestDay,
        },
        usageLedger: {
          file: usageFile,
          ok: usage.ok,
          days: usage.days,
          recentDays: cfg.recentDays,
          recentTotal: usage.recentTotal,
          todayTotal: usage.todayTotal,
        },
      },
      grand,
      projects: list,
    }
    try {
      await writeJsonAtomic(snapshotPath(), overview)
    } catch {}
    return overview
  }

  async function persisted() {
    const saved = await readJsonFile(snapshotPath())
    return saved && Array.isArray(saved.projects) ? saved : undefined
  }

  return { build, persisted }
}

function apply(ctx, config) {
  let cache
  let building
  let flushTimer

  const readConfig = () => {
    const source = config && typeof config === 'object' ? config : {}
    const priceUnitRaw = String(readField(source.priceUnit, 'cny')).toLowerCase()
    const priceUnit = priceUnitRaw === 'usd' ? 'usd' : 'cny'
    const aliases = new Map()
    const aliasRaw = readField(source.pathAliases, '')
    if (typeof aliasRaw === 'string') {
      for (const line of aliasRaw.split(/\r?\n/)) {
        const trimmed = line.trim()
        if (trimmed.length === 0 || trimmed.startsWith('#')) continue
        const idx = trimmed.indexOf('=')
        if (idx <= 0) continue
        const from = normalizeKey(expandHome(trimmed.slice(0, idx).trim()))
        const to = trimmed.slice(idx + 1).trim()
        if (from.length > 0 && to.length > 0) aliases.set(from, to)
      }
    }
    return {
      pricePerMillion: Math.max(0, num(readField(source.pricePerMillion, 0), 0)),
      priceUnit,
      recentDays: Math.min(365, Math.max(7, Math.round(num(readField(source.recentDays, 30), 30)))),
      includeLiveSessions: readField(source.includeLiveSessions, true) !== false,
      dshHome: String(readField(source.dshHome, '') ?? '').trim(),
      costMeterPath: String(readField(source.costMeterPath, '') ?? '').trim(),
      aliasFor(cwd) {
        return aliases.get(normalizeKey(cwd))
      },
    }
  }

  const aggregator = createAggregator(ctx, readConfig)

  const overview = async (force = false) => {
    if (!force && cache !== undefined && Date.now() - cache.generatedAt < 3000) return cache
    if (building !== undefined) return await building
    building = aggregator
      .build()
      .then((value) => {
        cache = value
        return value
      })
      .catch(async (error) => {
        if (cache !== undefined) return cache
        const saved = await aggregator.persisted()
        if (saved !== undefined) return saved
        return {
          generatedAt: Date.now(),
          tookMs: 0,
          error: error instanceof Error ? error.message : String(error),
          settings: { pricePerMillion: 0, priceUnit: 'cny', recentDays: 30, includeLive: true, currencySymbol: '¥' },
          sources: {},
          grand: { ...emptyTokens(), todayTokens: 0, recentTokens: 0, estimatedCost: 0, ledgerCost: 0 },
          projects: [],
        }
      })
      .finally(() => {
        building = undefined
      })
    return await building
  }

  const disposers = []

  // ---- 本机回环路由：设置页从这里取数据 ------------------------------------
  const registerRoute = (path, handler) => {
    disposers.push(
      ctx.webServer.register({
        kind: 'exact',
        path,
        handler: async (req, res) => {
          try {
            if (!loopbackOnly(req)) {
              sendJson(res, 403, { ok: false, error: 'loopback only' })
              return
            }
            await handler(req, res)
          } catch (error) {
            sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
          }
        },
      }),
    )
  }
  registerRoute('/dsh-project-cost/api/overview', async (req, res) => {
    const fresh = String(new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('fresh') ?? '') === '1'
    sendJson(res, 200, { ok: true, overview: await overview(fresh) })
  })
  registerRoute('/dsh-project-cost/api/refresh', async (req, res) => {
    if (req.method !== 'POST' && req.method !== 'GET') {
      sendJson(res, 405, { ok: false, error: 'method not allowed' })
      return
    }
    sendJson(res, 200, { ok: true, overview: await overview(true) })
  })

  // ---- 会话落盘后防抖刷新，维持一份快照 -----------------------------------
  const armFlush = (delay) => {
    if (flushTimer !== undefined) clearTimeout(flushTimer)
    flushTimer = setTimeout(() => {
      flushTimer = undefined
      void overview(false)
    }, delay)
    if (typeof flushTimer.unref === 'function') flushTimer.unref()
  }
  disposers.push(ctx.on('session/flush', () => armFlush(2500)))
  // 装上后先在后台算一次，第一次打开设置页就不用等扫描。
  armFlush(1500)

  // 顺带暴露一个只读工具，让 Agent 自己也能报「这个项目花了多少 token」。
  // 注册失败（早期宿主没有 tools 服务）就静默跳过，不影响设置页。
  try {
    const tools = optionalService(ctx, 'tools')
    if (tools && typeof tools.register === 'function') {
      // ToolOutputDefinition.render(args, value)：第一个参数是调用参数，第二个才是结果。
      const render = (_args, value) => [{ type: 'text', text: String(value?.text ?? '') }]
      disposers.push(
        tools.register({
          name: 'project_cost_report',
          description:
            '按项目（= 会话的工作目录）汇总 DSH 的 Token 花费与真实金额：返回每个项目的累计 token、今日 token、会话数、真实花费（CNY）和调用次数。金额来自 dsh-cost-meter 账本；累计 token 来自 DSH 会话投影缓存。只读，不修改任何数据。',
          parameters: {
            type: 'object',
            properties: {
              limit: { type: 'number', description: '最多返回多少个项目，默认 20。' },
            },
            additionalProperties: false,
          },
          output: {
            schema: {
              type: 'object',
              properties: { text: { type: 'string' } },
              required: ['text'],
              additionalProperties: false,
            },
            render,
          },
          async execute(args) {
            const limit = Math.min(200, Math.max(1, Math.round(num(args?.limit, 20))))
            const value = await overview(false)
            const projects = (value.projects ?? []).slice(0, limit)
            const currency = value.settings?.costSymbol ?? '¥'
            const lines = [
              `共 ${value.projects?.length ?? 0} 个项目：累计 ${value.grand?.tokens ?? 0} tokens，今日 ${value.grand?.todayTokens ?? 0} tokens，花费 ${currency}${(value.grand?.actualCost ?? 0).toFixed(2)}（${value.grand?.calls ?? 0} 次调用）。`,
            ]
            for (const project of projects) {
              const cost = project.cost?.actual > 0 ? `${currency}${project.cost.actual.toFixed(2)}` : '无金额'
              lines.push(
                `· ${project.name}：${project.total.tokens} tokens，会话 ${project.sessions}，今日 ${project.today?.tokens ?? 0}，花费 ${cost}，路径 ${project.path}`,
              )
            }
            if (projects.length === 0) lines.push('还没有读到任何用量（DSH 会话投影缓存为空）。')
            return { text: lines.join('\n') }
          },
        }),
      )
    }
  } catch {}

  ctx.effect(() => {
    return () => {
      if (flushTimer !== undefined) clearTimeout(flushTimer)
      for (const dispose of disposers) {
        try {
          dispose()
        } catch {}
      }
    }
  }, 'project-cost: runtime')
}

// settings / sessions / sessionProjections 都不写进 inject：
// 它们都是“有就用、没有就退”，缺了插件照样能读缓存跑起来。
const inject = ['webServer']

/**
 * 插件配置。全部字段可选，缺省即可工作。
 * 每个字段都在 readConfig() 里被读取并做范围收敛，写错值不会让插件崩。
 */
const Config = {
  type: 'object',
  properties: {
    dshHome: {
      type: 'string',
      default: '',
      description: 'DSH 数据根目录。留空则依次尝试 $DSH_HOME、~/.dsh。WSL/便携版/自定义 profile 时填这里。',
    },
    costMeterPath: {
      type: 'string',
      default: '',
      description: 'dsh-cost-meter 账本路径（可选）。留空则自动探测 $DSH_HOME/storages/cost-meter/ledger.json 等常见位置。',
    },
    pricePerMillion: {
      type: 'number',
      default: 0,
      minimum: 0,
      description: '每百万 token 的单价，用于在缺少真实账本时估算花费。0 = 不估算。',
    },
    priceUnit: {
      type: 'string',
      default: 'cny',
      description: '单价币种：cny 或 usd。',
    },
    recentDays: {
      type: 'number',
      default: 30,
      minimum: 7,
      maximum: 365,
      description: '「近 N 天」汇总口径。',
    },
    includeLiveSessions: {
      type: 'boolean',
      default: true,
      description: '是否把当前仍存活、尚未落盘投影缓存的会话计入。',
    },
    pathAliases: {
      type: 'string',
      default: '',
      description: '项目改名：每行「工作目录=显示名」，~ 代表用户目录。',
    },
  },
}

export const name = PLUGIN_ID
export { inject, apply, Config }
export default { name: PLUGIN_ID, inject, Config, apply }
