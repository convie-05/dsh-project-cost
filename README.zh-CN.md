# dsh-project-cost

**在 DeepSeek Harness 里按「项目」看 Token 花费。**

[English](README.md) | 中文

DSH 没有「项目」这个对象 —— 但每个会话都带着一个终身不变的工作目录（`cwd`）。
本插件把**每个 `cwd` 当作一个项目**，把该目录下所有会话的 token 用量折进去，
让你一眼看出钱到底花在哪个目录上。

> **为什么还要一个用量插件？** DSH 已有不错的用量面板（`dsh-usage`、`dsh-cost-meter` 等），
> 但它们都按**天 / 厂商 / 模型**聚合，没有一个回答「*这个仓库*花了我多少钱」。
> 这个插件只补这一个维度。

---

## 你会得到什么

设置里新增一页 **设置 → 项目花费（Token）**：

- **四张汇总卡** —— 全部项目合计 token、今日 token、真实花费、项目数 / 会话数
- **每个项目一行** —— 名称 + 完整路径、会话数、累计 tokens（带占比条）、今日 tokens、真实花费、最近活跃日期
- **点任意一行展开**：
  - 输入 / 输出 / 缓存读 / 缓存写 / 推理 分桶
  - 活跃日期区间
  - 一键复制工作目录
  - **该项目最贵的 10 个会话**（标题、token、该会话金额、日期）
- **刷新**按钮强制重扫；面板可见时每 60 秒自动刷新
- **`project_cost_report` Agent 工具** —— 直接问模型「哪个项目最烧钱」，它自己来查

---

## 数据来源

全部只读，且逐级降级 —— 每个来源都是可选的。

