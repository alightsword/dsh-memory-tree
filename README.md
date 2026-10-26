# dsh-memory-tree

DSH 原生插件，给模型加**跨会话三级记忆**（瞬时 L1 / 短时 L2 / 长时 L3），并在写入路径上做**冲突拦截**。一条新表达如果跟现有规矩矛盾，在用户确认之前不会进长时记忆。

> 开发预览：本插件针对 `@deepseek-ai/dsh >= 0.2.1-rc.3` 编写。预览版 API 会在 release candidate 之间重命名字段，升级宿主前请重新核对关键名。

## 真实 API 校准说明

需求文档写的是概念接口，实际 `0.2.1-rc.2` 的 API 跟它有几处对不上，实现已经按真实 API 校准：

| 需求文档描述 | 真实 API（0.2.1-rc.2） |
|--------------|------------------------|
| `ctx.systemPrompt.section({ name, order: 50 })` | `section({ name, order, text, complete? })`，内容字段是 `text`，且 `complete` 是 section 级字段 |
| `complete: true` 检测 | 检查名为 `deployment:persona` 的 section，常量 `PERSONA_SECTION`，取它的 `complete` 字段 |
| `session/created` 事件 | 实际事件是 `agent/session-start`，payload 含 `agent` 实例；写回用 `agent/turn-stopping` |
| `agent/pre-step` + "sourced message" | 实际是 `agent/pre-step` 事件 + `(payload, next) => Promise<PreStepDecision>`：调 `next()` 拿消息批次，把召回内容**追加**到 `decision.messages`，`source.kind: 'plugin:xxx'` + `source.form: 'recall'`，这是 V4 producer-owned kind |
| `defineTool` 单参 `execute(args)` | 实际 `execute(args, exec: ToolRunContext)` 双参；`output.render(args, value)` 返回 `ContentBlock[]`（`{ type: 'text', text }`） |
| 参数 schema JSON-schema 风格 | 实际是 schemastery 风格 `ParameterSchemaSpec`（`{ type, required: true, enum, description }`） |

### Client 半边（浏览器）

client 面板以标准 `dsh.client` bundle 格式加载，与 dsh-meme 同款。实际踩坑后确认的硬性约定：

| 约定 | 说明 |
|------|------|
| `exports.inject` | client 必须导出 `inject` 数组声明所需服务，这里声明 `['slots']`；缺了它宿主不会注入 slots |
| 服务访问 | 用 `ctx.get('slots')`，不是 `ctx.slots`。服务在 cordis 容器里，不在 ctx 属性上 |
| 注册方式 | `slots.inject(owner, () => slots.register(...))`，不是裸 `slots.register` |
| slot 名 | 设置页 slot 是 `settings.section`，不是 `domain.settings.card` |
| React | 走 `require('react')` 从浏览器模块表拿，不打包进产物（`--external:react`） |
| 产物格式 | `window.__ModuleLoader__.load({ id: 'dsh-memory-tree', factory: (require) => {... return module.exports }})`，factory 必须返回插件 surface |

`src/client/index.tsx` 由 esbuild 单独编译（`--format=cjs` + ModuleLoader 包装），不参与 tsc（避免 DOM lib 冲突）。

## 关键实现校准

下面这几个问题，都是**实际运行测试**才暴露出来的，光靠类型检查发现不了，务必保留：

| 问题 | 现象 | 修复 |
|------|------|------|
| **`dsh-tools` 版本选错** | `npm view @deepseek-ai/dsh-tools` 的 `latest` tag 停在 `0.0.1-rc.1`，但其产物 import 的 `CallId` 等命名导出在 `dsh-llm@0.2.1-rc.2` 里已移除，Node 原生 ESM 加载直接报 `SyntaxError` | 精确锁定与 `dsh` 同步的版本（当前 `0.2.1-rc.3`），**不用 `^` 前缀**。用 `^` 会漂到下一个 rc，其 peer 要求对应的 dsh-agent，导致 ERESOLVE |
| **中文否定词 `\b` 失效** | `/\b(不|不要|讨厌)\b/` 在 JS 里 `\b` 对中文（非 `\w`）不生效，所有中文否定词检测全失效，冲突漏检 | 中文 alternation 去掉 `\b`，仅英文保留 `\b` |
| **Node ESM 需要 `.js` 后缀** | `moduleResolution: "Bundler"` 允许省略扩展名，但 `lib/*.js` 被 Node 原生 ESM 加载时 `Cannot find module './types'` | 改用 `moduleResolution: "NodeNext"`，所有相对 import 显式加 `.js` |
| **`execute` 返回严格 `JsonValue`** | `dsh-tools@0.2.1-rc.2` 的 `execute` 要求返回 `JsonValue`，含 `undefined` 可选字段或 `MemoryNode[]` 会报类型错 | 工具返回值统一经 `json()`（`JSON.parse(JSON.stringify(x))`）规范化 |

