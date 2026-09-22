import type { Component, Flow, FlowModelV01, Port, Scenario, Source } from '@/domain/model'
import { ISSUE_CODES, type ValidationIssue } from '@/domain/validation'

/**
 * Third validation layer: cross-reference integrity that JSON Schema cannot
 * express (DESIGN.md 6.6, stage 3).
 *
 * Pure and allocation-light: it takes a document that already passed Schema
 * validation and returns every semantic problem it finds. A bundle with any
 * error here never reaches the graph.
 */

interface IdCarrier {
  id: string
}

function collectUnique<T extends IdCarrier>(
  items: readonly T[],
  collection: string,
  relativePath: string,
  push: (issue: ValidationIssue) => void,
): Map<string, T> {
  const byId = new Map<string, T>()
  const reported = new Set<string>()

  items.forEach((item, index) => {
    if (!byId.has(item.id)) {
      byId.set(item.id, item)
      return
    }
    // Report each colliding id once, listing both positions.
    const firstIndex = items.findIndex((candidate) => candidate.id === item.id)
    if (reported.has(item.id)) return
    reported.add(item.id)
    push({
      code: ISSUE_CODES.duplicateId,
      severity: 'error',
      stage: 'semantic',
      relativePath,
      instancePath: `/${collection}/${index}/id`,
      message: `ID "${item.id}" 在 ${collection} 中重复（另见索引 ${firstIndex}）。`,
      relatedIds: [item.id],
    })
  })

  return byId
}

/** Walks parent links upward, reporting missing parents and cycles. */
function checkParentChain(
  components: readonly Component[],
  componentById: ReadonlyMap<string, Component>,
  relativePath: string,
  push: (issue: ValidationIssue) => void,
): void {
  components.forEach((component, index) => {
    const at = `/${'components'}/${index}`
    const parentId = component.parent_id

    if (component.scope === 'external') {
      if (parentId !== undefined) {
        push({
          code: ISSUE_CODES.invalidLevelParent,
          severity: 'error',
          stage: 'semantic',
          relativePath,
          instancePath: `${at}/parent_id`,
          message: `外部组件 "${component.id}" 不应声明 parent_id。`,
          relatedIds: [component.id, parentId],
        })
      }
      return
    }

    if (component.level === 0) {
      if (parentId !== undefined) {
        push({
          code: ISSUE_CODES.invalidLevelParent,
          severity: 'error',
          stage: 'semantic',
          relativePath,
          instancePath: `${at}/parent_id`,
          message: `内部 L0 组件 "${component.id}" 不应有父组件。`,
          relatedIds: [component.id, parentId],
        })
      }
      return
    }

    if (parentId === undefined) {
      push({
        code: ISSUE_CODES.missingParent,
        severity: 'error',
        stage: 'semantic',
        relativePath,
        instancePath: `${at}/parent_id`,
        message: `内部 L${component.level} 组件 "${component.id}" 缺少 parent_id。`,
        relatedIds: [component.id],
      })
      return
    }

    const parent = componentById.get(parentId)
    if (parent === undefined) {
      push({
        code: ISSUE_CODES.missingParent,
        severity: 'error',
        stage: 'semantic',
        relativePath,
        instancePath: `${at}/parent_id`,
        message: `组件 "${component.id}" 的父组件 "${parentId}" 不存在。`,
        relatedIds: [component.id, parentId],
      })
      return
    }

    // A parent must sit exactly one level above and stay inside the system.
    const expectedParentLevel = component.level - 1
    if (parent.scope !== 'internal' || parent.level !== expectedParentLevel) {
      push({
        code: ISSUE_CODES.invalidLevelParent,
        severity: 'error',
        stage: 'semantic',
        relativePath,
        instancePath: `${at}/parent_id`,
        message:
          `组件 "${component.id}"（L${component.level}）的父组件 "${parentId}" ` +
          `必须是内部 L${expectedParentLevel} 组件，实际为 ${parent.scope} L${parent.level}。`,
        relatedIds: [component.id, parentId],
      })
      return
    }

    // Detect cycles by walking to the root, bounding the walk by array length.
    const seen = new Set<string>([component.id])
    let cursor: Component | undefined = parent
    let steps = 0
    while (cursor !== undefined && steps <= components.length) {
      if (seen.has(cursor.id)) {
        push({
          code: ISSUE_CODES.invalidLevelParent,
          severity: 'error',
          stage: 'semantic',
          relativePath,
          instancePath: `${at}/parent_id`,
          message: `组件 "${component.id}" 的父链存在循环。`,
          relatedIds: [component.id, cursor.id],
        })
        return
      }
      seen.add(cursor.id)
      steps += 1
      const nextId: string | undefined = cursor.parent_id
      cursor = nextId === undefined ? undefined : componentById.get(nextId)
    }
  })
}

