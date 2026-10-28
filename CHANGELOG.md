# Changelog

本项目遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [0.4.2] - 2026-10-28

### 修复

- **面板 API 空响应**：上一版把 `webServer` 从顶层 `inject` 移除、改用 `ctx.inject(['webServer'], cb)`，但 cordis 的 `ctx.inject(deps, callback)` 语义是「callback 作为函数插件，首参是注入后的 Context、而非服务本身」——上一版误把首参当 webServer，导致面板 API 从未注册，前端报 `Failed to execute 'json' on 'Response'`。已修正：`webServer` 恢复为顶层 `inject`（桌面/web 宿主必提供），apply 内用 `ctx.webServer` 直接访问（对齐 dsh-web-app 与 feiyu-memory 的既有用法）；`llm` 仍走 `ctx.inject(['llm'], cb)` 可选注入，但回调正确从 `injectedCtx.get('llm')` 取服务。同时修正 e2e mock 的 `inject` 语义（回调首参为 Context），使测试与真实 cordis 一致。

### 变更（面板 UI 打磨）

- **深色主题可读性**：移除所有写死的 `#fff` 与「品牌色填充」，根节点、视图切换按钮等从「浅底浅字」改为「深底 + 品牌色边框 + 亮色文字」，全部文字/背景改用 `--dsw-alias-*` 主题 token，自动适配深/浅色主题。
- **滚动**：树状视图加横向滚动（`overflowX: scroll`）+ 纵向滚动（`maxHeight: 420`）；Panel 最外层加 `height: 100%` + `overflowY: auto`，列表视图记忆卡片多时可滚到底。
- **列表视图返回入口**：进入列表视图后顶部加「← 返回树状」按钮，点击叶子跳转后可一键回到树状图。
- **叶子文字不再溢出**：节点宽度 120→132、高度 30→32，叶子截断 16→12 字，避免文字溢出卡片。

## [0.4.1] - 2026-10-28

### 修复

- **可选服务导致 headless 不激活**：原 `inject` 把 `webServer` / `agents` / `llm` 声明为必选依赖，但 headless/CLI 环境没有 `webServer` 服务，导致整个插件停在 `pending (waiting for service: webServer)`，host 半边（记忆工具 + 冲突拦截）全部失效。已改为：顶层 `inject` 只保留 `['tools','systemPrompt']`，`llm` 与 `webServer` 改用 `ctx.inject(['llm'|'webServer'], cb)` 做可选注入——服务存在才执行对应逻辑，缺失时插件照常激活。实测 headless 环境 `[dsh-memory-tree] plugin loaded` 正常打印、无报错。

### 变更

- e2e 新增 [21] 可选服务降级场景（无 webServer 时工具仍注册、无面板路由），79 → 83 断言。

## [0.4.0] - 2026-10-28

### 新增

- **记忆树状可视化**：侧边栏面板新增「树状 / 列表」视图切换。树状视图用纯 SVG 手绘四层结构（根「记忆树」→ 规矩/事实 → scope 分组 → 记忆节点），hover 叶子显示全文，点击叶子切换到列表并滚动定位到对应卡片。零第三方依赖（DSH 客户端插件禁止引入 d3/react-flow/echarts 等前端库，加载会空白 slot）。

## [0.3.0] - 2026-10-28

### 修复

- **LLM 兜底死代码**：原 `llmOpposition` 调用 `ctx.llm.complete()`，但 DSH 的 `llm` 服务（`LlmRuntime`）根本没有 `complete` 方法，只有 `stream(options)`。该调用经 `(ctx as any)` 绕过类型检查且运行时永远走降级分支，等于死代码。已改为通过 `ctx.get('llm')` 获取真实服务，用 `stream()` 拼接文本做语义相反判断；`llm` 加入 `inject` 作为可选服务，缺失或调用失败时降级为纯规则检测（规则层仍是主路径）。

### 新增

- **记忆去重**：`memory_add(target:'l3')` 写入前做词法去重，与 active 节点重叠度 ≥ 0.5 时返回 `{ status: "duplicate", dup_of }`，不重复写入。
- **L2 → L3 自动晋升**：新增 `promotion.ts`，在 `agent/turn-stopping` 时扫描 L2 buffer，把词法重叠 ≥ 0.6 且出现 ≥ 2 次的语句聚簇，走冲突检测后写入 L3（冲突则入 pending 队列）；晋升节点继承 buffer 原始 type（rule/fact）。fail-open。
- **召回质量升级**：`extractCues` 改为停用词过滤 + 长 token 优先 + 去重；召回匹配从「子串包含」升级为「bigram Jaccard 重叠 + 精确子串加权」，能命中改写过的 cue。

### 变更

