import type {
  ComponentKind,
  ComponentScope,
  DataFieldType,
  EvidenceSupport,
  FlowKind,
  ReviewStatus,
  Verification,
} from './model'

/**
 * Chinese business vocabulary for Schema enums.
 *
 * Schema values stay English everywhere in data and code; only display text is
 * translated, and the original configuration is never rewritten
 * (DESIGN.md 7.2, 16.3). These maps are pure data so both the projection layer
 * (aggregate edge labels) and the UI can use them.
 */

export const FLOW_KIND_LABEL: Record<FlowKind, string> = {
  command: '命令',
  measurement: '测量',
  state: '状态',
  event: '事件',
  control: '控制量',
  actuation: '执行输出',
  feedback: '反馈',
}

export const VERIFICATION_LABEL: Record<Verification, string> = {
  conflict: '存在冲突',
  inferred: '推断',
  docs_only: '仅文档',
  code_confirmed: '代码已确认',
  docs_and_code_confirmed: '文档与代码已确认',
  human_verified: '人工已评审',
}

/** Extra wording so colour is never the only way to read a status (16.2). */
export const VERIFICATION_SHORT_LABEL: Record<Verification, string> = {
  conflict: '冲突',
  inferred: '推断',
  docs_only: '仅文档',
  code_confirmed: '代码确认',
  docs_and_code_confirmed: '文档+代码',
  human_verified: '人工评审',
}

export const COMPONENT_KIND_LABEL: Record<ComponentKind, string> = {
  system: '系统',
  actor: '参与者',
  physical_device: '物理设备',
  capability_domain: '能力域',
  input_adapter: '输入适配',
  dispatcher: '分派',
  mode: '飞行模式',
  mission_executor: '任务执行',
  navigator: '导航',
  estimator: '状态估计',
  controller: '控制器',
  mixer: '混控',
  output_adapter: '输出适配',
  safety_monitor: '安全监控',
  policy: '策略',
}

export const SCOPE_LABEL: Record<ComponentScope, string> = {
  internal: '内部',
  external: '外部',
}

export const REVIEW_STATUS_LABEL: Record<ReviewStatus, string> = {
  draft: '草稿',
  schema_validated: 'Schema 已校验',
  evidence_checked: '证据已核对',
  human_reviewed: '人工已评审',
}

export const EVIDENCE_SUPPORT_LABEL: Record<EvidenceSupport, string> = {
  direct: '直接支持',
  contextual: '上下文支持',
  contradictory: '矛盾证据',
}

export const TRANSPORT_LABEL: Record<string, string> = {
  hardware_io: '硬件 IO',
  shared_state: '共享状态',
  virtual_call: '虚调用',
  direct_call: '直接调用',
  direct_setter: '直接赋值',
  internal_state: '内部状态',
  conceptual: '概念性',
}

export const CADENCE_KIND_LABEL: Record<string, string> = {
  periodic: '周期执行',
  event_driven: '事件驱动',
  on_change: '变化触发',
  continuous: '连续',
}

export const FIELD_TYPE_LABEL: Record<DataFieldType, string> = {
  boolean: '布尔',
  integer: '整数',
  number: '数值',
  string: '字符串',
  enum: '枚举',
  vector2: '二维向量',
  vector3: '三维向量',
  quaternion: '四元数',
  object: '对象',
}

export const SOURCE_KIND_LABEL: Record<string, string> = {
  source_code: '源码',
  wiki: 'Wiki',
  generated: '生成内容',
}

export const IMPLEMENTATION_ROLE_LABEL: Record<string, string> = {
  primary: '主要实现',
  supporting: '支撑实现',
  boundary: '边界实现',
}

/** Falls back to the raw Schema value for anything not yet translated. */
export function labelFor(map: Record<string, string>, value: string): string {
  return map[value] ?? value
}