function findPort(component: Component | undefined, portId: string): Port | undefined {
  return component?.ports?.find((port) => port.id === portId)
}

function checkEvidenceSources(
  owner: string,
  ownerPath: string,
  evidence: readonly { source_id: string }[] | undefined,
  sourceIds: ReadonlySet<string>,
  relativePath: string,
  push: (issue: ValidationIssue) => void,
): void {
  evidence?.forEach((entry, index) => {
    if (sourceIds.has(entry.source_id)) return
    push({
      code: ISSUE_CODES.missingSource,
      severity: 'error',
      stage: 'semantic',
      relativePath,
      instancePath: `${ownerPath}/evidence/${index}/source_id`,
      message: `${owner} 引用了不存在的 source "${entry.source_id}"。`,
      relatedIds: [entry.source_id],
    })
  })
}

function checkFlows(
  flows: readonly Flow[],
  componentById: ReadonlyMap<string, Component>,
  contractIds: ReadonlySet<string>,
  sourceIds: ReadonlySet<string>,
  relativePath: string,
  push: (issue: ValidationIssue) => void,
): void {
  flows.forEach((flow, index) => {
    const at = `/flows/${index}`

    if (!contractIds.has(flow.data_contract_id)) {
      push({
        code: ISSUE_CODES.missingContract,
        severity: 'error',
        stage: 'semantic',
        relativePath,
        instancePath: `${at}/data_contract_id`,
        message: `flow "${flow.id}" 引用了不存在的 data contract "${flow.data_contract_id}"。`,
        relatedIds: [flow.id, flow.data_contract_id],
      })
    }

    const endpoints = [
      { role: 'from', endpoint: flow.from, expectedDirection: 'output' as const, at: `${at}/from` },
      { role: 'to', endpoint: flow.to, expectedDirection: 'input' as const, at: `${at}/to` },
    ]

    for (const { role, endpoint, expectedDirection, at: endpointPath } of endpoints) {
      const component = componentById.get(endpoint.component_id)
      if (component === undefined) {
        push({
          code: ISSUE_CODES.missingPort,
          severity: 'error',
          stage: 'semantic',
          relativePath,
          instancePath: `${endpointPath}/component_id`,
          message: `flow "${flow.id}" 的 ${role} 组件 "${endpoint.component_id}" 不存在。`,
          relatedIds: [flow.id, endpoint.component_id],
        })
        continue
      }

      const port = findPort(component, endpoint.port_id)
      if (port === undefined) {
        push({
          code: ISSUE_CODES.missingPort,
          severity: 'error',
          stage: 'semantic',
          relativePath,
          instancePath: `${endpointPath}/port_id`,
          message:
            `flow "${flow.id}" 的 ${role} 端点引用了组件 "${component.id}" ` +
            `上不存在的端口 "${endpoint.port_id}"。`,
          relatedIds: [flow.id, component.id, endpoint.port_id],
        })
        continue
      }

      if (port.direction !== expectedDirection) {
        push({
          code: ISSUE_CODES.portDirectionMismatch,
          severity: 'error',
          stage: 'semantic',
          relativePath,
          instancePath: `${endpointPath}/port_id`,
          message:
            `flow "${flow.id}" 的 ${role} 端口 "${port.id}" 方向为 ${port.direction}，` +
            `应为 ${expectedDirection}。`,
          relatedIds: [flow.id, port.id],
        })
        continue
      }

      if (port.data_contract_id !== flow.data_contract_id) {
        push({
          code: ISSUE_CODES.dataContractMismatch,
          severity: 'error',
          stage: 'semantic',
          relativePath,
          instancePath: `${endpointPath}/port_id`,
          message:
            `flow "${flow.id}" 声明契约 "${flow.data_contract_id}"，` +
            `但 ${role} 端口 "${port.id}" 的契约是 "${port.data_contract_id}"。`,
          relatedIds: [flow.id, port.id, flow.data_contract_id],
        })
      }
    }

    checkEvidenceSources(
      `flow "${flow.id}"`,
      at,
      flow.evidence,
      sourceIds,
      relativePath,
      push,
    )
  })
}

