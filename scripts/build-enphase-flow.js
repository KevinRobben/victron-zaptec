#!/usr/bin/env node
'use strict'

// Generates enphase-flows.json from enphase-lib.js + the node graph below.
// Run: node scripts/build-enphase-flow.js && node test-enphase-flow.js

const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const libSrc = fs.readFileSync(path.join(root, 'enphase-lib.js'), 'utf8')
  .replace(/module\.exports[\s\S]*$/, '')
  .trim()

function withLib (body) {
  return libSrc + '\n' + body.trim() + '\n'
}

function fn (id, z, name, func, extra) {
  extra = extra || {}
  return {
    id,
    type: 'function',
    z,
    name,
    func,
    outputs: extra.outputs == null ? 1 : extra.outputs,
    timeout: extra.timeout == null ? '' : extra.timeout,
    noerr: 0,
    initialize: '',
    finalize: '',
    libs: extra.libs || [],
    x: extra.x,
    y: extra.y,
    wires: extra.wires,
    outputLabels: extra.outputLabels
  }
}

function httpReq (id, z, name, extra) {
  extra = extra || {}
  return {
    id,
    type: 'http request',
    z,
    name,
    method: 'use',
    ret: extra.ret || 'txt',
    paytoqs: 'ignore',
    url: '',
    tls: extra.tls || '',
    persist: false,
    proxy: '',
    insecureHTTPParser: false,
    authType: '',
    senderr: true,
    headers: [],
    x: extra.x,
    y: extra.y,
    wires: extra.wires
  }
}

function inject (id, z, name, extra) {
  extra = extra || {}
  return {
    id,
    type: 'inject',
    z,
    name,
    props: [{ p: 'payload' }],
    repeat: extra.repeat || '',
    crontab: '',
    once: extra.once !== false,
    onceDelay: extra.onceDelay == null ? '1' : String(extra.onceDelay),
    topic: '',
    payload: '',
    payloadType: 'date',
    x: extra.x,
    y: extra.y,
    wires: extra.wires
  }
}

function debugNode (id, z, name, extra) {
  extra = extra || {}
  return {
    id,
    type: 'debug',
    z,
    name,
    active: extra.active !== false,
    tosidebar: true,
    console: false,
    tostatus: !!extra.tostatus,
    complete: extra.complete || 'payload',
    targetType: 'msg',
    statusVal: extra.statusVal || '',
    statusType: 'auto',
    x: extra.x,
    y: extra.y,
    wires: []
  }
}

const NET_LIBS = [
  { var: 'dns', module: 'dns' },
  { var: 'os', module: 'os' },
  { var: 'http', module: 'http' },
  { var: 'https', module: 'https' }
]

const nodes = []

nodes.push(
  {
    id: 'f_e_dash',
    type: 'tab',
    label: 'Enphase configuratie (VRM)',
    disabled: false,
    info: 'Invulformulier: Enlighten-e-mail, wachtwoord en IQ Gateway-serienummer. De flow zoekt zelf het LAN-IP, haalt een local-API-token op en toont status. Bereikbaar via VRM -> Venus OS Large -> dashboard-tegel. Vereist @flowfuse/node-red-dashboard.'
  },
  {
    id: 'f_e_poll',
    type: 'tab',
    label: 'Enphase -> Victron (uitlezen)',
    disabled: false,
    info: 'Leest de IQ Gateway read-only uit via de lokale API (werkt voor Metered én Standard, zonder Modbus TCP) en toont de PV-productie als virtuele Victron PV-omvormer (Venus OS 3.70+ / node-red-contrib-victron).'
  },
  {
    id: 'e_ui_base',
    type: 'ui-base',
    name: 'Enphase',
    path: '/dashboard',
    appIcon: '',
    includeClientData: false,
    acceptsClientConfig: ['ui-notification', 'ui-control'],
    showPathInSidebar: false,
    headerContent: 'page',
    navigationStyle: 'default',
    titleBarStyle: 'default',
    showReconnectNotification: true,
    notificationDisplayTime: 1,
    showDisconnectNotification: true,
    allowInstall: false
  },
  {
    id: 'e_ui_theme',
    type: 'ui-theme',
    name: 'Enphase Theme',
    colors: {
      surface: '#ffffff',
      primary: '#D85A1A',
      bgPage: '#eeeeee',
      groupBg: '#ffffff',
      groupOutline: '#cccccc'
    },
    sizes: {
      density: 'default',
      pagePadding: '12px',
      groupGap: '12px',
      groupBorderRadius: '4px',
      widgetGap: '12px'
    }
  },
  {
    id: 'e_ui_page',
    type: 'ui-page',
    name: 'Enphase',
    ui: 'e_ui_base',
    path: '/enphase',
    icon: 'solar-power',
    layout: 'grid',
    theme: 'e_ui_theme',
    breakpoints: [
      { name: 'Default', px: 0, cols: 3 },
      { name: 'Tablet', px: 576, cols: 6 },
      { name: 'Small Desktop', px: 768, cols: 9 },
      { name: 'Desktop', px: 1024, cols: 12 }
    ],
    order: 1,
    className: '',
    visible: 'true',
    disabled: 'false'
  },
  {
    id: 'e_ui_group',
    type: 'ui-group',
    name: 'Enphase instellingen',
    page: 'e_ui_page',
    width: 6,
    height: 1,
    order: 1,
    showTitle: true,
    className: '',
    visible: true,
    disabled: false,
    groupType: 'default'
  },
  {
    id: 'e_tls',
    type: 'tls-config',
    name: 'Enphase self-signed',
    cert: '',
    key: '',
    ca: '',
    certname: '',
    servername: '',
    verifyservercert: false,
    alpnprotocol: ''
  }
)

nodes.push({
  id: 'e_d_comment',
  type: 'comment',
  z: 'f_e_dash',
  name: 'Configuratie via VRM (Venus OS Large -> dashboard-tegel)',
  info: 'Vul Enlighten-e-mail, wachtwoord en IQ Gateway-serienummer in. De flow vindt zelf het IP (envoy.local + LAN-scan van /info), haalt een JWT op bij Enlighten/entrez en leest daarna lokaal uit. Token owner ≈ 1 jaar, installer ≈ 12 uur. MFA: plak een token van https://entrez.enphaseenergy.com.',
  x: 330,
  y: 40,
  wires: []
})

nodes.push(inject('e_d_load_inj', 'f_e_dash', 'Laad opgeslagen config', {
  x: 160, y: 100, wires: [['e_d_file_in']]
}))

nodes.push({
  id: 'e_d_file_in',
  type: 'file in',
  z: 'f_e_dash',
  name: 'Lees config',
  filename: '/data/enphase-config.json',
  filenameType: 'str',
  format: 'utf8',
  chunk: false,
  sendError: false,
  encoding: 'none',
  allProps: false,
  x: 380,
  y: 100,
  wires: [['e_d_fn_load']]
})

