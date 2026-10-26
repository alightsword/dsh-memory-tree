# Changelog

本项目遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

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
