/**
 * Domain vocabulary for the viewer.
 *
 * The structural types come from the embedded Schema snapshot through the
 * generated module; nothing here re-declares Schema shape by hand. Localised
 * display text lives in `@/styles/semanticTokens` so the raw configuration is
 * never rewritten for presentation (DESIGN.md 7.2).
 */
import type {
  ArduPilotBusinessFlowModel,
  Cadence as SchemaCadence,
  Component as SchemaComponent,
  DataContract as SchemaDataContract,
  DataField as SchemaDataField,
  Endpoint as SchemaEndpoint,
  Evidence as SchemaEvidence,
  Flow as SchemaFlow,
  ImplementationBinding as SchemaImplementationBinding,
  ModelMetadata as SchemaModelMetadata,
  Port as SchemaPort,
  Scenario as SchemaScenario,
  Source as SchemaSource,
} from '@/generated/flow-model-v0.1'

export type FlowModelV01 = ArduPilotBusinessFlowModel

export type Component = SchemaComponent
export type Flow = SchemaFlow
export type Scenario = SchemaScenario
export type DataContract = SchemaDataContract
export type DataField = SchemaDataField
export type Evidence = SchemaEvidence
export type Source = SchemaSource
export type Port = SchemaPort
export type Endpoint = SchemaEndpoint
export type ModelMetadata = SchemaModelMetadata
export type ImplementationBinding = SchemaImplementationBinding
export type Cadence = SchemaCadence

export type FlowKind = Flow['kind']
export type Verification = Flow['verification']
export type ComponentKind = Component['kind']
export type ComponentScope = Component['scope']
export type SourceKind = Source['kind']
export type DataFieldType = DataField['type']
export type EvidenceSupport = Evidence['support']
export type ReviewStatus = ModelMetadata['review_status']

/**
 * One of the three supported layer views.
 *
 * The Schema constrains `level` to the integers 0-2 with `minimum`/`maximum`,
 * which JSON Schema cannot express as a TS union. `asGraphLevel` is the single
 * place where that narrowing happens, applied only to documents that already
 * passed Schema validation.
 */
export type GraphLevel = 0 | 1 | 2

export const GRAPH_LEVELS: readonly GraphLevel[] = [0, 1, 2]

export function asGraphLevel(level: number): GraphLevel | null {
  return level === 0 || level === 1 || level === 2 ? level : null
}