nodes.push(fn('e_d_fn_load', 'f_e_dash', 'Config -> context', `
let cfg = {};
try { cfg = JSON.parse(msg.payload); } catch (e) { cfg = {}; }
if (!cfg || typeof cfg !== 'object') cfg = {};
global.set('enphaseCfg', cfg);
if (cfg.token) global.set('enphaseToken', cfg.token);
if (cfg.tokenExpiry) global.set('enphaseTokenExpiry', cfg.tokenExpiry);
node.status({ fill: 'green', shape: 'dot', text: 'config geladen' });
const posVal = parseInt(cfg.position, 10);
const posMsg = { payload: (posVal === 0 || posVal === 1 || posVal === 2) ? posVal : 0 };
const userMsg = cfg.username ? { payload: {
    username: cfg.username,
    password: '',
    serial: cfg.serial || '',
    token: '',
    ip: cfg.ip || ''
} } : null;
return [posMsg, userMsg, {}];
`, { outputs: 3, x: 620, y: 100, wires: [['e_d_pos'], ['e_d_form'], ['e_d_fn_summary']] }))

nodes.push({
  id: 'e_d_form',
  type: 'ui-form',
  z: 'f_e_dash',
  name: 'Inloggegevens',
  group: 'e_ui_group',
  label: '',
  order: 2,
  width: 0,
  height: 0,
  options: [
    { label: 'Gebruikersnaam (e-mail)', key: 'username', type: 'text', required: true, rows: null },
    { label: 'Wachtwoord', key: 'password', type: 'password', required: false, rows: null },
    { label: 'IQ Gateway serienummer', key: 'serial', type: 'text', required: true, rows: null },
    { label: 'Token (optioneel, bij MFA)', key: 'token', type: 'password', required: false, rows: null },
    { label: 'IP-adres (leeg = automatisch zoeken)', key: 'ip', type: 'text', required: false, rows: null }
  ],
  formValue: {},
  payload: '',
  submit: 'Opslaan en verbinden',
  cancel: 'Wissen',
  resetOnSubmit: false,
  topic: 'topic',
  topicType: 'msg',
  splitLayout: '',
  className: '',
  passthru: false,
  dropdownOptions: [],
  x: 390,
  y: 180,
  wires: [['e_d_fn_save']]
})

nodes.push(fn('e_d_fn_save', 'f_e_dash', 'Gegevens opslaan', withLib(`
const p = msg.payload || {};
const prev = global.get('enphaseCfg') || {};
const cfg = {
    username: String(p.username || '').trim() || prev.username || '',
    password: String(p.password || '') || prev.password || '',
    serial: serialDigits(p.serial || prev.serial || ''),
    ip: String(p.ip || '').trim() || '',
    token: String(p.token || '').trim() || prev.token || '',
    position: (prev.position === 0 || prev.position === 1 || prev.position === 2) ? prev.position : 0,
    firmware: prev.firmware || '',
    proto: prev.proto || 'https',
    source: prev.source || ''
};
if (!cfg.serial) {
    node.status({ fill: 'red', shape: 'dot', text: 'serienummer ontbreekt' });
    return [null, { payload: 'Vul het IQ Gateway-serienummer in.' }, null, null];
}
if (!cfg.username && !cfg.token) {
    node.status({ fill: 'red', shape: 'dot', text: 'e-mail of token nodig' });
    return [null, { payload: 'Vul Enlighten-e-mail + wachtwoord in, of plak een token (MFA).' }, null, null];
}
if (cfg.token) {
    global.set('enphaseToken', cfg.token);
    const exp = tokenExpiryMs(cfg.token);
    if (exp) {
        cfg.tokenExpiry = exp;
        global.set('enphaseTokenExpiry', exp);
    }
}
global.set('enphaseCfg', cfg);
global.set('enphaseForceDiscover', true);
node.status({ fill: 'green', shape: 'dot', text: 'opgeslagen' });
return [
    { payload: JSON.stringify(cfg, null, 2), filename: '/data/enphase-config.json' },
    { payload: 'Gegevens opgeslagen. Gateway wordt gezocht...' },
    { payload: 'discover', _enphaseFullScan: true },
    {}
];
`), {
  outputs: 4,
  x: 640,
  y: 180,
  wires: [['e_d_file_out'], ['e_d_notif'], ['e_d_fn_discover'], ['e_d_fn_summary']]
}))

nodes.push({
  id: 'e_d_file_out',
  type: 'file',
  z: 'f_e_dash',
  name: 'Schrijf config',
  filename: '/data/enphase-config.json',
  filenameType: 'str',
  appendNewline: false,
  createDir: true,
  overwriteFile: 'true',
  encoding: 'utf8',
  x: 930,
  y: 120,
  wires: [[]]
})

nodes.push({
  id: 'e_d_pos',
  type: 'ui-dropdown',
  z: 'f_e_dash',
  group: 'e_ui_group',
  name: 'Positie',
  label: 'Positie van de PV-omvormer',
  tooltip: 'Victron D-Bus /Position: 0 = AC-in 1, 1 = AC-uit, 2 = AC-in 2',
  order: 3,
  width: 0,
  height: 0,
  passthru: false,
  multiple: false,
  chips: false,
  clearable: false,
  options: [
    { value: 0, label: 'AC-in 1', type: 'num' },
    { value: 1, label: 'AC-uit', type: 'num' },
    { value: 2, label: 'AC-in 2', type: 'num' }
  ],
  payload: '',
  topic: 'topic',
  topicType: 'msg',
  className: '',
  typeIsComboBox: false,
  msgTrigger: 'onChange',
  x: 390,
  y: 260,
  wires: [['e_d_fn_possave']]
})

nodes.push(fn('e_d_fn_possave', 'f_e_dash', 'Positie opslaan', withLib(`
if (typeof msg.payload === 'object' && msg.payload !== null) return null;
const val = parseInt(msg.payload, 10);
if (val !== 0 && val !== 1 && val !== 2) return null;
const cfg = global.get('enphaseCfg') || {};
if (cfg.position === val) return null;
cfg.position = val;
global.set('enphaseCfg', cfg);
node.status({ fill: 'green', shape: 'dot', text: 'positie ' + val });
return [
    { payload: JSON.stringify(cfg, null, 2), filename: '/data/enphase-config.json' },
    { payload: 'Positie ingesteld op ' + positionLabel(val) + '.' },
    {}
];
`), {
  outputs: 3,
  x: 640,
  y: 260,
  wires: [['e_d_file_out'], ['e_d_notif'], ['e_d_fn_summary']]
}))

nodes.push({
  id: 'e_d_btn_discover',
  type: 'ui-button',
  z: 'f_e_dash',
  group: 'e_ui_group',
  name: 'Gateway zoeken',
  label: 'Gateway zoeken',
  order: 4,
  width: 3,
  height: 1,
  passthru: false,
  tooltip: 'Zoekt het LAN-IP van de IQ Gateway (envoy.local + /info-scan)',
  color: '',
  bgcolor: '',
  className: '',
  icon: 'wifi',
  iconPosition: 'left',
  payload: 'discover',
  payloadType: 'str',
  topic: 'enphaseAction',
  topicType: 'str',
  buttonColor: '',
  textColor: '',
  iconColor: '',
  enableClick: true,
  enablePointerdown: false,
  pointerdownPayload: '',
  pointerdownPayloadType: 'str',
  enablePointerup: false,
  pointerupPayload: '',
  pointerupPayloadType: 'str',
  x: 400,
  y: 330,
  wires: [['e_d_fn_discover']]
})

