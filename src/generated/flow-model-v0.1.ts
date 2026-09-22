/**
 * GENERATED FILE - DO NOT EDIT BY HAND.
 *
 * Produced by `pnpm schema:types` from the embedded Schema snapshot.
 * Edit the snapshot under src/schemas/ and regenerate instead.
 */

export type Id = string
export type NonEmptyString = string
export type Source = ({
[k: string]: unknown
} & {
[k: string]: unknown
} & {
id: Id
kind: ("source_code" | "wiki" | "generated")
title: NonEmptyString
path?: NonEmptyString
url?: string
revision?: string
symbol?: NonEmptyString
line_start?: number
line_end?: number
section?: NonEmptyString
retrieved_on?: string
notes?: NonEmptyString
} & {
id: Id
kind: ("source_code" | "wiki" | "generated")
title: NonEmptyString
path?: NonEmptyString
url?: string
revision?: string
symbol?: NonEmptyString
line_start?: number
line_end?: number
section?: NonEmptyString
retrieved_on?: string
notes?: NonEmptyString
})
export type LocalPortId = string
export type Range = (Range1 & {
minimum?: number
maximum?: number
minimum_inclusive?: boolean
maximum_inclusive?: boolean
})
export type Range1 = ({
[k: string]: unknown
} | {
[k: string]: unknown
})
export type Component = ({
[k: string]: unknown
} & {
id: Id
name: NonEmptyString
level: number
scope: ("internal" | "external")
kind: ("system" | "actor" | "physical_device" | "capability_domain" | "input_adapter" | "dispatcher" | "mode" | "mission_executor" | "navigator" | "estimator" | "controller" | "mixer" | "output_adapter" | "safety_monitor" | "policy")
parent_id?: Id
responsibility: NonEmptyString
description?: NonEmptyString
ports?: Port[]
conditions?: NonEmptyString[]
implementation?: ImplementationBinding[]
verification: Verification
evidence?: Evidence[]
tags?: NonEmptyString[]
} & {
id: Id
name: NonEmptyString
level: number
scope: ("internal" | "external")
kind: ("system" | "actor" | "physical_device" | "capability_domain" | "input_adapter" | "dispatcher" | "mode" | "mission_executor" | "navigator" | "estimator" | "controller" | "mixer" | "output_adapter" | "safety_monitor" | "policy")
parent_id?: Id
responsibility: NonEmptyString
description?: NonEmptyString
ports?: Port[]
conditions?: NonEmptyString[]
implementation?: ImplementationBinding[]
verification: Verification
evidence?: Evidence[]
tags?: NonEmptyString[]
})
export type Verification = ("code_confirmed" | "docs_and_code_confirmed" | "docs_only" | "inferred" | "conflict" | "human_verified")

/**
 * Schema v0.1 for source-evidenced L0-L2 component and data-flow models.
 */
export interface ArduPilotBusinessFlowModel {
schema_version: "0.1"
model: ModelMetadata
/**
 * @minItems 1
 */
sources: [Source, ...(Source)[]]
/**
 * @minItems 1
 */
data_contracts: [DataContract, ...(DataContract)[]]
/**
 * @minItems 1
 */
components: [Component, ...(Component)[]]
/**
 * @minItems 1
 */
flows: [Flow, ...(Flow)[]]
/**
 * @minItems 1
 */
scenarios: [Scenario, ...(Scenario)[]]
}
export interface ModelMetadata {
id: Id
title: NonEmptyString
description: NonEmptyString
vehicle: NonEmptyString
source_revision: string
generated_on: string
language: string
review_status: ("draft" | "schema_validated" | "evidence_checked" | "human_reviewed")
scope: Scope
}
export interface Scope {
/**
 * @minItems 1
 */
levels: [number, ...(number)[]]
frame_profile: NonEmptyString
includes: NonEmptyString[]
excludes: NonEmptyString[]
assumptions: NonEmptyString[]
}
export interface DataContract {
id: Id
name: NonEmptyString
description: NonEmptyString
/**
 * @minItems 1
 */
fields: [DataField, ...(DataField)[]]
evidence?: Evidence[]
}
export interface DataField {
name: LocalPortId
type: ("boolean" | "integer" | "number" | "string" | "enum" | "vector2" | "vector3" | "quaternion" | "object")
description: NonEmptyString
unit?: NonEmptyString
frame?: NonEmptyString
range?: Range
/**
 * @minItems 1
 */
values?: [NonEmptyString, ...(NonEmptyString)[]]
nullable?: boolean
}
export interface Evidence {
source_id: Id
support: ("direct" | "contextual" | "contradictory")
claim: NonEmptyString
}
export interface Port {
id: LocalPortId
name: NonEmptyString
direction: ("input" | "output")
data_contract_id: Id
required?: boolean
description?: NonEmptyString
}
export interface ImplementationBinding {
source_id: Id
role: ("primary" | "supporting" | "boundary")
notes?: NonEmptyString
}
export interface Flow {
id: Id
name: NonEmptyString
kind: ("command" | "measurement" | "state" | "event" | "control" | "actuation" | "feedback")
from: Endpoint
to: Endpoint
data_contract_id: Id
transport: ("hardware_io" | "shared_state" | "virtual_call" | "direct_call" | "direct_setter" | "internal_state" | "conceptual")
cadence: Cadence
transform: NonEmptyString
conditions?: NonEmptyString[]
feedback?: boolean
verification: Verification
/**
 * @minItems 1
 */
evidence: [Evidence, ...(Evidence)[]]
/**
 * @minItems 1
 */
scenario_ids: [Id, ...(Id)[]]
notes?: NonEmptyString
}
export interface Endpoint {
component_id: Id
port_id: LocalPortId
}
export interface Cadence {
kind: ("periodic" | "event_driven" | "on_change" | "continuous")
rate_hz?: number
constraint?: NonEmptyString
}
export interface Scenario {
id: Id
name: NonEmptyString
description: NonEmptyString
default_level: number
entry_conditions: NonEmptyString[]
exit_conditions: NonEmptyString[]
/**
 * @minItems 1
 */
component_ids: [Id, ...(Id)[]]
/**
 * @minItems 1
 */
flow_ids: [Id, ...(Id)[]]
verification: Verification
/**
 * @minItems 1
 */
evidence: [Evidence, ...(Evidence)[]]
notes?: NonEmptyString[]
}
