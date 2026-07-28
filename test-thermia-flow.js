#!/usr/bin/env node
'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')

const flow = JSON.parse(fs.readFileSync('thermia-flows.json', 'utf8'))
const byId = new Map(flow.map((node) => [node.id, node]))

function store (initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    get: (key) => values.get(key),
    set: (key, value) => values.set(key, value)
  }
}

function runFunction (id, msg, options = {}) {
  const nodeDef = byId.get(id)
  assert.equal(nodeDef.type, 'function')
  const statuses = []
  const errors = []
  const envValues = options.env || {}
  const env = { get: (key) => envValues[key] }
  const context = options.context || store()
  const globals = options.globals || store()
  const flowContext = options.flow || store()
  const node = {
    status: (value) => statuses.push(value),
    error: (error) => errors.push(error)
  }
  const fn = new Function('msg', 'env', 'context', 'global', 'flow', 'node', nodeDef.func)
  return {
    result: fn(msg, env, context, globals, flowContext, node),
    context,
    globals,
    flow: flowContext,
    statuses,
    errors
  }
}

assert.equal(flow.length, byId.size, 'alle node-id’s moeten uniek zijn')
for (const node of flow) {
  for (const output of node.wires || []) {
    for (const target of output) {
      assert.ok(byId.has(target), `${node.id} verwijst naar ontbrekende node ${target}`)
    }
  }
}

{
  const flowContext = store()
  const { result } = runFunction('thermia_config', {}, { flow: flowContext })
  assert.equal(flowContext.get('thermiaConfig').host, '192.168.1.50')
  assert.deepEqual(result.payload, {
    connectorType: 'TCP',
    tcpHost: '192.168.1.50',
    tcpPort: '502',
    tcpType: 'DEFAULT',
    unitId: 1
  })
}

{
  const flowContext = store({
    thermiaConfig: { unitId: 7, powerSource: 'unit', enableWrites: false }
  })
  const { result } = runFunction('thermia_make_reads', {}, {
    flow: flowContext
  })
  assert.deepEqual(result[0][0].payload, { fc: 4, unitid: 7, address: 158, quantity: 1 })
  assert.deepEqual(result[0][1].payload, { fc: 3, unitid: 7, address: 124, quantity: 1 })
  assert.deepEqual(result[0][2].payload, { fc: 4, unitid: 7, address: 82, quantity: 1 })
}

{
  const flowContext = store({
    thermiaConfig: { unitId: 1, powerSource: 'meter', enableWrites: false }
  })
  const { result } = runFunction('thermia_make_reads', {}, {
    flow: flowContext
  })
  assert.deepEqual(result[0][0].payload, { fc: 4, unitid: 1, address: 78, quantity: 3 })
}

{
  const { result, errors } = runFunction('thermia_parse', {
    topic: 'thermia.power.unit',
    payload: [123]
  })
  assert.equal(result[0].payload['Ac/Power'], 1230)
  assert.equal(errors.length, 0)
}

{
  const { result } = runFunction('thermia_parse', {
    topic: 'thermia.power.meter',
    payload: [400, 500, 600]
  })
  assert.equal(result[0].payload['Ac/Power'], 1500)
  assert.equal(result[0].payload['Ac/L3/Power'], 600)
}

{
  const hour = new Date().getHours()
  const prices = Object.fromEntries(Array.from({ length: 24 }, (_, index) => [
    index,
    index === hour ? -1 : index + 1
  ]))
  const globals = store()
  const { result } = runFunction('thermia_prices', {
    topic: 'dynamic-ess',
    payload: { output: { p_b: prices } }
  }, { globals })
  assert.equal(result.payload.valid, true)
  assert.equal(result.payload.cheap, true)
  assert.equal(result.payload.cheapestHours.length, 5)
}

{
  const context = store()
  const flowContext = store({
    thermiaConfig: { unitId: 1, powerSource: 'unit', enableWrites: true }
  })
  runFunction('thermia_control', {
    topic: 'thermia.price.state',
    payload: { valid: true, cheap: true }
  }, { context, flow: flowContext })
  const { result } = runFunction('thermia_control', {
    topic: 'thermia.sg.desired',
    payload: { mode: 0 }
  }, { context, flow: flowContext })
  assert.deepEqual(result.payload, {
    value: 3,
    fc: 6,
    unitid: 1,
    address: 124,
    quantity: 1
  })
}

{
  const { result } = runFunction('thermia_control', {
    topic: 'thermia.sg.desired',
    payload: { mode: 0 }
  }, {
    flow: store({
      thermiaConfig: { unitId: 1, powerSource: 'unit', enableWrites: false }
    })
  })
  assert.equal(result, null)
}

{
  const context = store({ priceState: { valid: false, cheap: false } })
  const { result } = runFunction('thermia_control', {
    topic: 'thermia.sg.desired',
    payload: { mode: 3 }
  }, {
    context,
    flow: store({
      thermiaConfig: { unitId: 1, powerSource: 'unit', enableWrites: true }
    })
  })
  assert.equal(result.payload.value, 0, 'ongeldige prijsdata moet Boost opheffen')
}

console.log('Thermia-flow: alle tests geslaagd')