nodes.push({
  id: 'e_d_btn_token',
  type: 'ui-button',
  z: 'f_e_dash',
  group: 'e_ui_group',
  name: 'Token vernieuwen',
  label: 'Token vernieuwen',
  order: 5,
  width: 3,
  height: 1,
  passthru: false,
  tooltip: 'Haalt een nieuw local-API-token op bij Enlighten',
  color: '',
  bgcolor: '',
  className: '',
  icon: 'refresh',
  iconPosition: 'left',
  payload: 'token',
  payloadType: 'str',
  topic: 'enphaseAction',
  topicType: 'str',
  buttonColor: '',
  textColor: '',
  iconColor: '',
  enableClick: true,
  enablePointerdown: false,
  pointerdownPayload: '',
  pointerdownPayloadType: 'str',
  enablePointerup: false,
  pointerupPayload: '',
  pointerupPayloadType: 'str',
  x: 400,
  y: 380,
  wires: [['e_d_fn_loginprep']]
})

nodes.push(fn('e_d_fn_discover', 'f_e_dash', 'Gateway zoeken', withLib(`
const cfg = global.get('enphaseCfg') || {};
const serial = serialDigits(cfg.serial || env.get('ENPHASE_SERIAL') || '');
if (!serial) {
    node.status({ fill: 'yellow', shape: 'ring', text: 'geen serienummer' });
    return [null, { payload: 'Vul eerst het IQ Gateway-serienummer in en sla op.' }];
}

const fullScan = msg._enphaseFullScan !== false && msg.payload !== 'light';
node.status({ fill: 'blue', shape: 'ring', text: 'zoeken...' });

function getInfo(host, proto) {
    return new Promise((resolve) => {
        const lib = proto === 'http' ? http : https;
        const req = lib.request({
            hostname: host,
            port: proto === 'http' ? 80 : 443,
            path: '/info',
            method: 'GET',
            timeout: 1200,
            headers: { Accept: '*/*', Connection: 'close' },
            rejectUnauthorized: false
        }, (res) => {
            let data = '';
            res.on('data', (c) => { data += c; if (data.length > 30000) res.destroy(); });
            res.on('end', () => resolve({ ok: res.statusCode === 200, status: res.statusCode, body: data, proto: proto, host: host }));
        });
        req.on('error', () => resolve(null));
        req.on('timeout', () => { req.destroy(); resolve(null); });
        req.end();
    });
}

async function probe(host) {
    let h = host;
    if (!/^\\d+\\.\\d+\\.\\d+\\.\\d+$/.test(host)) {
        try {
            const looked = await dns.promises.lookup(host, { family: 4 });
            if (looked && looked.address) h = looked.address;
        } catch (e) { /* mDNS ontbreekt vaak op de GX; dan LAN-scan */ }
    }
    let r = await getInfo(h, 'https');
    if (!r || !r.ok) r = await getInfo(h, 'http');
    return r;
}

function localIfaces() {
    const nets = os.networkInterfaces() || {};
    const out = [];
    Object.keys(nets).forEach((name) => {
        if (/^(lo|docker|br-|veth|tun|wg|ppp|can)/i.test(name)) return;
        (nets[name] || []).forEach((addr) => {
            const family = addr.family;
            if (family !== 'IPv4' && family !== 4) return;
            if (addr.internal) return;
            out.push({ address: addr.address, netmask: addr.netmask });
        });
    });
    return out;
}

return (async () => {
    const hosts = buildHostCandidates({
        manualIp: cfg.ip,
        cachedIp: cfg.ip,
        serial: serial
    });
    let found = null;
    for (let i = 0; i < hosts.length; i++) {
        const r = await probe(hosts[i]);
        if (!r || !r.ok) continue;
        const info = parseEnvoyInfo(r.body);
        if (serialsMatch(info.serial, serial)) {
            found = { ip: r.host, proto: r.proto, info: info };
            break;
        }
    }
    if (!found && fullScan) {
        const ips = expandScanIps(localIfaces());
        const batchSize = 24;
        for (let i = 0; i < ips.length && !found; i += batchSize) {
            const batch = ips.slice(i, i + batchSize);
            const results = await Promise.all(batch.map((ip) => probe(ip)));
            for (let j = 0; j < results.length; j++) {
                const r = results[j];
                if (!r || !r.ok) continue;
                const info = parseEnvoyInfo(r.body);
                if (serialsMatch(info.serial, serial)) {
                    found = { ip: r.host, proto: r.proto, info: info };
                    break;
                }
            }
        }
    }
    if (!found) {
        node.status({ fill: 'red', shape: 'dot', text: 'gateway niet gevonden' });
        return [null, { payload: 'IQ Gateway niet gevonden op het LAN. Zet Cerbo en Envoy op hetzelfde netwerk, of vul het IP handmatig in.' }];
    }
    cfg.ip = found.ip;
    cfg.proto = found.proto;
    cfg.firmware = found.info.software;
    cfg.part = found.info.part;
    cfg.webTokens = found.info.webTokens;
    global.set('enphaseCfg', cfg);
    global.set('enphaseForceDiscover', false);
    node.status({ fill: 'green', shape: 'dot', text: found.ip });
    const needToken = found.info.webTokens !== false;
    const notice = 'Gateway gevonden: ' + found.ip + ' (FW ' + (found.info.software || '?') + ').' +
        (needToken ? ' Token wordt opgehaald...' : ' Firmware < 7, geen token nodig.');
    return [
        { payload: JSON.stringify(cfg, null, 2), filename: '/data/enphase-config.json', _enphaseNeedToken: needToken },
        { payload: notice }
    ];
})();
`), {
  outputs: 2,
  timeout: '60000',
  libs: NET_LIBS,
  x: 650,
  y: 330,
  wires: [['e_d_file_out', 'e_d_fn_afterdisc'], ['e_d_notif', 'e_d_status_txt']],
  outputLabels: ['gevonden', 'fout']
}))

nodes.push(fn('e_d_fn_afterdisc', 'f_e_dash', 'Na zoeken: token?', `
const cfg = global.get('enphaseCfg') || {};
if (cfg.webTokens === false) {
    node.status({ fill: 'green', shape: 'dot', text: 'geen token nodig' });
    return [null, {}];
}
return [{}, {}];
`, {
  outputs: 2,
  x: 930,
  y: 330,
  wires: [['e_d_fn_loginprep'], ['e_d_fn_summary']],
  outputLabels: ['token ophalen', 'samenvatting']
}))

