#!/usr/bin/env node
'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const lib = require('./enphase-lib')

function fakeJwt (payload) {
  const h = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
  const p = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return h + '.' + p + '.sig'
}

const INFO_XML = `<?xml version="1.0"?>
<envoy_info>
  <device>
    <sn>122125067699</sn>
    <pn>800-00654-r06</pn>
    <software>D8.2.4264</software>
  </device>
  <web-tokens>true</web-tokens>
</envoy_info>`

{
  const info = lib.parseEnvoyInfo(INFO_XML)
  assert.equal(info.serial, '122125067699')
  assert.equal(info.software, 'D8.2.4264')
  assert.equal(info.part, '800-00654-r06')
  assert.equal(info.webTokens, true)
  assert.equal(lib.serialsMatch('1221-250-67699', '122125067699'), true)
  assert.equal(lib.serialsMatch('1', '2'), false)
}

{
  const token = fakeJwt({
    enphaseUser: 'owner',
    exp: Math.floor(Date.now() / 1000) + 3600 * 24 * 200
  })
  assert.equal(lib.tokenUserType(token), 'owner')
  assert.equal(lib.shouldRefreshToken(token, Date.now()), false)
  assert.equal(lib.shouldRefreshToken(token, Date.now(), { leadMs: 201 * 24 * 3600 * 1000 }), true)
  assert.equal(lib.extractToken('  ' + token + '  '), token)
  assert.equal(lib.extractToken({ token: token }), token)
  assert.equal(lib.extractToken(JSON.stringify({ token: token })), token)
}

{
  const installer = fakeJwt({
    enphaseUser: 'installer',
    exp: Math.floor(Date.now() / 1000) + 3600
  })
  assert.equal(lib.shouldRefreshToken(installer, Date.now()), true)
}

{
  const hosts = lib.buildHostCandidates({
    serial: '122125067699',
    cachedIp: '192.168.1.20',
    manualIp: '10.0.0.5'
  })
  assert.deepEqual(hosts.slice(0, 3), ['10.0.0.5', '192.168.1.20', 'envoy.local'])
  assert.ok(hosts.includes('envoy-122125067699.local'))
}

{
  const ips = lib.expandScanIps([
    { address: '192.168.1.10', netmask: '255.255.255.0' },
    { address: '127.0.0.1', netmask: '255.0.0.0' }
  ])
  assert.equal(ips.length, 253)
  assert.equal(ips[0], '192.168.1.1')
  assert.ok(!ips.includes('192.168.1.10'))
  assert.ok(!ips.includes('192.168.1.0'))
  assert.ok(!ips.includes('192.168.1.255'))
}

const metered = {
  production: [
    { type: 'inverters', activeCount: 12, wNow: 3400, whLifetime: 634218 },
    {
      type: 'eim',
      measurementType: 'production',
      activeCount: 1,
      wNow: 3510.4,
      whLifetime: 640100.2,
      rmsVoltage: 690,
      rmsCurrent: 15.2,
      lines: [
        { wNow: 1170, rmsVoltage: 230.1, rmsCurrent: 5.1, whLifetime: 213000 },
        { wNow: 1160, rmsVoltage: 229.8, rmsCurrent: 5.05, whLifetime: 213100 },
        { wNow: 1180, rmsVoltage: 230.4, rmsCurrent: 5.12, whLifetime: 214000 }
      ]
    }
  ]
}

const standard = {
  production: [
    { type: 'inverters', activeCount: 8, wNow: 2100, whLifetime: 120000 },
    {
      type: 'eim',
      measurementType: 'production',
      activeCount: 0,
      wNow: -8.5,
      whLifetime: 0.006,
      rmsVoltage: 709
    }
  ]
}

const meteredNoCt = {
  production: [
    { type: 'inverters', activeCount: 12, wNow: 3429, whLifetime: 634218 },
    {
      type: 'eim',
      measurementType: 'production',
      activeCount: 0,
      wNow: -8.579,
      whLifetime: 0.006
    }
  ]
}

const pdm = {
  production: {
    pcu: { wattsNow: 596, wattHoursLifetime: 8250671 },
    eim: { wattsNow: 0, wattHoursLifetime: 0 }
  }
}

{
  const picked = lib.pickProduction(metered)
  assert.equal(picked.source, 'ct')
  assert.equal(picked.watts, 3510.4)
  assert.equal(picked.lines.length, 3)
  const payload = lib.mapToVictron(picked, { position: 1, nominalVoltage: 230 }, {})
  assert.equal(payload.Position, 1)
  assert.equal(payload.StatusCode, 7)
  assert.equal(payload['Ac/Power'], 3510.4)
  assert.equal(payload['Ac/L1/Voltage'], 230.1)
  assert.equal(payload['Ac/Energy/Forward'], 640.1)
}

{
  const picked = lib.pickProduction(standard)
  assert.equal(picked.source, 'inverters')
  assert.equal(picked.watts, 2100)
  const payload = lib.mapToVictron(picked, { position: 0 }, {})
  assert.equal(payload.Position, 0)
  assert.equal(payload['Ac/Power'], 2100)
  assert.equal(payload['Ac/L1/Power'], 2100)
  assert.equal(payload['Ac/L2/Power'], 0)
  assert.ok(payload['Ac/L1/Voltage'] >= 230)
}