function checkScenarios(
  scenarios: readonly Scenario[],
  flows: readonly Flow[],
  flowById: ReadonlyMap<string, Flow>,
  componentById: ReadonlyMap<string, Component>,
  sourceIds: ReadonlySet<string>,
  scenarioIds: ReadonlySet<string>,
  relativePath: string,
  push: (issue: ValidationIssue) => void,
): void {
  // Bidirectional membership, checked from both sides (DESIGN.md 6.6).
  const scenarioIdsByFlowId = new Map<string, Set<string>>()
  for (const flow of flows) {
    scenarioIdsByFlowId.set(flow.id, new Set(flow.scenario_ids))
  }

  /*
   * The reverse half of that relation. The loop below walks the declared
   * scenarios, so it can only ever report a flow the scenario forgot; a flow
   * pointing at a scenario nothing declares would pass unnoticed and the
   * "双向关系" check would only be half done (DESIGN.md 6.6).
   */
  flows.forEach((flow, index) => {
    flow.scenario_ids.forEach((scenarioId, i) => {
      if (scenarioIds.has(scenarioId)) return
      push({
        code: ISSUE_CODES.missingScenarioReference,
        severity: 'error',
        stage: 'semantic',
        relativePath,
        instancePath: `/flows/${index}/scenario_ids/${i}`,
        message: `flow "${flow.id}" 声明属于不存在的 scenario "${scenarioId}"。`,
        relatedIds: [flow.id, scenarioId],
      })
    })
  })

  scenarios.forEach((scenario, index) => {
    const at = `/scenarios/${index}`
    const scenarioComponentIds = new Set(scenario.component_ids)
    const scenarioFlowIds = new Set(scenario.flow_ids)

    scenario.component_ids.forEach((componentId, i) => {
      if (componentById.has(componentId)) return
      push({
        code: ISSUE_CODES.missingScenarioReference,
        severity: 'error',
        stage: 'semantic',
        relativePath,
        instancePath: `${at}/component_ids/${i}`,
        message: `scenario "${scenario.id}" 引用了不存在的组件 "${componentId}"。`,
        relatedIds: [scenario.id, componentId],
      })
    })

    scenario.flow_ids.forEach((flowId, i) => {
      const flow = flowById.get(flowId)
      if (flow === undefined) {
        push({
          code: ISSUE_CODES.missingScenarioReference,
          severity: 'error',
          stage: 'semantic',
          relativePath,
          instancePath: `${at}/flow_ids/${i}`,
          message: `scenario "${scenario.id}" 引用了不存在的 flow "${flowId}"。`,
          relatedIds: [scenario.id, flowId],
        })
        return
      }

      // Both endpoints of a scenario flow must belong to that scenario.
      const endpoints = [
        { role: 'from', componentId: flow.from.component_id },
        { role: 'to', componentId: flow.to.component_id },
      ]
      for (const { role, componentId } of endpoints) {
        if (scenarioComponentIds.has(componentId)) continue
        push({
          code: ISSUE_CODES.scenarioEndpointOutsideScenario,
          severity: 'error',
          stage: 'semantic',
          relativePath,
          instancePath: at,
          message:
            `scenario "${scenario.id}" 的 flow "${flowId}" 的 ${role} 端点组件 ` +
            `"${componentId}" 不在该场景的 component_ids 中。`,
          relatedIds: [scenario.id, flowId, componentId],
        })
      }
    })

    checkEvidenceSources(
      `scenario "${scenario.id}"`,
      at,
      scenario.evidence,
      sourceIds,
      relativePath,
      push,
    )

    // Flows that claim this scenario but are not listed by it.
    for (const flow of flows) {
      const declared = scenarioIdsByFlowId.get(flow.id)?.has(scenario.id) ?? false
      const listed = scenarioFlowIds.has(flow.id)
      if (declared === listed) continue
      push({
        code: ISSUE_CODES.scenarioFlowAsymmetry,
        severity: 'error',
        stage: 'semantic',
        relativePath,
        instancePath: at,
        message: listed
          ? `scenario "${scenario.id}" 列出了 flow "${flow.id}"，但该 flow 的 scenario_ids 未包含此场景。`
          : `flow "${flow.id}" 声明属于 scenario "${scenario.id}"，但该场景的 flow_ids 未列出它。`,
        relatedIds: [scenario.id, flow.id],
      })
    }
  })
}