nodes.push(fn('e_d_fn_loginprep', 'f_e_dash', 'Enlighten-login', withLib(`
const g = global.get('enphaseCfg') || {};
if (g.token && !shouldRefreshToken(g.token) && msg.payload !== 'token' && !msg._enphaseForceAuth) {
    global.set('enphaseToken', g.token);
    node.status({ fill: 'green', shape: 'dot', text: 'token nog geldig' });
    return [null, { payload: 'Bestaand token is nog geldig tot ' + new Date(tokenExpiryMs(g.token)).toLocaleString('nl-NL') + '.' }];
}
if (!g.username || !g.password) {
    node.status({ fill: 'yellow', shape: 'ring', text: 'geen Enlighten-inlog' });
    return [null, { payload: 'Geen Enlighten-wachtwoord. Plak een token (MFA) of vul e-mail + wachtwoord in.' }];
}
if (!g.serial) {
    return [null, { payload: 'Serienummer ontbreekt; token kan niet worden aangevraagd.' }];
}
delete msg.headers;
delete msg.responseUrl;
delete msg.redirectList;
delete msg.responseCookies;
delete msg.cookies;
delete msg.statusCode;
delete msg.error;
msg.method = 'POST';
msg.url = 'https://enlighten.enphaseenergy.com/login/login.json?';
msg.headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
    Connection: 'close'
};
msg.payload = 'user[email]=' + encodeURIComponent(g.username) + '&user[password]=' + encodeURIComponent(g.password);
msg.requestTimeout = 20000;
msg._enphaseStep = 'login';
node.status({ fill: 'blue', shape: 'ring', text: 'Enlighten-login...' });
return [msg, { payload: 'Token ophalen bij Enlighten...' }];
`), {
  outputs: 2,
  x: 640,
  y: 430,
  wires: [['e_d_login'], ['e_d_notif']]
}))

nodes.push(httpReq('e_d_login', 'f_e_dash', 'POST Enlighten login', {
  ret: 'obj', x: 890, y: 430, wires: [['e_d_fn_loginres']]
}))

nodes.push(fn('e_d_fn_loginres', 'f_e_dash', 'Session -> tokenrequest', withLib(`
const body = (msg.payload && typeof msg.payload === 'object') ? msg.payload : {};
const code = msg.statusCode;
const payloadStr = (typeof msg.payload === 'string') ? msg.payload : '';
if (isRetryableNet(code, msg.error, payloadStr) || !body.session_id) {
    const mfa = body && typeof body === 'object' && !body.session_id && (code === 200 || code === 401);
    node.status({ fill: 'red', shape: 'dot', text: mfa ? 'MFA of verkeerde inlog' : ('login ' + (code || 'fout')) });
    const text = mfa
        ? 'Enlighten gaf geen session_id. Controleer e-mail/wachtwoord, of schakel MFA uit / plak een token van entrez.enphaseenergy.com.'
        : 'Inloggen bij Enlighten mislukt (HTTP ' + (code || '?') + ').';
    return [null, { payload: text }];
}
const g = global.get('enphaseCfg') || {};
delete msg.headers;
delete msg.responseUrl;
delete msg.redirectList;
delete msg.responseCookies;
delete msg.statusCode;
delete msg.error;
msg.method = 'POST';
msg.url = 'https://entrez.enphaseenergy.com/tokens';
msg.headers = { 'Content-Type': 'application/json', Accept: 'application/json', Connection: 'close' };
msg.payload = { session_id: body.session_id, serial_num: g.serial, username: g.username };
msg.requestTimeout = 20000;
msg._enphaseStep = 'token';
return [msg, null];
`), {
  outputs: 2,
  x: 1160,
  y: 430,
  wires: [['e_d_tokreq'], ['e_d_notif']]
}))

nodes.push(httpReq('e_d_tokreq', 'f_e_dash', 'POST entrez tokens', {
  ret: 'txt', x: 1410, y: 430, wires: [['e_d_fn_toksave']]
}))

nodes.push(fn('e_d_fn_toksave', 'f_e_dash', 'Token opslaan', withLib(`
const token = extractToken(msg.payload);
const code = msg.statusCode;
if (!token || token.indexOf('eyJ') !== 0) {
    node.status({ fill: 'red', shape: 'dot', text: 'token mislukt (' + (code || '?') + ')' });
    return [null, { payload: 'Token ophalen mislukt (HTTP ' + (code || '?') + '). Controleer of dit Enlighten-account bij de gateway hoort.' }];
}
const cfg = global.get('enphaseCfg') || {};
cfg.token = token;
cfg.tokenExpiry = tokenExpiryMs(token);
cfg.tokenUser = tokenUserType(token);
global.set('enphaseCfg', cfg);
global.set('enphaseToken', token);
global.set('enphaseTokenExpiry', cfg.tokenExpiry);
node.status({ fill: 'green', shape: 'dot', text: cfg.tokenUser || 'token ok' });
const until = cfg.tokenExpiry ? new Date(cfg.tokenExpiry).toLocaleString('nl-NL') : '?';
return [
    { payload: JSON.stringify(cfg, null, 2), filename: '/data/enphase-config.json' },
    { payload: 'Token opgeslagen (' + (cfg.tokenUser || 'owner') + '), geldig tot ' + until + '.' },
    {}
];
`), {
  outputs: 3,
  x: 1630,
  y: 430,
  wires: [['e_d_file_out'], ['e_d_notif'], ['e_d_fn_summary']]
}))

nodes.push({
  id: 'e_d_status_txt',
  type: 'ui-text',
  z: 'f_e_dash',
  group: 'e_ui_group',
  order: 7,
  width: 0,
  height: 0,
  name: 'Status',
  label: 'Status',
  format: '{{msg.payload}}',
  layout: 'col-center',
  style: false,
  font: '',
  fontSize: 16,
  color: '#717171',
  wrapText: true,
  className: '',
  value: 'payload',
  valueType: 'msg',
  x: 390,
  y: 540,
  wires: []
})

nodes.push({
  id: 'e_d_status_in',
  type: 'link in',
  z: 'f_e_dash',
  name: 'status in',
  links: ['e_p_status_out'],
  x: 175,
  y: 540,
  wires: [['e_d_status_txt']]
})

nodes.push({
  id: 'e_d_notif',
  type: 'ui-notification',
  z: 'f_e_dash',
  ui: 'e_ui_base',
  name: 'Melding',
  position: 'top right',
  colorDefault: true,
  color: null,
  displayTime: '5',
  showCountdown: true,
  outputs: 1,
  allowDismiss: true,
  dismissText: 'Sluiten',
  allowConfirm: false,
  confirmText: 'OK',
  raw: false,
  className: '',
  x: 1080,
  y: 260,
  wires: [[]]
})

nodes.push({
  id: 'e_d_pageview',
  type: 'ui-event',
  z: 'f_e_dash',
  ui: 'e_ui_base',
  name: 'Pagina geopend',
  x: 140,
  y: 620,
  wires: [['e_d_page_delay']]
})

nodes.push({
  id: 'e_d_page_delay',
  type: 'delay',
  z: 'f_e_dash',
  name: 'wacht op UI',
  pauseType: 'delay',
  timeout: '400',
  timeoutUnits: 'milliseconds',
  rate: '1',
  nbRateUnits: '1',
  rateUnits: 'second',
  randomFirst: '1',
  randomLast: '5',
  randomUnits: 'seconds',
  drop: false,
  outputs: 1,
  x: 260,
  y: 680,
  wires: [['e_d_fn_populate']]
})