## 对标参考：vectorize-io/hindsight

本插件与 [Hindsight](https://github.com/vectorize-io/hindsight)，也就是 `hindsight-integrations/coding-agents` 这个仓库，做的都是「DSH 原生插件做跨会话记忆」。实现时参考了它的生产级代码，采纳和没采纳的决策列在下面：

| Hindsight 做法 | 本插件决策 |
|----------------|-----------|
| pre-step 召回用 `agent/pre-step` + `next()` 追加 `decision.messages`，`source.form: 'recall'` | ✅ 采纳，原本误用 `agent/inbox/claimed` + `agent.inject`，已修正 |
| 写回用 `agent/turn-stopping`，不是 disposed | ✅ 采纳 |
| `source.kind: 'plugin:hindsight'`，V4 producer-owned kind | ✅ 采纳，改为 `plugin:dsh-memory-tree` + `form` |
| **完全不 import dsh 包**，用 `toDshParameters` 自拼 schema、结构类型 | ❌ 未采纳：保留 `@deepseek-ai/dsh-tools`（与 `dsh` 同步锁定），换取 `defineTool` 的类型安全与参数校验。这是已知权衡，若未来 dsh 版本再漂移，可退回到 Hindsight 的零依赖方案 |
| `inject: ['agents']` + `ctx.inject(['tools'], ...)` | 部分采纳：`inject` 保留 `['tools','systemPrompt','agents']`，诚实声明依赖；工具仍走 `ctx.tools.register` |

## 为什么是插件而不是 Skill

Skill 是文本指令，模型可以绕开。写入前拦截必须落在**工具代码路径**里，模型绕不过去。这是选插件形态的核心理由，见需求文档 §五-3。

## 三级记忆模型

| 层级 | 名称 | 生命周期 | 是否参与路由 | 是否冲突检测 |
|------|------|----------|--------------|--------------|
| L1 | 瞬时 | 进程内/会话内，不持久化 | 否 | 否 |
| L2 | 短时 | 持久化 buffer + 冲突候选队列 | 否 | 否 |
| L3 | 长时 | 持久化 rules / facts | 是 | **是** |

## 三条硬约束

1. **写入前拦截**：`memory_add` / `memory_replace` 命中现有 active 规矩的相反表达时，**永不直接写 L3**，只返回 `{ status: "pending_conflict", conflict_id, question }`。唯一能把新表达写进 L3 的路径，是用户通过 `memory_resolve` 确认。
2. **两条注入通道互不干扰**：
   - 通道一，冻结快照：`session/created` 读 `ROOT.md` + active 规矩，经 `ctx.systemPrompt.section({ name: "plugin:memory-context", order: 50 })` 注入。轮内不更新，保 prefix cache。
   - 通道二，pre-step 召回：每条用户消息后，用 ≤5 条线索查 `cue_index.json`，取 top-3 summary，以 sourced message 注入。不走 systemPrompt，不受 complete 模式影响。
3. **complete: true 降级**：检测到当前会话 persona section 带 `complete: true` 时，通道一自动停止，否则注入会静默丢失；通道二照常工作。`decision_log` 记 `snapshot_skipped: complete_mode`。

## 目录结构

```
dsh-memory-tree/
├── package.json              # 声明 dsh.bundle + dsh.client，exports['./client']
├── src/
│   ├── index.ts              # apply(ctx, config)，注册钩子与工具
│   ├── lifecycle.ts          # session/created、session/flush、session/disposed、agent/pre-step
│   ├── snapshot.ts           # 冻结快照构建 + 注入 + complete 检测
│   ├── recall.ts             # pre-step 召回 + 冲突 reminder
│   ├── conflict.ts           # scope 重叠 + 语义相反检测，写入路径拦截
│   ├── forgetting.ts         # 幂律衰减 + 归档，fail-open
│   ├── store.ts              # 文件系统持久化层
│   ├── types.ts              # 共享类型 + 默认配置
│   └── tools/
│       ├── memory_add.ts
│       ├── memory_replace.ts
│       ├── memory_recall.ts
│       ├── memory_show.ts
│       └── memory_resolve.ts
└── src/client/index.tsx      # 设置卡片
```

## 工具清单

| 工具 | 说明 |
|------|------|
| `memory_add` | 新增记忆。`target: "l2"` 为默认，不冲突检测；`"l3"` 则冲突检测后决定写入或返回 pending_conflict |
| `memory_replace` | 替换已有 L3 节点 statement，冲突检测同上 |
| `memory_recall` | 按 cues 召回 top-K summary |
| `memory_show` | 查看记忆状态；`refresh: true` 显式重建快照 |
| `memory_resolve` | 解决冲突：`replace` / `scope_split` / `reject`，其中 `scope_split` 可传 `new_scope` 收窄 candidate 范围 |

## 冲突检测策略

`conflict.ts` 采用 **规则优先 + LLM 兜底**：

- **规则层**，零成本：否定词表（不要/禁止/严禁/never/must not…）+ 反义 token 对（喜欢↔讨厌、深色↔浅色、开启↔关闭…）+ 词法重叠度（Jaccard over CJK bigram + latin token）。高置信度直接判。
  - 单字「不」按「不 + 动词/形容词」识别为否定，但「不错/不得不/不明/不仅」等固定非否定词进黑名单，避免误报。
- **LLM 兜底**：规则信号落在低置信度区间，也就是有反义词但内容重叠薄，调 `ctx.llm.complete` 做一次轻量语义相反判断。
- **scope 重叠**：任一 scope 为空视为全域重叠，否则取交集。

## 幂律遗忘

`forgetting.ts`：`R(t, S) = (1 + F*t/S) ** -0.5`，`weight = R × base_weight`。
归档只针对 `status: active` 且 `source != confirmed` 的节点。治理失败 **fail-open**，记日志，不阻塞对话。

## 安装与开发

```bash
# 本地 scratch 验证（单文件，无构建）
dsh web --patch ./scratch-plugin/cordis.yml

# 构建（tsc 编译到 lib/）
npm install
npm run build

# 类型检查
npm run typecheck

# 端到端测试（mock DSH Context 真实调用 apply，14 组场景 52 断言）
npm test

# 安装到测试 profile（桌面端 profile 由 Electron 独占管理，须在应用内或手动装）
dsh plugin --profile demo add ./dsh-memory-tree
dsh --profile demo --dump-config
dsh --profile demo
```

## 验收标准

1. **冲突拦截**：现有 confirmed 规矩 A + `memory_add(target:'l3')` 写入与 A 相反的候选 → 返回 pending_conflict、L3 无新节点、旧规矩仍 active、conflict 入队。
2. **resolve 路径**：`replace` → 旧 superseded、新 active、`snapshot_stale.flag` 存在；`scope_split` → 两条 active 且 scope 不重叠；`reject` → 新候选不写入 L3。
3. **快照不破 cache**：同会话多轮通道一注入内容不变；resolve 后本会话快照不变；下一次 `session/created` 快照更新。
4. **complete 模式**：带 `complete: true` 的 persona → 通道一跳过、通道二照常、decision_log 记 snapshot_skipped。
5. **冲突 reminder 兜底**：pending_conflict 后模型不提问，下一轮 pre-step 注入 reminder；连续 3 轮未解决 reminder 持续出现。
6. **fail-open**：治理任务抛错时对话正常继续，decision_log 有错误记录。

## 已知权衡

1. **快照滞后**：本会话内确认的规矩变更，系统提示词层面下次会话才生效，pre-step 召回层面立即生效。这是保 prefix cache 的代价。
2. **冲突检测漏检**：语义相反判断依赖规则 + 轻量模型，措辞差异大时可能漏检。`ROOT.md` 生成时的两两一致性检查是兜底第一道防线。
3. **Skill 做不到、插件才做得到**：写入前拦截是工具代码路径的一部分，模型绕不过去。将来若抽成 MCP，这条防线会失效，需要重新评估。

## 配置

- 遗忘档位 `forgetting_tier`，取值 gentle / normal / aggressive
- P1 提问开关与文案 `p1_question_enabled` / `p1_question_copy`
- 日志开关 `logging_enabled`
- 召回 top-K `recall_top_k`

其余只读展示，标注「高级配置，后续版本开放」。