{
  const picked = lib.pickProduction(meteredNoCt)
  assert.equal(picked.source, 'inverters')
  assert.equal(picked.watts, 3429)
}

{
  const picked = lib.pickProduction(pdm)
  assert.equal(picked.source, 'pdm-pcu')
  assert.equal(picked.watts, 596)
}

{
  assert.equal(lib.nextLifetimeKwh(500000, 400), 500)
  assert.equal(lib.nextLifetimeKwh(1000, 400), 400)
  assert.equal(lib.nextLifetimeKwh(0, 12.3), 12.3)
}

{
  assert.equal(lib.isAuthFailure(401, ''), true)
  assert.equal(lib.isAuthFailure(200, { production: [] }), false)
  assert.equal(lib.isRetryableNet(undefined, { message: 'read ECONNRESET' }, ''), true)
}

const flow = JSON.parse(fs.readFileSync('enphase-flows.json', 'utf8'))
const byId = new Map(flow.map((node) => [node.id, node]))
assert.equal(flow.length, byId.size, 'alle node-id’s moeten uniek zijn')

for (const node of flow) {
  for (const output of node.wires || []) {
    for (const target of output) {
      assert.ok(byId.has(target), `${node.id} verwijst naar ontbrekende node ${target}`)
    }
  }
  if (node.type === 'link out') {
    for (const target of node.links || []) {
      assert.ok(byId.has(target), `${node.id} link-out naar ontbrekende node ${target}`)
    }
  }
  if (node.type === 'link in') {
    for (const target of node.links || []) {
      assert.ok(byId.has(target), `${node.id} link-in vanaf ontbrekende node ${target}`)
    }
  }
}

const meter = byId.get('e_p_meter')
assert.equal(meter.type, 'victron-virtual')
assert.equal(meter.device, 'pvinverter')
assert.equal(meter.pvinverter_nrofphases, 3)
assert.equal(meter.pvinverter_auto_energy, true)

assert.equal(byId.has('e_ui_base'), false, 'oude ui-base id e_ui_base: Node-RED overschrijft bestaande config-nodes niet')
assert.equal(byId.has('e_ui_page'), false, 'oude ui-page id e_ui_page moet vervangen zijn')
assert.equal(byId.has('e_ui_group'), false, 'oude ui-group id e_ui_group moet vervangen zijn')

const dash = byId.get('ui_base')
assert.equal(dash.type, 'ui-base')
assert.equal(dash.path, '/dashboard')

const page = byId.get('e_ui_page2')
assert.equal(page.type, 'ui-page')
assert.equal(page.ui, 'ui_base')
assert.equal(page.path, '/')

const group = byId.get('e_ui_group2')
assert.equal(group.type, 'ui-group')
assert.equal(group.page, 'e_ui_page2')

assert.equal(
  flow.some((n) => n.path === '/dashboard-enphase' || n.path === '/enphase'),
  false,
  'geen oude dashboard-paden'
)

const mapNode = byId.get('e_p_map')
assert.match(mapNode.func, /function pickProduction/)
assert.match(mapNode.func, /function mapToVictron/)

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
  const globals = options.globals || store()
  const flowContext = options.flow || store()
  const node = {
    status: (value) => statuses.push(value),
    error: (error) => errors.push(error)
  }
  const fn = new Function('msg', 'env', 'context', 'global', 'flow', 'node', nodeDef.func)
  return {
    result: fn(msg, env, {}, globals, flowContext, node),
    globals,
    flow: flowContext,
    statuses,
    errors
  }
}

{
  const globals = store({
    enphaseCfg: { serial: '122125067699', ip: '192.168.1.20', source: 'ct' }
  })
  const { result } = runFunction('e_p_map', { payload: metered }, {
    globals,
    flow: store({ enphaseCfg: { position: 1 } })
  })
  assert.equal(result.payload['Ac/Power'], 3510.4)
  assert.equal(result.payload.Position, 1)
  assert.equal(result.payload.StatusCode, 7)
  assert.equal(result._enphaseSource.includes('CT') || result.payload['Ac/L2/Power'] > 0, true)
}

{
  const { result } = runFunction('e_p_map', { payload: standard }, {
    flow: store({ enphaseCfg: { position: 0 } })
  })
  assert.equal(result.payload['Ac/Power'], 2100)
  assert.equal(result.payload['Ac/L2/Power'], 0)
}

{
  const { result, statuses } = runFunction('e_p_map', { payload: { foo: 1 } }, {
    flow: store()
  })
  assert.equal(result, null)
  assert.equal(statuses[0].text, 'geen productiedata')
}

{
  const token = fakeJwt({
    enphaseUser: 'owner',
    exp: Math.floor(Date.now() / 1000) + 3600 * 24 * 200
  })
  const globals = store({
    enphaseCfg: {
      username: 'a@b.c',
      password: 'x',
      serial: '122125067699',
      ip: '192.168.1.20',
      token,
      webTokens: true,
      position: 0
    },
    enphaseToken: token
  })
  const { result } = runFunction('e_p_prep', { payload: Date.now() }, {
    globals,
    flow: store()
  })
  assert.equal(result[0], null)
  assert.equal(result[2], null)
  assert.equal(result[1].access_token, token)
}

console.log('enphase tests ok')