export function runSemanticChecks(bundle: FlowModelV01, relativePath: string): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const push = (issue: ValidationIssue): void => {
    issues.push(issue)
  }

  const componentById = collectUnique(bundle.components, 'components', relativePath, push)
  const flowById = collectUnique(bundle.flows, 'flows', relativePath, push)
  const sourcesById = collectUnique<Source>(bundle.sources, 'sources', relativePath, push)
  const contractsById = collectUnique(bundle.data_contracts, 'data_contracts', relativePath, push)
  const scenariosById = collectUnique(bundle.scenarios, 'scenarios', relativePath, push)

  const sourceIds = new Set(sourcesById.keys())
  const contractIds = new Set(contractsById.keys())

  checkParentChain(bundle.components, componentById, relativePath, push)

  bundle.components.forEach((component, index) => {
    const at = `/components/${index}`
    component.ports?.forEach((port, portIndex) => {
      if (contractIds.has(port.data_contract_id)) return
      push({
        code: ISSUE_CODES.missingContract,
        severity: 'error',
        stage: 'semantic',
        relativePath,
        instancePath: `${at}/ports/${portIndex}/data_contract_id`,
        message: `组件 "${component.id}" 的端口 "${port.id}" 引用了不存在的 data contract "${port.data_contract_id}"。`,
        relatedIds: [component.id, port.id, port.data_contract_id],
      })
    })

    component.implementation?.forEach((binding, bindingIndex) => {
      if (sourceIds.has(binding.source_id)) return
      push({
        code: ISSUE_CODES.missingSource,
        severity: 'error',
        stage: 'semantic',
        relativePath,
        instancePath: `${at}/implementation/${bindingIndex}/source_id`,
        message: `组件 "${component.id}" 的实现绑定引用了不存在的 source "${binding.source_id}"。`,
        relatedIds: [component.id, binding.source_id],
      })
    })

    checkEvidenceSources(
      `组件 "${component.id}"`,
      at,
      component.evidence,
      sourceIds,
      relativePath,
      push,
    )
  })

  bundle.data_contracts.forEach((contract, index) => {
    checkEvidenceSources(
      `data contract "${contract.id}"`,
      `/data_contracts/${index}`,
      contract.evidence,
      sourceIds,
      relativePath,
      push,
    )
  })

  checkFlows(bundle.flows, componentById, contractIds, sourceIds, relativePath, push)
  checkScenarios(
    bundle.scenarios,
    bundle.flows,
    flowById,
    componentById,
    sourceIds,
    new Set(scenariosById.keys()),
    relativePath,
    push,
  )

  return issues
}
