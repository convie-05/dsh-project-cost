/**
 * dsh-project-cost —— 客户端半边（设置 → 项目花费）
 *
 * 渲染策略说明（重要）
 * -------------------
 * 这个组件走「React 只做挂载点 + 原生 DOM 绘制」的混合模式：
 *
 *   1. React 侧只返回一个 div，并用 ref 回调把真实 DOM 节点交出去；
 *   2. 拿到节点后，所有界面由原生 DOM 构建（模块级函数，不依赖 React 生命周期）。
 *
 * 为什么这样做：DSH 的 slot 渲染器在组件渲染期抛错时会**静默清空整个条目**
 * （slot 状态仍显示 active:true，但用户只看到空白）。用原生 DOM 绘制可以把
 * 「渲染」和「取数」彻底解耦——即使数据层出问题，也只会显示错误文字，
 * 不会让整个面板消失。
 *
 * 注意：这并不是说 React hooks 不可用（本项目早期误判过）。实测宿主 React
 * 提供 createElement / Fragment / useState / useEffect / useRef 等常规成员，
 * 但 **没有 Component**（写 class 组件会在模块加载期抛错，整个客户端作废）。
 * 用函数组件 + ref 回调是这里最稳的选择。
 */
window.__ModuleLoader__.load({
  id: 'dsh-project-cost',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'project-cost'
    const SECTION_ID = 'project-cost'
    const SECTION_ORDER = 26
    // 必须带前导斜杠：相对路径会被解析成 /settings/dsh-project-cost/api/overview → 404。
    const API_OVERVIEW = '/dsh-project-cost/api/overview'

    /** apply(ctx) 存下来的客户端上下文，组件里用它读 locale。 */
    let pluginCtx = null

    // ───────────────────────── 样式 ─────────────────────────
    const STYLE = [
      '.dpc-root{display:flex;flex-direction:column;gap:12px;color:var(--dsw-alias-label-primary);max-width:1000px;font-size:13px;line-height:20px}',
      '.dpc-title{margin:0;font-size:15px;font-weight:600;line-height:22px}',
      '.dpc-sub{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}',
      '.dpc-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}',
      '.dpc-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
      '.dpc-btn{background:transparent;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;color:var(--dsw-alias-label-primary);font-size:12px;line-height:20px;padding:3px 10px;cursor:pointer;font-family:inherit}',
      '.dpc-btn:hover:not(:disabled){border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}',
      '.dpc-btn.primary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:#fff}',
      '.dpc-btn:disabled{opacity:.55;cursor:default}',
      '.dpc-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}',
      '.dpc-card{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:10px 12px;display:flex;flex-direction:column;gap:2px}',
      '.dpc-card-k{color:var(--dsw-alias-label-secondary);font-size:11.5px;line-height:16px}',
      '.dpc-card-v{font-size:20px;font-weight:600;line-height:26px;font-variant-numeric:tabular-nums}',
      '.dpc-card-h{color:var(--dsw-alias-label-secondary);font-size:11px;line-height:15px}',
      '.dpc-list{display:flex;flex-direction:column;border-top:1px solid var(--dsw-alias-border-l2)}',
      '.dpc-row{display:flex;flex-direction:column;border-bottom:.5px solid var(--dsw-alias-border-l1)}',
      '.dpc-row.is-open{background:var(--dsw-alias-bg-layer-1)}',
      '.dpc-row-main{display:grid;grid-template-columns:minmax(150px,2.2fr) 64px minmax(94px,1.2fr) 88px 92px 92px;gap:10px;align-items:center;padding:8px;cursor:pointer}',
      '.dpc-row-main:hover{background:var(--dsw-alias-bg-layer-1)}',
      '.dpc-row-head{cursor:default}',
      '.dpc-row-head .dpc-row-main{color:var(--dsw-alias-label-secondary);font-size:11.5px;font-weight:500;cursor:default;padding-bottom:6px}',
      '.dpc-row-head .dpc-row-main:hover{background:transparent}',
      '.dpc-col-name{display:flex;flex-direction:column;gap:2px;min-width:0}',
      '.dpc-col-num{display:flex;flex-direction:column;align-items:flex-end;gap:1px;text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}',
      '.dpc-col-tokens{display:flex;flex-direction:column;align-items:flex-end;gap:3px;text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}',
      '.dpc-cell-label{display:none;color:var(--dsw-alias-label-secondary);font-size:10.5px;line-height:14px}',
      '.dpc-name{display:flex;align-items:center;gap:6px;min-width:0}',
      '.dpc-caret{width:12px;flex:none;color:var(--dsw-alias-label-secondary);transition:transform .12s ease;text-align:center}',
      '.dpc-caret.open{transform:rotate(90deg)}',
      '.dpc-name-txt{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dpc-path{color:var(--dsw-alias-label-secondary);font-size:11px;line-height:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dpc-badge{font-size:10.5px;line-height:16px;padding:0 6px;border-radius:9px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);white-space:nowrap;flex:none}',
      '.dpc-token-value{font-weight:500}',
      '.dpc-cost-value{font-weight:500;color:var(--dsw-alias-state-success-primary)}',
      '.dpc-bar{display:block;width:100%;min-width:84px;height:4px;border-radius:2px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}',
      '.dpc-bar>i{display:block;height:100%;border-radius:2px;background:var(--dsw-alias-brand-primary)}',
      '.dpc-detail{background:var(--dsw-alias-bg-layer-1);border-radius:8px;padding:10px 12px;font-size:12px;display:flex;flex-direction:column;gap:6px;margin:0 8px 10px}',
      '.dpc-detail-k{color:var(--dsw-alias-label-secondary);min-width:72px;display:inline-block}',
      '.dpc-detail-path{display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
      '.dpc-detail-path code{font-size:11px;word-break:break-all;flex:1;min-width:150px}',
      '.dpc-detail-top{margin-top:4px;display:flex;flex-direction:column;gap:2px}',
      '.dpc-detail-title{font-weight:600;margin-bottom:4px}',
      '.dpc-session{display:flex;justify-content:space-between;gap:10px;padding:3px 0;border-bottom:.5px dashed var(--dsw-alias-border-l1);align-items:center}',
      '.dpc-session:last-child{border-bottom:none}',
      '.dpc-session-t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dpc-session-date{color:var(--dsw-alias-label-secondary);white-space:nowrap;font-variant-numeric:tabular-nums}',
      '.dpc-num{font-variant-numeric:tabular-nums;white-space:nowrap;text-align:right}',
      '.dpc-empty{color:var(--dsw-alias-label-secondary);font-size:12.5px;line-height:20px}',
      '.dpc-err{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px;word-break:break-all}',
      '.dpc-warn{color:var(--dsw-alias-state-warn-primary);font-size:12px;line-height:18px}',
      '.dpc-foot{color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px;word-break:break-all}',
      '@media (max-width:820px){.dpc-row-main{grid-template-columns:1fr 1fr;gap:4px 10px}.dpc-cell-label{display:block}.dpc-row-head{display:none}}',
    ].join('\n')

    // ───────────────────────── 格式化 ─────────────────────────
    const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)
    const obj = (value) => (value && typeof value === 'object' ? value : {})

    function fmtInt(value) {
      return Math.round(num(Number(value))).toLocaleString('zh-CN')
    }
    function fmtTokens(value) {
      const v = num(Number(value))
      if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B'
      if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M'
      if (v >= 1e4) return (v / 1e3).toFixed(1) + 'K'
      return fmtInt(v)
    }
    function fmtMoney(value, symbol) {
      const v = num(Number(value))
      if (v <= 0) return '—'
      const digits = v >= 100 ? 0 : v >= 1 ? 2 : 4
      return String(symbol) + v.toFixed(digits)
    }
    function fmtDate(ms) {
      const value = num(Number(ms))
      if (value <= 0) return '—'
      const d = new Date(value)
      const two = (n) => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`
    }

    // ───────────────────────── 文案 ─────────────────────────
    const DICT = {
      zh: {
        title: '项目花费（Token）',
        intro: '按「项目」统计 token 花费。DSH 没有项目对象，这里把每个会话的工作目录当作项目，把它的累计用量归到目录上。',
        refresh: '刷新',
        refreshing: '扫描中…',
        loading: '读取中…',
        loadFailed: '读取失败',
        cardTotal: '全部项目合计',
        cardToday: '今日',
        cardTodayHint: '全部项目今日合计',
        cardCost: '总花费',
        cardProjects: '项目数',
        cardEst: '按单价估算',
        thProject: '项目',
        thSessions: '会话',
        thTotal: '累计 tokens',
        thTodayAt: '今日',
        thCost: '真实花费',
        thLast: '最近会话',
        share: '占比',
        detailIn: '输入',
        detailOut: '输出',
        detailCacheRead: '缓存读',
        detailCacheWrite: '缓存写',
        detailReasoning: '推理',
        detailRange: '活跃时期',
        detailCost: '花费',
        detailTop: '最贵的会话',
        subagent: '子代理',
        copy: '复制路径',
        copied: '已复制',
        callsUnit: '次调用',
        billedSessions: '个已计费会话',
        estimatedTag: '估算',
        costUnknown: '无金额数据',
        todayHint: '来自 dsh-cost-meter 账本里「今天」的真实用量。',
        priceHint: '估算花费 = 累计 tokens ÷ 100 万 × 单价（{symbol}{price}/百万 token）。',
        ledgerHint: '「今日」来自 dsh-cost-meter 账本；未安装该插件时今日为 0，累计值不受影响。',
        meterMissing: '未检测到 dsh-cost-meter 账本——金额列与今日列为空，token 累计值仍准确。',
        empty: '还没有读到任何用量。请确认 DSH 正在使用（会话投影缓存位于 storages/session_projcache/sessions）。',
        sourceFoot: '数据源：投影缓存 {cache} 个会话（live {live}）· dsh-cost-meter 账本 {meterDays} 天 / {meterSessions} 个已计费会话 · 扫描 {ms}ms · {time}',
        generatedAt: '生成于 {time}',
      },
      en: {
        title: 'Project Cost (Tokens)',
        intro: 'Token spend per project. DSH has no project object, so each session working directory is treated as a project and its cumulative usage is attributed to it.',
        refresh: 'Refresh',
        refreshing: 'Scanning…',
        loading: 'Loading…',
        loadFailed: 'Load failed',
        cardTotal: 'All projects',
        cardToday: 'Today',
        cardTodayHint: 'all projects, today',
        cardCost: 'Total spend',
        cardProjects: 'Projects',
        cardEst: 'Estimated',
        thProject: 'Project',
        thSessions: 'Sessions',
        thTotal: 'Total tokens',
        thTodayAt: 'Today',
        thCost: 'Spend',
        thLast: 'Last session',
        share: 'Share',
        detailIn: 'Input',
        detailOut: 'Output',
        detailCacheRead: 'Cache read',
        detailCacheWrite: 'Cache write',
        detailReasoning: 'Reasoning',
        detailRange: 'Active',
        detailCost: 'Cost',
        detailTop: 'Most expensive sessions',
        subagent: 'subagent',
        copy: 'Copy path',
        copied: 'Copied',
        callsUnit: 'calls',
        billedSessions: 'billed sessions',
        estimatedTag: 'estimate',
        costUnknown: 'no cost data',
        todayHint: "Today's real usage from the dsh-cost-meter ledger.",
        priceHint: 'Estimated cost = total tokens ÷ 1M × unit price ({symbol}{price} per 1M tokens).',
        ledgerHint: 'Today comes from the dsh-cost-meter ledger; it stays 0 when that plugin is absent, totals are unaffected.',
        meterMissing: 'No dsh-cost-meter ledger detected — the cost and today columns stay empty; token totals remain accurate.',
        empty: 'No usage found yet. Make sure DSH has run a session (projection cache lives in storages/session_projcache/sessions).',
        sourceFoot: 'Sources: {cache} projection files (live {live}) · dsh-cost-meter ledger {meterDays} days / {meterSessions} billed sessions · scanned in {ms}ms · {time}',
        generatedAt: 'Generated {time}',
      },
    }

    function pickLocale() {
      try {
        const snapshot = pluginCtx?.locale?.getSnapshot?.() ?? pluginCtx?.locale?.getLocale?.()
        const active = String(snapshot?.active ?? snapshot?.id ?? '').toLowerCase()
        if (active.startsWith('en')) return 'en'
      } catch {}
      return 'zh'
    }

    function makeTranslate(locale) {
      const dict = DICT[locale] ?? DICT.zh
      return (key, vars) => {
        const template = dict[key] ?? DICT.zh[key] ?? key
        return String(template).replace(/\{(\w+)\}/g, (_, name) => (vars && vars[name] !== undefined ? String(vars[name]) : ''))
      }
    }

    // ───────────────────── 原生 DOM 构建工具 ─────────────────────
    /** 极简 createElement：只有这一套 DOM 原语会被用到，React 不参与结构渲染。 */
    function el(tag, attrs, children) {
      const node = document.createElement(tag)
      const props = attrs && typeof attrs === 'object' ? attrs : {}
      for (const [key, value] of Object.entries(props)) {
        if (value === null || value === undefined || value === false) continue
        if (key === 'className') node.className = String(value)
        else if (key === 'text') node.textContent = String(value)
        else if (key === 'style' && value && typeof value === 'object') Object.assign(node.style, value)
        else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value)
        else node.setAttribute(key, String(value))
      }
      const list = children === undefined ? [] : Array.isArray(children) ? children : [children]
      for (const child of list) {
        if (child === null || child === undefined || child === false) continue
        node.appendChild(typeof child === 'string' || typeof child === 'number' ? document.createTextNode(String(child)) : child)
      }
      return node
    }

    function clearNode(node) {
      while (node.firstChild) node.removeChild(node.firstChild)
    }

    // ───────────────────── 面板（纯 DOM 渲染）─────────────────────
    /** 把 overview 文档画进 host 元素；任何异常由调用方 catch 并显示在页面上。 */
    function paintPanel(host, state) {
      const t = makeTranslate(state.locale)
      clearNode(host)

      const data = obj(state.data)
      const settings = obj(data.settings)
      const sources = obj(data.sources)
      const grand = obj(data.grand)
      const projects = Array.isArray(data.projects) ? data.projects.filter((item) => item && typeof item === 'object') : []
      const symbol = typeof settings.currencySymbol === 'string' ? settings.currencySymbol : settings.priceUnit === 'usd' ? '$' : '¥'
      const costSymbol = typeof settings.costSymbol === 'string' ? settings.costSymbol : '¥'
      const recentDays = num(settings.recentDays) || 30
      const meterOk = obj(sources.costMeter).ok === true

      const root = el('div', { className: 'dpc-root' })
      host.appendChild(root)

      // ── 头部 ──
      root.appendChild(
        el('div', { className: 'dpc-head' }, [
          el('div', null, [
            el('h2', { className: 'dpc-title', text: t('title') }),
            el('div', { className: 'dpc-sub', text: t('intro') }),
          ]),
          el('div', { className: 'dpc-actions' }, [
            data.generatedAt
              ? el('span', {
                  className: 'dpc-sub',
                  text: t('generatedAt', { time: new Date(num(data.generatedAt) || Date.now()).toLocaleTimeString('zh-CN', { hour12: false }) }),
                })
              : null,
            el('button', {
              className: 'dpc-btn primary',
              type: 'button',
              disabled: state.busy ? 'disabled' : null,
              text: state.busy ? t('refreshing') : t('refresh'),
              onClick: () => { void state.load(true) },
            }),
          ]),
        ]),
      )

      // ── 错误 / 加载状态（始终可见，绝不静默）──
      if (state.error) root.appendChild(el('div', { className: 'dpc-err', text: `${t('loadFailed')}: ${state.error}` }))
      if (state.loading && !state.data) {
        root.appendChild(el('div', { className: 'dpc-empty', text: t('loading') }))
        return
      }

      // ── 汇总卡片 ──
      const cards = [
        { label: t('cardTotal'), value: fmtTokens(num(grand.tokens)), hint: fmtInt(num(grand.tokens)) + ' tokens' },
        { label: t('cardToday'), value: fmtTokens(num(grand.todayTokens)), hint: t('cardTodayHint') },
        {
          label: t('cardCost'),
          value: fmtMoney(num(grand.actualCost), costSymbol),
          hint: num(grand.calls) > 0 ? `${fmtInt(num(grand.calls))} ${t('callsUnit')}` : t('costUnknown'),
        },
        {
          label: t('cardProjects'),
          value: fmtInt(projects.length),
          hint: `${t('thSessions')} ${fmtInt(projects.reduce((sum, item) => sum + num(obj(item).sessions), 0))}`,
        },
      ]
      if (num(settings.pricePerMillion) > 0) {
        cards.push({ label: t('cardEst'), value: fmtMoney(num(grand.estimatedCost), symbol), hint: `${symbol}${num(settings.pricePerMillion)}/1M` })
      }
      root.appendChild(
        el(
          'div',
          { className: 'dpc-cards' },
          cards.map((card) =>
            el('div', { className: 'dpc-card' }, [
              el('div', { className: 'dpc-card-k', text: card.label }),
              el('div', { className: 'dpc-card-v', text: card.value }),
              el('div', { className: 'dpc-card-h', text: card.hint }),
            ]),
          ),
        ),
      )

      if (!meterOk) root.appendChild(el('div', { className: 'dpc-warn', text: t('meterMissing') }))

      // ── 项目列表 ──
      if (projects.length === 0) {
        root.appendChild(el('div', { className: 'dpc-empty', text: t('empty') }))
      } else {
        const list = el('div', { className: 'dpc-list' })
        root.appendChild(list)
        list.appendChild(
          el('div', { className: 'dpc-row dpc-row-head' }, [
            el('div', { className: 'dpc-row-main' }, [
              el('div', { className: 'dpc-col-name', text: t('thProject') }),
              el('div', { className: 'dpc-col-num', text: t('thSessions') }),
              el('div', { className: 'dpc-col-tokens', text: t('thTotal') }),
              el('div', { className: 'dpc-col-num', text: t('thTodayAt') }),
              el('div', { className: 'dpc-col-num', text: t('thCost') }),
              el('div', { className: 'dpc-col-num', text: t('thLast') }),
            ]),
          ]),
        )
        const totalTokens = num(grand.tokens)
        for (const rawProject of projects) {
          list.appendChild(paintProjectRow(rawProject, { t, totalTokens, symbol, costSymbol }))
        }
      }

      // ── 页脚 ──
      if (num(settings.pricePerMillion) > 0) {
        root.appendChild(el('div', { className: 'dpc-foot', text: t('priceHint', { symbol, price: num(settings.pricePerMillion) }) }))
      }
      if (meterOk) root.appendChild(el('div', { className: 'dpc-foot', text: t('ledgerHint', { n: recentDays }) }))
      root.appendChild(
        el('div', {
          className: 'dpc-foot',
          text: t('sourceFoot', {
            cache: num(obj(sources.projectionCache).sessions),
            live: num(obj(sources.projectionCache).liveSessions),
            meterDays: num(obj(sources.costMeter).days),
            meterSessions: num(obj(sources.costMeter).sessions),
            ms: num(data.tookMs),
            time: new Date(num(data.generatedAt) || Date.now()).toLocaleString('zh-CN', { hour12: false }),
          }),
        }),
      )
    }

    /** 一个项目行（含可展开明细），返回已挂好事件的元素。 */
    function paintProjectRow(rawProject, context) {
      const { t, totalTokens, symbol, costSymbol } = context
      const project = obj(rawProject)
      const totals = obj(project.total)
      const today = obj(project.today)
      const cost = obj(project.cost)
      const topSessions = Array.isArray(project.topSessions) ? project.topSessions : []
      const share = num(totalTokens) > 0 ? Math.max(0.5, Math.min(100, (num(totals.tokens) / totalTokens) * 100)) : 0

      const wrapper = el('div', { className: 'dpc-row' })
      const caret = el('span', { className: 'dpc-caret', text: '▶' })

      const main = el('div', { className: 'dpc-row-main' }, [
        el('div', { className: 'dpc-col-name' }, [
          el('div', { className: 'dpc-name' }, [
            caret,
            el('span', { className: 'dpc-name-txt', title: String(project.path ?? ''), text: String(project.name ?? '(未命名)') }),
            num(project.subagentSessions) > 0 ? el('span', { className: 'dpc-badge', text: `${t('subagent')} ${num(project.subagentSessions)}` }) : null,
          ]),
          el('div', { className: 'dpc-path', title: String(project.path ?? ''), text: String(project.path ?? '') }),
        ]),
        el('div', { className: 'dpc-col-num' }, [
          el('span', { className: 'dpc-cell-label', text: t('thSessions') }),
          el('span', { text: fmtInt(num(project.sessions)) }),
        ]),
        el('div', { className: 'dpc-col-tokens', title: `${fmtInt(num(totals.tokens))} tokens` }, [
          el('span', { className: 'dpc-cell-label', text: t('thTotal') }),
          el('span', { className: 'dpc-token-value', text: fmtTokens(num(totals.tokens)) }),
          el('span', { className: 'dpc-bar', title: `${t('share')} ${share.toFixed(1)}%` }, [el('i', { style: { width: share.toFixed(2) + '%' } })]),
        ]),
        el('div', { className: 'dpc-col-num', title: t('todayHint') }, [
          el('span', { className: 'dpc-cell-label', text: t('thTodayAt') }),
          el('span', { text: num(today.tokens) > 0 ? fmtTokens(num(today.tokens)) : '—' }),
        ]),
        el('div', { className: 'dpc-col-num' }, [
          el('span', { className: 'dpc-cell-label', text: t('thCost') }),
          el('span', {
            className: 'dpc-cost-value',
            text: fmtMoney(num(cost.actual) > 0 ? num(cost.actual) : num(cost.estimated), num(cost.actual) > 0 ? costSymbol : symbol),
          }),
        ]),
        el('div', { className: 'dpc-col-num' }, [
          el('span', { className: 'dpc-cell-label', text: t('thLast') }),
          el('span', { text: fmtDate(num(project.lastAt)) }),
        ]),
      ])
      wrapper.appendChild(main)

      let detail = null
      const toggle = () => {
        const willOpen = detail === null
        caret.classList.toggle('open', willOpen)
        wrapper.classList.toggle('is-open', willOpen)
        main.setAttribute('aria-expanded', String(willOpen))
        if (detail !== null) {
          wrapper.removeChild(detail)
          detail = null
          return
        }
        detail = el('div', { className: 'dpc-detail' }, [
          el('div', null, [el('span', { className: 'dpc-detail-k', text: t('detailIn') }), fmtInt(num(totals.input))]),
          el('div', null, [el('span', { className: 'dpc-detail-k', text: t('detailOut') }), fmtInt(num(totals.output))]),
          el('div', null, [el('span', { className: 'dpc-detail-k', text: t('detailCacheRead') }), fmtInt(num(totals.cacheRead))]),
          el('div', null, [el('span', { className: 'dpc-detail-k', text: t('detailCacheWrite') }), fmtInt(num(totals.cacheWrite))]),
          num(totals.reasoning) > 0
            ? el('div', null, [el('span', { className: 'dpc-detail-k', text: t('detailReasoning') }), fmtInt(num(totals.reasoning))])
            : null,
          el('div', null, [
            el('span', { className: 'dpc-detail-k', text: t('detailRange') }),
            `${fmtDate(num(project.firstAt))} → ${fmtDate(num(project.lastAt))}`,
          ]),
          num(cost.calls) > 0
            ? el('div', null, [
                el('span', { className: 'dpc-detail-k', text: t('detailCost') }),
                `${costSymbol}${num(cost.actual).toFixed(2)} · ${fmtInt(num(cost.calls))} ${t('callsUnit')} · ${num(cost.billedSessions)} ${t('billedSessions')}`,
              ])
            : el('div', null, [
                el('span', { className: 'dpc-detail-k', text: t('detailCost') }),
                num(cost.pricePerMillion) > 0 ? `${symbol}${num(cost.estimated).toFixed(2)} (${t('estimatedTag')})` : t('costUnknown'),
              ]),
          el('div', { className: 'dpc-detail-path' }, [
            el('code', { text: String(project.path ?? '') }),
            el('button', {
              className: 'dpc-btn',
              type: 'button',
              text: t('copy'),
              onClick: (event) => {
                event.stopPropagation()
                const button = event.currentTarget
                try {
                  navigator.clipboard?.writeText?.(String(project.path ?? ''))
                  button.textContent = t('copied')
                  setTimeout(() => { try { button.textContent = t('copy') } catch {} }, 1200)
                } catch {}
              },
            }),
          ]),
          topSessions.length > 0
            ? el('div', { className: 'dpc-detail-top' }, [
                el('div', { className: 'dpc-detail-title', text: t('detailTop') }),
                ...topSessions.map((rawSession) => {
                  const session = obj(rawSession)
                  return el('div', { className: 'dpc-session' }, [
                    el('span', { className: 'dpc-session-t', title: String(session.id ?? ''), text: String(session.title ?? '(未命名)') }),
                    session.origin === 'subagent' ? el('span', { className: 'dpc-badge', text: t('subagent') }) : null,
                    el('span', { className: 'dpc-num', text: fmtTokens(num(session.tokens)) }),
                    num(session.cost) > 0 ? el('span', { className: 'dpc-num', text: costSymbol + num(session.cost).toFixed(2) }) : null,
                    el('span', { className: 'dpc-session-date', text: fmtDate(num(session.createdAt)) }),
                  ])
                }),
              ])
            : null,
        ])
        wrapper.appendChild(detail)
      }

      main.addEventListener('click', toggle)
      main.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          toggle()
        }
      })
      main.setAttribute('role', 'button')
      main.setAttribute('tabindex', '0')
      main.setAttribute('aria-expanded', 'false')
      wrapper.dataset.projectKey = String(project.key ?? '')
      return wrapper
    }

    // ───────────────────── React 组件（只负责挂载点）─────────────────────
    /**
     * ref 回调：React 挂载时把真实 DOM 节点传进来，painter 直接绑在这个节点上。
     * 这样「React 渲染」与「取数/绘制」完全解耦：前者只负责把 div 放进 DOM，
     * 后者用原生 DOM 完成全部界面。
     */

    function mountHost(node) {
      if (node === null || node === undefined || typeof node !== 'object') return
      if (node.__dpcMounted) return
      node.__dpcMounted = true
      try {
        startPainter(node)
      } catch (error) {
        // 连 painter 都起不来时，至少把原因写进节点，不让它空白。
        try {
          const message = error instanceof Error ? error.message : String(error)
          clearNode(node)
          node.appendChild(el('div', { className: 'dpc-root' }, ['面板启动失败：' + message]))
        } catch {}
      }
    }

    function ProjectCostSection() {
      return h('div', { ref: mountHost, className: 'dpc-root' }, '正在加载项目花费…')
    }

    /**
     * 模块级渲染循环：拿到节点后立刻画首屏并拉数据，之后定时刷新。
     * 与 React 生命周期解耦，组件重渲染不会打断这里。
     */
    let painterCtx = null

    function startPainter(hostNode) {
      const state = { data: null, error: null, loading: true, busy: false, locale: pickLocale(), load: null }
      const findHost = () => (hostNode && hostNode.isConnected !== false ? hostNode : null)

      const repaint = () => {
        const host = findHost()
        if (host === null) return
        try {
          paintPanel(host, state)
        } catch (error) {
          // 画不出来也要说清原因，绝不静默空白。
          const message = error instanceof Error ? error.message : String(error)
          try {
            clearNode(host)
            const t = makeTranslate(state.locale)
            host.appendChild(
              el('div', { className: 'dpc-root' }, [
                el('h2', { className: 'dpc-title', text: t('title') }),
                el('div', { className: 'dpc-err', text: `面板绘制失败：${message}` }),
                el('div', { className: 'dpc-foot', text: `接口仍可用：/${API_OVERVIEW}` }),
              ]),
            )
          } catch {}
        }
      }

      const load = async (fresh) => {
        try {
          state.busy = true
          repaint()
          const url = fresh ? `${API_OVERVIEW}?fresh=1` : API_OVERVIEW
          const init = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? { signal: AbortSignal.timeout(30000) } : undefined
          const response = await fetch(url, init)
          if (!response || !response.ok) throw new Error(`HTTP ${response ? response.status : '无响应'}`)
          const body = await response.json()
          if (!body || body.ok !== true || !body.overview || typeof body.overview !== 'object') {
            throw new Error((body && body.error) || '接口返回了空数据')
          }
          state.data = body.overview
          state.error = null
        } catch (error) {
          state.error = error instanceof Error ? error.message : String(error)
        } finally {
          state.loading = false
          state.busy = false
          repaint()
        }
      }
      state.load = load

      // 节点已经拿到（ref 回调给的），立刻画首屏并拉数据。
      state.loading = true
      repaint()
      void load(false)

      // 数据刷新（含手动刷新按钮的闭包在 paintPanel 里，指向 state.load）
      const refreshTimer = setInterval(() => {
        if (!document.hidden && findHost() !== null) void load(false)
      }, 60000)

      // 语言切换：直接重画。
      const localeDispose = (() => {
        try {
          const service = painterCtx?.locale
          if (typeof service?.subscribe === 'function') {
            return service.subscribe(() => {
              state.locale = pickLocale()
              repaint()
            })
          }
        } catch {}
        return () => {}
      })()

      return () => {
        clearInterval(refreshTimer)
        try {
          localeDispose()
        } catch {}
      }
    }

    // ───────────────────── 插件注册 ─────────────────────
    function apply(ctx) {
      pluginCtx = ctx
      painterCtx = ctx

      ctx.effect(() => {
        const style = document.createElement('style')
        style.dataset.dshPlugin = NS
        style.textContent = STYLE
        document.head.appendChild(style)
        return () => {
          try {
            style.remove()
          } catch {}
        }
      }, 'project-cost: styles')

      const label = () => DICT[pickLocale()].title

      painterCtx = ctx

      ctx.effect(
        () =>
          ctx.slots.inject('settings.section', () =>
            ctx.slots.register(
              { name: 'settings.section', id: SECTION_ID, order: SECTION_ORDER, label },
              ProjectCostSection,
            ),
          ),
        'project-cost: settings section',
      )
    }

    const inject = ['slots']
    return { inject, apply }
  },
})