- `lexicalOverlap` 提取为 `tools/helpers.ts` 共享工具，conflict / promotion / de-dup 三处复用，消除重复实现。
- `inject` 从 `['tools','systemPrompt','agents','webServer']` 增为含 `'llm'`（可选）。
- 清理 `src/` 与根目录下 40+ 个 `.bak` 残留文件（Editor 工具产生，未被 git 跟踪）。
- README 修正陈旧描述：版本号统一为 `0.2.1-rc.3`、断言数 52 → 69、LLM 兜底说明改为真实 `stream()` API，补充去重与晋升两节。

### 测试

- e2e 新增 4 组场景：去重、L2→L3 晋升、cue 提取、LLM 兜底（真实 stream 链路），69 → 79 断言。

## [0.2.1] - 2026-10-26

### 新增

- **面板可视化改造**（参考 feiyu-memory）：概览行「本地存储 · N 条 · 认识 N 天」；L3 记忆卡片流（相对时间 + scope 标签 + 已确认标记）；相对时间显示（刚刚/N 分钟前/昨天/N 天前）。
- **用户自录入**：面板内手动记一条（statement + 类型 + 可选 scope），写入 L3 并标记 confirmed。
- **行内编辑**：每张卡片可「改」statement，保存后快照标 stale。
- **二段确认删除**：点「忘掉」→「确定忘掉？忘掉 / 算了」行内确认，不弹窗。
- host 新端点：`POST /note`（自录入）、`POST /edit`（编辑）；state 端点补充 `first_seen`。
- e2e 补 panel API 全链路断言（note/edit/forget/state），52 → 69 条。

## [0.2.0] - 2026-10-26

### 新增

- **侧边栏面板**（feiyu-memory 同款双 slot）：`sidebar.panellist` + `main`，展示三层记忆 + agent 决策日志。
- **分层记忆视图**：L1 瞬时层（快照状态）/ L2 短时层（buffer + 冲突候选）/ L3 长时层（规矩/事实），保留插件的分层记忆核心特点。
- **用户可操作**：删除 L3 节点（`POST /dsh-memory-tree-api/forget`）、刷新面板。
- **agent 决策日志展示**：完整决策日志（`GET /dsh-memory-tree-api/state`）。
- **schemastery Config schema**：配置项从 5 项扩到 9 项，DSH 设置页自动生成可编辑表单。

### 变更

- host webServer API 从单端点拆为多端点：`/state`（分层+日志+配置）、`/forget`（删除）。
- `MemoryStore` 新增 `deleteL3Node`、`readDecisionLog` 方法。

## [0.1.1] - 2026-10-26

### 修复

- **client 半边违反 DSH client bundle 规范，导致桌面端启动失败**。重写为对齐 dsh-meme 的标准格式：导出 `inject` 数组、`ctx.get('slots')` 访问服务、`slots.inject(...)` 包装注册、`settings.section` slot、React 走 `require('react')`。
- client 产物改用 esbuild `--format=cjs` + `window.__ModuleLoader__.load` 包装，factory 返回插件 surface（此前 IIFE 无返回值导致 `invalid plugin, received undefined`）。
- `src/client` 从 tsc 编译剥离（esbuild 单独编译），避免 DOM lib 冲突。

### 变更

- 依赖对齐 `dsh` / `dsh-tools` 到 `0.2.1-rc.3`（与桌面端宿主一致）。
- 移除过时的 `renderSettingsCard` 导出与 `dsh-client-runtime` 软依赖说明。

## [0.1.0] - 2026-10-26

### 新增

- 跨会话三级记忆：L1 瞬时（快照冻结标记 + 召回结果）、L2 短时（buffer + 冲突队列）、L3 长时（持久化规矩/事实）。
- 写入前冲突拦截：`memory_add` / `memory_replace` 命中相反表达时返回 `pending_conflict`，绝不直接写 L3。
- 两条注入通道：通道一冻结快照（`systemPrompt.section`）、通道二 pre-step 召回（`agent/pre-step` + `decision.messages` 追加）。
- `complete: true` 降级：检测 `deployment:persona` section 的 `complete` 字段，通道一自动停止、通道二照常。
- 5 个工具：`memory_add` / `memory_replace` / `memory_recall` / `memory_show` / `memory_resolve`。
- `memory_resolve` 三路径：`replace` / `scope_split`（支持 `new_scope` 收窄范围）/ `reject`。
- 幂律遗忘治理（fail-open）：按遗忘因子衰减权重，低于阈值归档。
- client 设置面板（四区块：人格状态 / 日志 / 深层记忆 / 配置）。

### 修复

- 中文否定词 `\b` 边界失效导致漏检。
- 单字「不」误报：不错/不得不/不明/不仅等固定词进入黑名单。
- 反义维度补齐：深色↔浅色、自动↔手动等。
- `scope_split` 逻辑死路：新增 `new_scope` 参数 + disjoint 校验。
