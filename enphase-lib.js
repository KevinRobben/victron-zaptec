'use strict'

/**
 * Pure helpers for the Enphase IQ Gateway -> Victron Node-RED flow.
 * Used by tests and inlined into function nodes in enphase-flows.json.
 */

function asNum (v) {
  const n = parseFloat(v)
  return isNaN(n) ? 0 : n
}

function round (v, d) {
  const f = Math.pow(10, d == null ? 0 : d)
  return Math.round((Number(v) || 0) * f) / f
}

function serialDigits (v) {
  return String(v || '').replace(/\D/g, '')
}

function serialsMatch (a, b) {
  const na = serialDigits(a)
  const nb = serialDigits(b)
  return !!(na && nb && na === nb)
}

function parseEnvoyInfo (body) {
  const xml = typeof body === 'string' ? body : String(body || '')
  const grab = (tag) => {
    const m = xml.match(new RegExp('<' + tag + '>([^<]+)</' + tag + '>', 'i'))
    return m ? m[1].trim() : ''
  }
  return {
    serial: grab('sn'),
    software: grab('software'),
    part: grab('pn'),
    webTokens: /<web-tokens>\s*true\s*<\/web-tokens>/i.test(xml)
  }
}

function decodeJwt (token) {
  if (!token || typeof token !== 'string') return null
  const parts = token.trim().split('.')
  if (parts.length < 2) return null
  try {
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = payload + '='.repeat((4 - payload.length % 4) % 4)
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'))
  } catch (e) {
    return null
  }
}

function tokenExpiryMs (token) {
  const p = decodeJwt(token)
  if (!p || !p.exp) return 0
  return Number(p.exp) * 1000
}

function tokenUserType (token) {
  const p = decodeJwt(token) || {}
  return String(p.enphaseUser || p.user || '').toLowerCase()
}

function shouldRefreshToken (token, now, opts) {
  if (!token) return true
  const exp = tokenExpiryMs(token)
  if (!exp) return true
  now = now || Date.now()
  const user = tokenUserType(token)
  const defaultLead = user === 'installer' ? 2 * 3600 * 1000 : 30 * 24 * 3600 * 1000
  const lead = (opts && opts.leadMs) || defaultLead
  return now >= (exp - lead)
}

function extractToken (payload) {
  if (!payload) return ''
  if (typeof payload === 'string') {
    const t = payload.trim().replace(/^"|"$/g, '')
    if (t.indexOf('eyJ') === 0) return t
    try {
      const j = JSON.parse(payload)
      return extractToken(j)
    } catch (e) {
      return t.indexOf('eyJ') >= 0 ? t.slice(t.indexOf('eyJ')) : ''
    }
  }
  if (typeof payload === 'object') {
    const t = payload.token || payload.access_token || payload.jwt || ''
    return typeof t === 'string' ? t.trim() : ''
  }
  return ''
}

function isRetryableNet (code, err, payload) {
  const t = [err && (err.message || err), payload, code].join(' ')
  if (/ECONNRESET|ETIMEDOUT|ESOCKETTIMEDOUT|EPIPE|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up|ECONNABORTED|EHOSTUNREACH|ENETUNREACH|RequestError|CERT_|UNABLE_TO_VERIFY/i.test(t)) {
    return true
  }
  const n = parseInt(code, 10)
  return n === 429 || n >= 500
}

function isAuthFailure (code, payload) {
  const n = parseInt(code, 10)
  if (n === 401 || n === 403) return true
  const t = typeof payload === 'string' ? payload : JSON.stringify(payload || '')
  return /unauthor|not authenticated|login/i.test(t) && /<html/i.test(t)
}

function activeLines (lines) {
  if (!Array.isArray(lines)) return []
  return lines.filter((line) => {
    if (!line || typeof line !== 'object') return false
    return Object.keys(line).some((k) => asNum(line[k]) !== 0)
  })
}

