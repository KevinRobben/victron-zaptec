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
  const node = {
    status: (value) => statuses.push(value),
    error: (error) => errors.push(error)
  }
  const fn = new Function('msg', 'env', 'context', 'global', 'node', nodeDef.func)
  return {
    result: fn(msg, env, context, globals, node),
    context,
    globals,
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
  const { result } = runFunction('thermia_make_reads', {}, {
    env: { THERMIA_UNIT_ID: '7', THERMIA_POWER_SOURCE: 'unit' }
  })
  assert.deepEqual(result[0][0].payload, { fc: 4, unitid: 7, address: 158, quantity: 1 })
  assert.deepEqual(result[0][1].payload, { fc: 3, unitid: 7, address: 22, quantity: 2 })
}

{
  const { result } = runFunction('thermia_make_reads', {}, {
    env: { THERMIA_POWER_SOURCE: 'meter' }
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
  const env = {
    THERMIA_ENABLE_WRITES: 'true',
    THERMIA_TAPWATER_START_C: '45',
    THERMIA_TAPWATER_STOP_C: '50',
    THERMIA_CHEAP_DELTA_C: '3',
    THERMIA_MAX_TAPWATER_C: '60'
  }
  runFunction('thermia_control', {
    topic: 'thermia.price.state',
    payload: { valid: true, cheap: true }
  }, { context, env })
  const { result } = runFunction('thermia_control', {
    topic: 'thermia.settings',
    payload: { startC: 45, stopC: 50 }
  }, { context, env })
  assert.deepEqual(result.payload, {
    value: [4800, 5300],
    fc: 16,
    unitid: 1,
    address: 22,
    quantity: 2
  })
}

{
  const { result } = runFunction('thermia_control', {
    topic: 'thermia.settings',
    payload: { startC: 45, stopC: 50 }
  }, {
    env: {
      THERMIA_ENABLE_WRITES: 'false',
      THERMIA_TAPWATER_START_C: '45',
      THERMIA_TAPWATER_STOP_C: '50'
    }
  })
  assert.equal(result, null)
}

console.log('Thermia-flow: alle tests geslaagd')