nodes.push(fn('e_d_fn_populate', 'f_e_dash', 'UI vullen', `
if (msg.topic === '$pageleave') return [null, null, null];
const cfg = global.get('enphaseCfg') || {};
const client = msg._client;
function withClient(m) {
    if (m && client) m._client = client;
    return m;
}
const userMsg = withClient({ payload: {
    username: cfg.username || '',
    password: '',
    serial: cfg.serial || '',
    token: '',
    ip: cfg.ip || ''
} });
const posVal = parseInt(cfg.position, 10);
const posMsg = withClient({ payload: (posVal === 0 || posVal === 1 || posVal === 2) ? posVal : 0 });
return [userMsg, posMsg, {}];
`, {
  outputs: 3,
  x: 400,
  y: 680,
  wires: [['e_d_form'], ['e_d_pos'], ['e_d_fn_summary']]
}))

nodes.push({
  id: 'e_d_catch',
  type: 'catch',
  z: 'f_e_dash',
  name: 'onderdruk fouten (bv. bestand ontbreekt)',
  scope: ['e_d_file_in'],
  uncaught: false,
  x: 260,
  y: 740,
  wires: [[]]
})

nodes.push(fn('e_d_fn_summary', 'f_e_dash', 'Huidige instelling', withLib(`
const cfg = global.get('enphaseCfg') || {};
const exp = cfg.tokenExpiry || global.get('enphaseTokenExpiry') || 0;
const expTxt = exp ? new Date(exp).toLocaleDateString('nl-NL') : '–';
msg.payload = 'SN: ' + (cfg.serial || '–') +
    '  |  IP: ' + (cfg.ip || '–') +
    '  |  FW: ' + (cfg.firmware || '–') +
    '  |  Token tot: ' + expTxt +
    '  |  Positie: ' + positionLabel(cfg.position) +
    '  |  Bron: ' + sourceLabel(cfg.source);
return msg;
`), { x: 640, y: 620, wires: [['e_d_summary_txt']] }))

nodes.push({
  id: 'e_d_summary_txt',
  type: 'ui-text',
  z: 'f_e_dash',
  group: 'e_ui_group',
  order: 1,
  width: 0,
  height: 0,
  name: 'Huidige instelling',
  label: 'Huidige instelling',
  format: '{{msg.payload}}',
  layout: 'col-center',
  style: false,
  font: '',
  fontSize: 16,
  color: '#333333',
  wrapText: true,
  className: '',
  value: 'payload',
  valueType: 'msg',
  x: 880,
  y: 620,
  wires: []
})

// ---- poll tab ----
nodes.push({
  id: 'e_p_comment',
  type: 'comment',
  z: 'f_e_poll',
  name: 'Lokaal pollen: niet sneller dan 15s (Envoy kan vastlopen). CT ~live, micro-omvormers ~5 min.',
  info: 'Gebruik /production.json?details=1. Bij production-CT (activeCount>0 en echte waarden) die bron; anders inverters-segment (Standard / metered zonder spoelen). /api/v1/production geeft daar nullen. Token 30 dagen voor expiry vernieuwen (installer: 2 uur).',
  x: 410,
  y: 40,
  wires: []
})

nodes.push(inject('e_p_tick', 'f_e_poll', 'Basistik (10s)', {
  repeat: '10', onceDelay: '10', x: 140, y: 120, wires: [['e_p_sched']]
}))

nodes.push(fn('e_p_sched', 'f_e_poll', 'Adaptieve planner', `
const now = Date.now();
const S = 1000;
const iWatch = Math.max(15, parseInt(env.get('ENPHASE_POLL_WATCHING_SEC'), 10) || 20) * S;
const iProd = Math.max(15, parseInt(env.get('ENPHASE_POLL_PRODUCING_SEC'), 10) || 30) * S;
const iIdle = Math.max(30, parseInt(env.get('ENPHASE_POLL_IDLE_SEC'), 10) || 120) * S;
const watchTimeout = (parseInt(env.get('ENPHASE_WATCH_TIMEOUT_SEC'), 10) || 90) * S;
const lastAct = flow.get('lastVrmActivity') || 0;
const watching = (now - lastAct) < watchTimeout;
const producing = flow.get('enphaseProducing') === true;
const interval = watching ? iWatch : (producing ? iProd : iIdle);
const inflightSince = flow.get('enphaseInFlightSince') || 0;
if (flow.get('enphaseInFlight') && (now - inflightSince) < 90000) {
    node.status({ fill: 'yellow', shape: 'ring', text: 'wacht op vorige request' });
    return null;
}
const fails = flow.get('enphaseFailCount') || 0;
const extraBackoff = fails >= 3 ? Math.min(fails, 8) * 15000 : 0;
const lastFetch = flow.get('lastFetchTs') || 0;
const force = global.get('enphaseForceDiscover') || global.get('enphaseForceAuth');
if (force || now - lastFetch >= interval + extraBackoff) {
    flow.set('lastFetchTs', now);
    flow.set('enphaseInFlight', true);
    flow.set('enphaseInFlightSince', now);
    const mode = watching ? 'live' : (producing ? 'productie' : 'idle');
    node.status({ fill: 'blue', shape: 'ring', text: 'poll (' + mode + ')' });
    return msg;
}
return null;
`, { x: 340, y: 120, wires: [['e_p_prep']] }))

nodes.push({
  id: 'e_p_mqtt_broker',
  type: 'mqtt-broker',
  name: 'Venus OS broker (localhost)',
  broker: '127.0.0.1',
  port: '1883',
  clientid: '',
  autoConnect: true,
  usetls: false,
  protocolVersion: '4',
  keepalive: '60',
  cleansession: true,
  birthTopic: '',
  birthQos: '0',
  birthPayload: '',
  birthMsg: {},
  closeTopic: '',
  closeQos: '0',
  closePayload: '',
  closeMsg: {},
  willTopic: '',
  willQos: '0',
  willPayload: '',
  willMsg: {},
  userProps: '',
  sessionExpiry: ''
})

nodes.push({
  id: 'e_p_mqtt_in',
  type: 'mqtt in',
  z: 'f_e_poll',
  name: 'Live-kijk detectie',
  topic: 'N/+/system/0/#',
  qos: '0',
  datatype: 'auto-detect',
  broker: 'e_p_mqtt_broker',
  nl: false,
  rap: true,
  rh: 0,
  inputs: 0,
  x: 140,
  y: 200,
  wires: [['e_p_fn_activity']]
})

nodes.push(fn('e_p_fn_activity', 'f_e_poll', 'Kijk-activiteit noteren', `
flow.set('lastVrmActivity', Date.now());
return null;
`, { x: 370, y: 200, wires: [[]] }))

