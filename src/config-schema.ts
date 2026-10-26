/**
 * config-schema.ts — schemastery Config schema for the settings page.
 *
 * The schema drives the auto-generated settings form in the DSH plugin
 * manager (same mechanism as dsh-m). Values also resolve through
 * cordis.patch.yml's `config:` block; the schema only adds the editable
 * form on top, it is not required for the plugin to run.
 *
 * NOTE: fields are intentionally NOT marked `.volatile()`. Volatile wraps the
 * value in a live reference object, which would leak into `apply()`'s raw
 * config and require unwrapping. Plain fields keep `Config(dict)` returning
 * plain values while still feeding the generated form.
 */

import Schema from '@deepseek-ai/schemastery'

export const Config = Schema.object({
  forgetting_tier: Schema.union(['gentle', 'normal', 'aggressive'] as const)
    .default('normal')
    .description('遗忘档位：gentle 慢 / normal 中 / aggressive 快'),
  forgetting_factor: Schema.number()
    .default(0)
    .description('自定义遗忘因子（0 = 使用档位预设）'),
  archive_threshold: Schema.number()
    .default(0.15)
    .description('归档阈值：衰减后权重低于此值则归档'),
  recall_top_k: Schema.number()
    .default(3)
    .description('召回 top-K 条线索'),
  snapshot_budget_chars: Schema.number()
    .default(2000)
    .description('快照注入预算（字符数）'),
  p1_question_enabled: Schema.boolean()
    .default(true)
    .description('冲突时是否向用户提问确认'),
  p1_question_copy: Schema.string()
    .default('检测到与新表达相矛盾的已有规矩，请确认是否替换/划分范围/拒绝：')
    .description('冲突提问文案'),
  logging_enabled: Schema.boolean()
    .default(true)
    .description('是否记录决策日志'),
  base_dir: Schema.string()
    .default('')
    .description('记忆存储目录（空 = $DSH_HOME/memory-tree）'),
})