| 来源 | 提供 | 缺失时 |
| --- | --- | --- |
| `$DSH_HOME/storages/session_projcache/sessions/*.json`（DSH 自己的会话投影缓存） | **累计 token**（跨天全量） | 没有任何数据 |
| `$DSH_HOME/storages/cost-meter/ledger.json`（[`dsh-cost-meter`](https://github.com/Han-1413141/dsh-cost-meter) 账本） | **真实扣款金额** + 精确的今日用量（按会话记账） | 金额列留空，今日列回退 |
| `$DSH_HOME/dsh-usage/usage-ledger.json`（[`@linxin666/dsh-usage`](https://www.npmjs.com/package/@linxin666/dsh-usage) 台账） | 今日 / 近 N 天 token 合计（兜底） | 用 cost-meter，或显示 0 |
| 通过 `ctx.sessions` + `ctx.sessionProjections` 读 live 会话 | 尚未落盘到缓存的会话 | 数据略旧 |

> **为什么不直接解析会话日志？** `sessions/**/session.v4.jsonl.zstd` 需要 zstd 解压 +
> 逐事件折叠，比读投影缓存慢约 3 倍，得到的数字却一样。投影缓存本身就是全量历史。

有真实账本时**不做估算**：`dsh-cost-meter` 按会话记录 `costCny`，面板显示的就是它。
只有在拿不到账本时，才用「token × 你配置的单价」估算。

---

## 安装

### 通过 DSH 插件管理器（推荐）

1. 打开 **设置 → 插件 → 添加本地 bundle**
2. 选择本目录
3. 重启宿主半边（客户端半边刷新页面即可）

### 通过命令行

```bash
dsh plugin --profile <你的profile> add link:/绝对路径/dsh-project-cost
```

包内已声明 `dsh.bundle.patch`，安装后立即出现在插件树里。

---

## 配置

所有设置都是可选的 —— 不配置也能正常工作。

> **为什么不导出 `Config` Schema。** 本插件**刻意不导出** `Config` 对象。
> 某些 DSH 版本在激活导出了 `Config` 的插件行时会抛
> `Cannot read properties of undefined (reading 'validate')`，导致整行加载失败。
> 所以配置直接从 loader 传给 `apply(ctx, config)` 的 `config:` 块读取，
> 每个字段在代码里做范围收敛 —— 写错值会被忽略，不会让插件崩。

在 profile 的 `cordis.patch.yml` 里给插件行加 `config:`：

```yaml
- insert:
    - id: project-cost
      name: dsh-project-cost
      config:
        pricePerMillion: 2          # 仅在拿不到账本时用于估算
        priceUnit: cny              # cny | usd
        recentDays: 30
        includeLiveSessions: true
        pathAliases: |
          C:/Users/me/Downloads/scratch=插件开发区
          D:/lab=研究区
```

| 键 | 默认 | 含义 |
| --- | --- | --- |
| `dshHome` | *(自动)* | DSH 数据根目录。留空依次尝试 `$DSH_HOME`、`~/.dsh`。WSL / 便携版 / 自定义 profile 时填这里。 |
| `costMeterPath` | *(自动)* | 显式指定 `dsh-cost-meter` 账本路径。留空自动探测常见位置。 |
| `pricePerMillion` | `0` | 每百万 token 单价，用于估算。`0` = 不估算。 |
| `priceUnit` | `cny` | `pricePerMillion` 的币种。 |
| `recentDays` | `30` | 「近 N 天」口径。 |
| `includeLiveSessions` | `true` | 是否计入仍在运行、尚未落盘的会话。 |
| `pathAliases` | *(空)* | 项目改名，每行 `路径=显示名`，`~` 展开为用户目录。 |

---

## Agent 工具

插件注册了一个只读工具：

```
project_cost_report({ limit: 20 })
```

```
6 个项目 · 累计 1.90B tokens · 今日 88.6M · 花费 ¥321.09（8,815 次调用）

· 新建文件夹  1,444,823,088 tokens · 121 会话 · 今日 80,926,029 · ¥191.10 · C:\Users\me\Downloads\scratch
· HP            252,238,803 tokens ·   3 会话 · 今日  2,444,126 · ¥100.98 · C:\Users\me
...
```

---

## 本机 HTTP 路由

仅限回环地址（`127.0.0.1` / `localhost` / `[::1]`），其它主机一律 `403`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/dsh-project-cost/api/overview` | 聚合文档。`?fresh=1` 强制重扫。 |
| `GET`/`POST` | `/dsh-project-cost/api/refresh` | 强制重扫。 |

每次扫描后会写一份快照到 `$DSH_HOME/storages/project-cost/overview.json`，
冷启动时面板可以立即出结果，不用等扫描。

---

## 客户端渲染方式

面板采用一个刻意保守的模式：**React 只提供挂载点，内容全部由原生 DOM 绘制。**

```js
function ProjectCostSection() {
  return h('div', { ref: mountHost, className: 'dpc-root' }, '加载中…')
}

function mountHost(node) {
  if (node.__mounted) return
  node.__mounted = true
  startPainter(node)   // 以下全部是原生 DOM
}
```

两个原因：

1. **渲染期抛错会让整个 slot 静默变空白。** slot 仍然报 `active: true`，但用户什么也看不到，
   console 也没有明显报错。把绘制移出渲染路径后，数据层的 bug 会显示一条错误文字，而不是让面板消失。
2. **这个客户端运行时里没有 `React.Component`。** `class X extends React.Component`
   会在**模块加载期**抛错（`extends undefined`），导致整个客户端 bundle 失效。
   函数组件 + `ref` 回调完全绕开这一点。

`useState` / `useEffect` / `useRef` 这些 hooks **是可用的** —— 本项目早期误判过一次，
这个错误记录在代码注释里。当前模式是为了稳健，不是因为 hooks 坏了。

---

## 已知限制

- **项目 = 目录。** 同一 `cwd` 下的所有会话算一个项目，无法把一个目录拆成两个项目（只能用 `pathAliases` 改名）。
- 金额来自 `dsh-cost-meter`。没装（或它漏记了某次调用）时，该行金额为 `0`。
- 投影缓存里的 `tokenUsage` 是跨天累计值；「天」这个维度依赖按日账本。
- 归档或删除会话会改变投影缓存，数字随之变化。
- 插件直接读磁盘文件，不经过 DSH 服务获取用量数据 —— 所以路径做成了可配置。
- 不导出 `Config` Schema（见上方「配置」），所以插件行不会生成自动设置表单，配置走 `cordis.patch.yml`。

---

## 相关项目

| 项目 | 与本插件的关系 |
| --- | --- |
| [`dsh-cost-meter`](https://github.com/Han-1413141/dsh-cost-meter) | 本插件真实金额的来源 |
| [`@linxin666/dsh-usage`](https://www.npmjs.com/package/@linxin666/dsh-usage) | 按天/厂商/模型的用量台账（兜底来源） |
| [`ccusage`](https://github.com/ccusage/ccusage) | 优秀的 Claude Code 用量 CLI —— 按天/会话聚合，不按项目 |
| [`TokenTracker`](https://github.com/xiufengsun/TokenTracker) | 本地优先的用量追踪器，支持 DeepSeek Harness，但按会话文件组织，不按 `cwd` |
| [`claudit`](https://github.com/Nitjsefnie/claudit) | 按项目归因，但只支持 Claude Code |
| [`tokenmeter`](https://github.com/aidevksh/tokenmeter) | 按目录统计，但只支持 Claude Code |

---

## 许可

MIT
