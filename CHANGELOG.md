# Changelog

本项目遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

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