nodes.push(fn('e_p_prep', 'f_e_poll', '1. Config & token', withLib(`
const g = global.get('enphaseCfg') || {};
const cfg = {
    username: g.username || env.get('ENPHASE_USERNAME') || '',
    password: g.password || env.get('ENPHASE_PASSWORD') || '',
    serial: serialDigits(g.serial || env.get('ENPHASE_SERIAL') || ''),
    ip: g.ip || env.get('ENPHASE_IP') || '',
    token: g.token || global.get('enphaseToken') || env.get('ENPHASE_TOKEN') || '',
    position: (g.position === 0 || g.position === 1 || g.position === 2) ? g.position : parseInt(env.get('ENPHASE_POSITION'), 10),
    proto: g.proto || 'https',
    webTokens: g.webTokens,
    firmware: g.firmware,
    customName: g.customName || 'Enphase IQ',
    nominalVoltage: asNum(env.get('ENPHASE_NOMINAL_VOLTAGE')) || 230,
    maxPower: asNum(g.maxPower || env.get('ENPHASE_MAX_POWER'))
};
if (isNaN(cfg.position)) cfg.position = 0;
flow.set('enphaseCfg', cfg);

if (!cfg.serial) {
    flow.set('enphaseInFlight', false);
    node.status({ fill: 'yellow', shape: 'ring', text: 'wacht op VRM-configuratie' });
    return [null, null, null];
}

const forceDisc = global.get('enphaseForceDiscover');
if (!cfg.ip || forceDisc) {
    msg.payload = 'light';
    msg._enphaseFullScan = false;
    node.status({ fill: 'blue', shape: 'ring', text: 'IP zoeken...' });
    return [null, null, msg];
}

const token = cfg.token || global.get('enphaseToken');
const forceAuth = global.get('enphaseForceAuth') || msg._enphaseForceAuth;
if (cfg.webTokens !== false && shouldRefreshToken(token) || forceAuth) {
    if (!cfg.username || !cfg.password) {
        if (token && !forceAuth) {
            msg.access_token = token;
            node.status({ fill: 'yellow', shape: 'ring', text: 'token bijna verlopen, geen wachtwoord' });
            return [null, msg, null];
        }
        flow.set('enphaseInFlight', false);
        node.status({ fill: 'yellow', shape: 'ring', text: 'token + inlog ontbreken' });
        return [null, null, null];
    }
    node.status({ fill: 'blue', shape: 'ring', text: 'token vernieuwen...' });
    return [msg, null, null];
}

msg.access_token = token;
node.status({ fill: 'green', shape: 'dot', text: 'token ok' });
return [null, msg, null];
`), {
  outputs: 3,
  x: 360,
  y: 300,
  wires: [['e_p_fn_loginprep'], ['e_p_fn_prod'], ['e_p_fn_rediscover']],
  outputLabels: ['nieuw token', 'token ok', 'IP zoeken']
}))

nodes.push(fn('e_p_fn_rediscover', 'f_e_poll', 'IP herstellen', withLib(`
const cfg = global.get('enphaseCfg') || flow.get('enphaseCfg') || {};
const serial = serialDigits(cfg.serial);
if (!serial) {
    flow.set('enphaseInFlight', false);
    return null;
}
node.status({ fill: 'blue', shape: 'ring', text: 'IP herstellen...' });

function getInfo(host, proto) {
    return new Promise((resolve) => {
        const lib = proto === 'http' ? http : https;
        const req = lib.request({
            hostname: host,
            port: proto === 'http' ? 80 : 443,
            path: '/info',
            method: 'GET',
            timeout: 1200,
            headers: { Accept: '*/*', Connection: 'close' },
            rejectUnauthorized: false
        }, (res) => {
            let data = '';
            res.on('data', (c) => { data += c; if (data.length > 30000) res.destroy(); });
            res.on('end', () => resolve({ ok: res.statusCode === 200, body: data, proto: proto, host: host }));
        });
        req.on('error', () => resolve(null));
        req.on('timeout', () => { req.destroy(); resolve(null); });
        req.end();
    });
}

async function probe(host) {
    let h = host;
    if (!/^\\d+\\.\\d+\\.\\d+\\.\\d+$/.test(host)) {
        try {
            const looked = await dns.promises.lookup(host, { family: 4 });
            if (looked && looked.address) h = looked.address;
        } catch (e) {}
    }
    let r = await getInfo(h, 'https');
    if (!r || !r.ok) r = await getInfo(h, 'http');
    return r;
}

return (async () => {
    const hosts = buildHostCandidates({ cachedIp: cfg.ip, serial: serial });
    for (let i = 0; i < hosts.length; i++) {
        const r = await probe(hosts[i]);
        if (!r || !r.ok) continue;
        const info = parseEnvoyInfo(r.body);
        if (!serialsMatch(info.serial, serial)) continue;
        cfg.ip = r.host;
        cfg.proto = r.proto;
        cfg.firmware = info.software;
        cfg.webTokens = info.webTokens;
        global.set('enphaseCfg', cfg);
        global.set('enphaseForceDiscover', false);
        flow.set('enphaseCfg', cfg);
        msg.access_token = cfg.token || global.get('enphaseToken');
        node.status({ fill: 'green', shape: 'dot', text: r.host });
        return [msg, { payload: JSON.stringify(cfg, null, 2), filename: '/data/enphase-config.json' }];
    }
    flow.set('enphaseInFlight', false);
    flow.set('enphaseFailCount', (flow.get('enphaseFailCount') || 0) + 1);
    node.status({ fill: 'red', shape: 'dot', text: 'IP zoeken mislukt' });
    msg.error = { message: 'IQ Gateway niet bereikbaar (IP zoeken mislukt). Klik in VRM op Gateway zoeken.' };
    return [null, null];
})();
`), {
  outputs: 2,
  timeout: '20000',
  libs: NET_LIBS,
  x: 340,
  y: 380,
  wires: [['e_p_fn_prod'], ['e_p_cfgwrite']]
}))

nodes.push({
  id: 'e_p_cfgwrite',
  type: 'file',
  z: 'f_e_poll',
  name: 'Schrijf config',
  filename: '/data/enphase-config.json',
  filenameType: 'str',
  appendNewline: false,
  createDir: true,
  overwriteFile: 'true',
  encoding: 'utf8',
  x: 560,
  y: 380,
  wires: [[]]
})

nodes.push(fn('e_p_fn_loginprep', 'f_e_poll', '2a. Enlighten-login', `
const cfg = flow.get('enphaseCfg') || global.get('enphaseCfg') || {};
delete msg.headers;
delete msg.responseUrl;
delete msg.redirectList;
delete msg.responseCookies;
delete msg.cookies;
delete msg.statusCode;
delete msg.error;
delete msg.access_token;
msg.method = 'POST';
msg.url = 'https://enlighten.enphaseenergy.com/login/login.json?';
msg.headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
    Connection: 'close'
};
msg.payload = 'user[email]=' + encodeURIComponent(cfg.username) + '&user[password]=' + encodeURIComponent(cfg.password);
msg.requestTimeout = 20000;
msg._enphaseStep = 'login';
return msg;
`, { x: 600, y: 80, wires: [['e_p_login']] }))

nodes.push(httpReq('e_p_login', 'f_e_poll', 'POST Enlighten login', {
  ret: 'obj', x: 840, y: 80, wires: [['e_p_fn_loginres']]
}))