function fromBlock (block, source) {
  const b = block || {}
  const watts = Math.max(0, asNum(b.wNow != null ? b.wNow : b.wattsNow))
  const wh = Math.max(0, asNum(
    b.whLifetime != null ? b.whLifetime
      : (b.wattHoursLifetime != null ? b.wattHoursLifetime : 0)
  ))
  return {
    source,
    watts,
    wattHours: wh,
    voltage: asNum(b.rmsVoltage),
    current: asNum(b.rmsCurrent),
    freq: asNum(b.freqHz != null ? b.freqHz : b.freq),
    lines: activeLines(b.lines),
    readingTime: b.readingTime || b.timestamp || 0,
    activeCount: asNum(b.activeCount)
  }
}

function eimLooksLive (block) {
  if (!block) return false
  return Math.abs(asNum(block.wNow != null ? block.wNow : block.wattsNow)) > 1 ||
    asNum(block.whLifetime != null ? block.whLifetime : block.wattHoursLifetime) > 10
}

/**
 * Choose production data that works for both IQ Gateway Standard (no CTs)
 * and Metered (with production CT). Never trust an eim/CT block with
 * activeCount 0 — that is the classic "metered without coils" zero/garbage path.
 */
function pickProduction (data) {
  if (!data || typeof data !== 'object') return null

  // /ivp/pdm/energy — official fallback that works without a production meter.
  if (data.production && !Array.isArray(data.production) && (data.production.pcu || data.production.eim)) {
    const eim = data.production.eim
    const pcu = data.production.pcu
    if (eim && eimLooksLive({ wNow: eim.wattsNow, whLifetime: eim.wattHoursLifetime })) {
      return fromBlock({
        wNow: eim.wattsNow,
        wattHoursLifetime: eim.wattHoursLifetime
      }, 'pdm-eim')
    }
    if (pcu) {
      return fromBlock({
        wNow: pcu.wattsNow,
        wattHoursLifetime: pcu.wattHoursLifetime
      }, 'pdm-pcu')
    }
  }

  const prod = Array.isArray(data.production) ? data.production : []
  const inverters = prod.find((p) => p && p.type === 'inverters' && asNum(p.activeCount) > 0)
  const eim = prod.find((p) => p && p.type === 'eim' && asNum(p.activeCount) > 0 &&
    (p.measurementType === 'production' || p.measurementType == null))

  if (eim && eimLooksLive(eim)) return fromBlock(eim, 'ct')
  if (inverters) return fromBlock(inverters, 'inverters')
  if (eim) return fromBlock(eim, 'eim-weak')
  return null
}

function nextLifetimeKwh (wattHours, prevKwh) {
  const kwh = Math.max(0, asNum(wattHours) / 1000)
  if (typeof prevKwh !== 'number' || isNaN(prevKwh) || prevKwh <= 0) return kwh
  // Lifetime should be monotonic. Envoy firmware is known to reset / jump
  // counters (HA: "lifetime reset"). Ignore a sudden drop unless we have
  // no previous value.
  if (kwh + 0.02 < prevKwh * 0.5 && prevKwh > 1) return prevKwh
  if (kwh + 0.02 < prevKwh) return prevKwh
  return kwh
}

function lineVoltage (raw, phaseCount, nominal) {
  let v = asNum(raw)
  // Metered aggregate rmsVoltage is often the SUM of phases (HA "Summed Voltage").
  if (v > 320 && phaseCount > 1) v = v / phaseCount
  if (v < 90) v = nominal
  return v
}