nodes.push(fn('e_p_fn_loginres', 'f_e_poll', '2b. Token-request', withLib(`
const body = (msg.payload && typeof msg.payload === 'object') ? msg.payload : {};
const code = msg.statusCode;
const payloadStr = (typeof msg.payload === 'string') ? msg.payload : '';
if (!body.session_id) {
    if (isRetryableNet(code, msg.error, payloadStr)) {
        msg._enphaseStep = 'login';
        msg.error = { message: (msg.error && msg.error.message) || payloadStr || ('login HTTP ' + (code || '?')) };
        return [null, msg];
    }
    flow.set('enphaseInFlight', false);
    node.status({ fill: 'red', shape: 'dot', text: 'Enlighten-login mislukt' });
    node.error('Enphase: Enlighten-login mislukt (HTTP ' + (code || '?') + '). MFA? Plak dan een token in VRM.', msg);
    return [null, null];
}
const cfg = flow.get('enphaseCfg') || {};
delete msg.headers;
delete msg.responseUrl;
delete msg.redirectList;
delete msg.responseCookies;
delete msg.statusCode;
delete msg.error;
msg.method = 'POST';
msg.url = 'https://entrez.enphaseenergy.com/tokens';
msg.headers = { 'Content-Type': 'application/json', Accept: 'application/json', Connection: 'close' };
msg.payload = { session_id: body.session_id, serial_num: cfg.serial, username: cfg.username };
msg.requestTimeout = 20000;
msg._enphaseStep = 'token';
return [msg, null];
`), {
  outputs: 2,
  x: 1080,
  y: 80,
  wires: [['e_p_tokreq'], ['e_p_fn_retry']],
  outputLabels: ['ok', 'retry']
}))

nodes.push(httpReq('e_p_tokreq', 'f_e_poll', 'POST entrez tokens', {
  ret: 'txt', x: 1320, y: 80, wires: [['e_p_fn_toksave']]
}))

nodes.push(fn('e_p_fn_toksave', 'f_e_poll', '2c. Token opslaan', withLib(`
const token = extractToken(msg.payload);
const code = msg.statusCode;
const payloadStr = (typeof msg.payload === 'string') ? msg.payload : '';
if (!token || token.indexOf('eyJ') !== 0) {
    if (isRetryableNet(code, msg.error, payloadStr)) {
        msg._enphaseStep = 'login';
        msg.error = { message: payloadStr || ('token HTTP ' + (code || '?')) };
        return [null, null, msg];
    }
    flow.set('enphaseInFlight', false);
    node.status({ fill: 'red', shape: 'dot', text: 'token mislukt' });
    node.error('Enphase: token ophalen mislukt (HTTP ' + (code || '?') + ').', msg);
    return [null, null, null];
}
const cfg = flow.get('enphaseCfg') || global.get('enphaseCfg') || {};
cfg.token = token;
cfg.tokenExpiry = tokenExpiryMs(token);
cfg.tokenUser = tokenUserType(token);
global.set('enphaseCfg', cfg);
global.set('enphaseToken', token);
global.set('enphaseTokenExpiry', cfg.tokenExpiry);
global.set('enphaseForceAuth', false);
flow.set('enphaseCfg', cfg);
msg.access_token = token;
msg._enphaseForceAuth = false;
node.status({ fill: 'green', shape: 'dot', text: 'token vernieuwd' });
return [
    msg,
    { payload: JSON.stringify(cfg, null, 2), filename: '/data/enphase-config.json' },
    null
];
`), {
  outputs: 3,
  x: 1560,
  y: 80,
  wires: [['e_p_fn_prod'], ['e_p_cfgwrite'], ['e_p_fn_retry']],
  outputLabels: ['ok', 'config', 'retry']
}))

nodes.push(fn('e_p_fn_prod', 'f_e_poll', '3. Production-request', `
const cfg = flow.get('enphaseCfg') || global.get('enphaseCfg') || {};
const token = msg.access_token || global.get('enphaseToken') || cfg.token;
if (!cfg.ip) {
    flow.set('enphaseInFlight', false);
    node.status({ fill: 'red', shape: 'dot', text: 'geen IP' });
    return null;
}
const proto = cfg.proto || 'https';
delete msg.headers;
delete msg.responseUrl;
delete msg.redirectList;
delete msg.responseCookies;
delete msg.cookies;
delete msg.statusCode;
delete msg.error;
delete msg.payload;
msg.method = 'GET';
msg.headers = { Accept: 'application/json', Connection: 'close' };
if (token) msg.headers.Authorization = 'Bearer ' + token;
msg.url = proto + '://' + cfg.ip + '/production.json?details=1';
msg.requestTimeout = 20000;
msg._enphaseStep = 'production';
msg.followRedirects = true;
return msg;
`, { x: 600, y: 200, wires: [['e_p_prod']] }))

nodes.push(httpReq('e_p_prod', 'f_e_poll', 'GET production.json', {
  ret: 'obj', tls: 'e_tls', x: 850, y: 200, wires: [['e_p_fn_httpres']]
}))

nodes.push(fn('e_p_fn_httpres', 'f_e_poll', 'Production-response check', withLib(`
const code = msg.statusCode;
const err = msg.error;
const payloadStr = (typeof msg.payload === 'string') ? msg.payload : '';
if (isRetryableNet(code, err, payloadStr)) {
    msg._enphaseStep = msg._enphaseStep || 'production';
    msg.error = { message: (err && (err.message || String(err))) || payloadStr || ('RequestError ' + code) };
    node.status({ fill: 'yellow', shape: 'ring', text: 'netwerkfout, retry...' });
    return [null, msg];
}
if (isAuthFailure(code, msg.payload) || isAuthFailure(code, payloadStr)) {
    global.set('enphaseForceAuth', true);
    msg._enphaseForceAuth = true;
    msg._enphaseStep = 'login';
    msg.error = { message: 'HTTP ' + (code || 401) + ' (token ongeldig)' };
    node.status({ fill: 'yellow', shape: 'ring', text: 'token verlopen, opnieuw...' });
    return [null, msg];
}
if (code && code !== 200) {
    flow.set('enphaseInFlight', false);
    flow.set('enphaseFailCount', (flow.get('enphaseFailCount') || 0) + 1);
    node.status({ fill: 'red', shape: 'dot', text: 'production HTTP ' + code });
    node.error('Enphase production-request mislukt (HTTP ' + code + ').', msg);
    return [null, null];
}
if (!msg.payload || typeof msg.payload !== 'object' || Array.isArray(msg.payload) && !msg.payload.length) {
    if (typeof msg.payload === 'string' && /<html/i.test(msg.payload)) {
        global.set('enphaseForceAuth', true);
        msg._enphaseForceAuth = true;
        msg._enphaseStep = 'login';
        msg.error = { message: 'HTML i.p.v. JSON (niet ingelogd)' };
        return [null, msg];
    }
}
return [msg, null];
`), {
  outputs: 2,
  x: 1120,
  y: 200,
  wires: [['e_p_map'], ['e_p_fn_retry']],
  outputLabels: ['ok', 'retry']
}))