function mapToVictron (picked, cfg, state) {
  cfg = cfg || {}
  state = state || {}
  const nominal = asNum(cfg.nominalVoltage) || 230
  const watts = picked ? Math.max(0, asNum(picked.watts)) : 0
  const kwh = nextLifetimeKwh(picked ? picked.wattHours : 0, state.prevKwh)
  const pos = parseInt(cfg.position, 10)
  const payload = {
    Connected: picked ? 1 : 0,
    Position: (pos === 0 || pos === 1 || pos === 2) ? pos : 0,
    StatusCode: watts > 10 ? 7 : 8,
    ErrorCode: 0,
    CustomName: cfg.customName || 'Enphase IQ',
    'Ac/Power': round(watts, 1),
    'Ac/Energy/Forward': round(kwh, 3)
  }

  const lines = (picked && Array.isArray(picked.lines)) ? picked.lines : []
  const n = Math.max(lines.length, 1)
  for (let i = 0; i < 3; i++) {
    const prefix = 'Ac/L' + (i + 1)
    const line = lines[i]
    let p = 0
    let v = 0
    let c = 0
    let e = 0
    if (line) {
      p = Math.max(0, asNum(line.wNow))
      v = lineVoltage(line.rmsVoltage, 1, nominal)
      c = asNum(line.rmsCurrent)
      if (!c && v > 0) c = p / v
      e = asNum(line.whLifetime) / 1000
    } else if (i === 0 && picked) {
      p = watts
      v = lineVoltage(picked.voltage, n, nominal)
      c = v > 0 ? p / v : 0
      e = kwh
    }
    payload[prefix + '/Power'] = round(p, 1)
    payload[prefix + '/Voltage'] = round(v, 1)
    payload[prefix + '/Current'] = round(c, 2)
    payload[prefix + '/Energy/Forward'] = round(e, 3)
  }

  const maxP = asNum(cfg.maxPower)
  if (maxP > 0) payload['Ac/MaxPower'] = round(maxP, 0)
  return payload
}

function buildHostCandidates (opts) {
  opts = opts || {}
  const hosts = []
  const add = (h) => {
    const x = String(h || '').trim()
    if (!x) return
    if (hosts.indexOf(x) === -1) hosts.push(x)
  }
  add(opts.manualIp)
  add(opts.cachedIp)
  add('envoy.local')
  add('envoy')
  const serial = serialDigits(opts.serial)
  if (serial) {
    add('envoy-' + serial + '.local')
    add('envoy-' + serial)
  }
  ;(opts.extraHosts || []).forEach(add)
  return hosts
}

function expandScanIps (ifaces) {
  const ips = []
  const seen = {}
  ;(ifaces || []).forEach((iface) => {
    if (!iface || !iface.address) return
    const parts = String(iface.address).split('.').map(Number)
    if (parts.length !== 4 || parts.some((n) => isNaN(n))) return
    const mask = String(iface.netmask || '255.255.255.0').split('.').map(Number)
    // Only scan /24 (typical GX LAN). Larger nets would hammer the LAN.
    if (mask[0] !== 255 || mask[1] !== 255 || mask[2] !== 255) return
    const prefix = parts[0] + '.' + parts[1] + '.' + parts[2] + '.'
    const self = String(iface.address)
    for (let i = 1; i <= 254; i++) {
      const ip = prefix + i
      if (ip === self || seen[ip]) continue
      seen[ip] = true
      ips.push(ip)
    }
  })
  return ips
}

function positionLabel (pos) {
  const map = { 0: 'AC-in 1', 1: 'AC-uit', 2: 'AC-in 2' }
  return map[pos] || (pos == null || pos === '' ? '–' : String(pos))
}

function sourceLabel (source) {
  const map = {
    ct: 'productie-CT (metered)',
    inverters: 'micro-omvormers (standard/geen CT)',
    'pdm-eim': 'PDM meter',
    'pdm-pcu': 'PDM micro-omvormers',
    'eim-weak': 'EIM (zwakke meting)'
  }
  return map[source] || source || '–'
}

module.exports = {
  asNum,
  round,
  serialDigits,
  serialsMatch,
  parseEnvoyInfo,
  decodeJwt,
  tokenExpiryMs,
  tokenUserType,
  shouldRefreshToken,
  extractToken,
  isRetryableNet,
  isAuthFailure,
  pickProduction,
  nextLifetimeKwh,
  mapToVictron,
  buildHostCandidates,
  expandScanIps,
  positionLabel,
  sourceLabel
}