nodes.push(fn('e_p_map', 'f_e_poll', '4. Enphase -> Victron PV-omvormer', withLib(`
let data = msg.payload;
if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch (e) { data = null; }
}
const picked = pickProduction(data);
if (!picked) {
    flow.set('enphaseInFlight', false);
    node.status({ fill: 'yellow', shape: 'ring', text: 'geen productiedata' });
    return null;
}
const cfg = flow.get('enphaseCfg') || global.get('enphaseCfg') || {};
const prevKwh = flow.get('enphaseEnergyForward');
msg.payload = mapToVictron(picked, cfg, { prevKwh: prevKwh });
flow.set('enphaseEnergyForward', msg.payload['Ac/Energy/Forward']);
flow.set('enphaseProducing', msg.payload['Ac/Power'] > 50);
flow.set('enphaseInFlight', false);
flow.set('enphaseFailCount', 0);
cfg.source = picked.source;
global.set('enphaseCfg', cfg);
const src = sourceLabel(picked.source);
node.status({
    fill: msg.payload['Ac/Power'] > 10 ? 'green' : 'blue',
    shape: 'dot',
    text: round(msg.payload['Ac/Power'], 0) + ' W | ' + round(msg.payload['Ac/Energy/Forward'], 2) + ' kWh (' + picked.source + ')'
});
msg._enphaseSource = src;
return msg;
`), { x: 1410, y: 200, wires: [['e_p_meter', 'e_p_dbg', 'e_p_fn_status']] }))

nodes.push({
  id: 'e_p_meter',
  type: 'victron-virtual',
  z: 'f_e_poll',
  name: 'Enphase PV (Victron)',
  device: 'pvinverter',
  default_values: true,
  outputs: 1,
  position: '0',
  pvinverter_nrofphases: 3,
  pvinverter_auto_energy: true,
  x: 1720,
  y: 180,
  wires: [[]]
})

nodes.push(debugNode('e_p_dbg', 'f_e_poll', 'omvormer payload', {
  active: false, complete: 'payload', x: 1720, y: 240
}))

nodes.push(fn('e_p_fn_status', 'f_e_poll', 'Status -> dashboard', withLib(`
const p = msg.payload || {};
const cfg = global.get('enphaseCfg') || {};
const t = new Date().toLocaleTimeString('nl-NL');
msg.payload = 'Laatste uitlezing: ' + (p['Ac/Power'] != null ? p['Ac/Power'] : '?') + ' W, ' +
    (p['Ac/Energy/Forward'] != null ? p['Ac/Energy/Forward'] : '?') + ' kWh' +
    ' (' + sourceLabel(cfg.source) + ', ' + (cfg.ip || '?') + ') @ ' + t;
return msg;
`), { x: 1410, y: 300, wires: [['e_p_status_out']] }))

nodes.push({
  id: 'e_p_status_out',
  type: 'link out',
  z: 'f_e_poll',
  name: 'status',
  mode: 'link',
  links: ['e_d_status_in'],
  x: 1630,
  y: 300,
  wires: []
})

nodes.push({
  id: 'e_p_catch',
  type: 'catch',
  z: 'f_e_poll',
  name: 'fouten',
  scope: null,
  uncaught: false,
  x: 140,
  y: 460,
  wires: [['e_p_errdbg', 'e_p_fn_errstatus']]
})

nodes.push(debugNode('e_p_errdbg', 'f_e_poll', 'fout', {
  active: true, complete: 'error', tostatus: true, statusVal: 'error.message', x: 350, y: 440
}))

nodes.push(fn('e_p_fn_errstatus', 'f_e_poll', 'Fout -> dashboard', `
const e = (msg.error && msg.error.message) ? String(msg.error.message) : 'onbekende fout';
const friendly = /ECONNRESET|ECONNREFUSED/i.test(e)
    ? 'verbinding met IQ Gateway verbroken. Volgende poging of klik Gateway zoeken.'
    : (/ETIMEDOUT|ESOCKETTIMEDOUT|socket hang up/i.test(e)
        ? 'IQ Gateway reageerde niet op tijd. Niet sneller pollen; Envoy kan vastlopen.'
        : e);
flow.set('enphaseInFlight', false);
msg.payload = 'Fout: ' + friendly + ' @ ' + new Date().toLocaleTimeString('nl-NL');
return msg;
`, { x: 370, y: 500, wires: [['e_p_status_out']] }))

nodes.push(fn('e_p_fn_retry', 'f_e_poll', 'Retry / opgeven', `
const max = 2;
const n = msg._enphaseRetry || 0;
const raw = (msg.error && (msg.error.message || msg.error)) || String(msg.statusCode || 'fout');
if (n >= max) {
    flow.set('enphaseInFlight', false);
    flow.set('enphaseFailCount', (flow.get('enphaseFailCount') || 0) + 1);
    if (/token|401|ongeldig|login/i.test(String(raw))) global.set('enphaseForceAuth', true);
    if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|niet bereikbaar/i.test(String(raw))) global.set('enphaseForceDiscover', true);
    node.status({ fill: 'red', shape: 'dot', text: String(raw).slice(0, 48) });
    msg.error = msg.error || { message: String(raw) };
    return [null, msg];
}
msg._enphaseRetry = n + 1;
const base = 1500 * Math.pow(2, n);
msg.delay = Math.round(base + Math.random() * base * 0.4);
node.status({ fill: 'yellow', shape: 'ring', text: 'retry ' + msg._enphaseRetry + '/' + max });
delete msg.error;
delete msg.statusCode;
delete msg.payload;
return [msg, null];
`, {
  outputs: 2,
  x: 360,
  y: 580,
  wires: [['e_p_retry_delay'], ['e_p_errdbg', 'e_p_fn_errstatus']],
  outputLabels: ['opnieuw', 'opgeven']
}))

nodes.push({
  id: 'e_p_retry_delay',
  type: 'delay',
  z: 'f_e_poll',
  name: 'wacht voor retry',
  pauseType: 'delayv',
  timeout: '2',
  timeoutUnits: 'seconds',
  rate: '1',
  nbRateUnits: '1',
  rateUnits: 'second',
  randomFirst: '1',
  randomLast: '5',
  randomUnits: 'seconds',
  drop: false,
  outputs: 1,
  x: 580,
  y: 580,
  wires: [['e_p_fn_rereq']]
})

nodes.push(fn('e_p_fn_rereq', 'f_e_poll', 'Retry-route', `
if (msg._enphaseStep === 'login' || msg._enphaseStep === 'token' || msg._enphaseForceAuth) {
    return [msg, null, null];
}
if (msg._enphaseStep === 'production' && global.get('enphaseForceDiscover')) {
    return [null, null, msg];
}
return [null, msg, null];
`, {
  outputs: 3,
  x: 800,
  y: 580,
  wires: [['e_p_prep'], ['e_p_fn_prod'], ['e_p_fn_rediscover']],
  outputLabels: ['token', 'production', 'IP']
}))

nodes.push({
  id: 'e_p_retry_comment',
  type: 'comment',
  z: 'f_e_poll',
  name: 'Zelfondertekend certificaat + Connection: close + max. 2 retries',
  info: 'IQ Gateway gebruikt een self-signed certificaat (tls-config verifyservercert=false). Firmware 8+ eist HTTPS. Keep-alive naar de Envoy veroorzaakt hangs; daarom Connection: close. 401 forceert een nieuw token; netwerkfout na 2 retries triggert IP-zoeken.',
  x: 410,
  y: 540,
  wires: []
})

const ids = new Set()
for (const n of nodes) {
  if (ids.has(n.id)) throw new Error('duplicate id ' + n.id)
  ids.add(n.id)
}

const out = path.join(root, 'enphase-flows.json')
fs.writeFileSync(out, JSON.stringify(nodes, null, 4) + '\n')
console.log('Wrote', out, 'nodes:', nodes.length)
