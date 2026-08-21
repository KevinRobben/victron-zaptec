# Enphase IQ Gateway -> Victron PV-omvormer (Node-RED)

Node-RED-applicatie die een **Enphase IQ Gateway (Envoy) read-only** uitleest via
de **lokale REST-API** en de PV-productie in **Victron (Venus OS / VRM)** toont
als een **virtuele PV-omvormer** (`com.victronenergy.pvinverter`).

Dit is de route wanneer Victron’s ingebouwde **Enphase Modbus TCP**-koppeling niet
volstaat. Die native koppeling werkt alleen met een **IQ Gateway Metered**
(ENV-S-WM-230 / ENV-S-EM-230) mét productie-meetspoelen (CT’s), vereist dat
Enphase Support Modbus TCP aanzet, en is in de praktijk vaak instabiel (IP-wissel,
firmware, trage power-limit). Deze flow werkt **altijd**: Metered mét CT,
Metered zónder CT, en **IQ Gateway Standard**.

Er wordt **niets gestuurd** richting Enphase: alleen lezen. Frequency-shift /
ESS-feed-in-limiet via Modbus blijft een aparte, optionele Victron-functie.

De architectuur is dezelfde als [Zaptec](./README.md) en
[Viessmann](./README-viessmann.md): een **VRM-invulformulier** plus een adaptief
uitlees-flow. Eigen tabbladen, het standaard Node-RED-dashboard
(`/dashboard`) en eigen configbestand (`/data/enphase-config.json`).

---

## Hoe het werkt

```
  Enlighten (alleen voor token)              IQ Gateway LAN           Victron Venus OS
  ┌─────────────────────────────┐            ┌─────────────────┐     ┌──────────────────────────┐
  │ POST /login/login.json      │            │ GET /info       │     │ victron-virtual          │
  │ POST entrez /tokens  (JWT)  │───────────▶│ GET /production │────▶│ device: pvinverter       │
  └─────────────────────────────┘   Bearer   │     .json       │     │ -> com.victronenergy.    │
                                             └─────────────────┘     │    pvinverter.virtual_…  │
                                                                     └──────────────────────────┘
```

1. **Serienummer** – in VRM vul je het IQ Gateway-serienummer in (plus Enlighten
   e-mail/wachtwoord). Dat nummer staat in de Enphase-app onder
   *Systeem → Apparaten → Gateway* (`SN:`).
2. **IP zoeken** – de flow vindt de gateway zelf:
   - bekend/handmatig IP;
   - `envoy.local` en `envoy-<serial>.local` (mDNS, als de GX dat resolvet);
   - anders een **LAN-scan** van `GET /info` (geen token nodig) tot het
     serienummer matcht.
3. **Token** – firmware ≥ 7 vereist een JWT. De flow logt in bij Enlighten en
   vraagt het token aan bij `entrez.enphaseenergy.com`, zoals in Enphase
   TEB-00060 (juni 2025). Owner-tokens ± **1 jaar**, installer-tokens **12 uur**.
   Vernieuwen gebeurt automatisch (owner: 30 dagen voor expiry; installer: 2 uur)
   en via de knop **Token vernieuwen**.
4. **Uitlezen** – één lokaal request: `GET /production.json?details=1`.
5. **Bronkeuze** (hier gaat native Modbus de mist in):
   - **Productie-CT** (`type: eim`, `activeCount > 0` en echte waarden) → die
     meting (nauwkeurig, per fase als de spoelen het doorgeven);
   - anders het **micro-omvormer-segment** (`type: inverters`) → werkt op
     Standard en op Metered **zonder** spoelen. `/api/v1/production` geeft daar
     nullen en wordt bewust niet als primaire bron gebruikt.
6. **Presenteren** – `victron-virtual` als **PV inverter** (Venus OS 3.70+ /
   node-red-contrib-victron 1.7.x): vermogen, energie, per-fase V/I/P,
   `StatusCode` 7 (Running) / 8 (Standby).

---

## Wat de virtuele PV-omvormer toont

| Victron D-Bus-pad | Bron | Opmerking |
|-------------------|------|-----------|
| `Ac/Power` (W) | CT `wNow` of som micro-omvormers | nacht: 0 (negatieve CT-lekstroom wordt afgekapt) |
| `Ac/Energy/Forward` (kWh) | lifetime Wh / 1000 | monotoon; Envoy-resets worden genegeerd |
| `Ac/L1..L3/Power, Voltage, Current` | CT-lijnen indien aanwezig | zonder CT: alles op L1, nominale 230 V |
| `Position` | VRM-dropdown | **0 = AC-in 1, 1 = AC-uit, 2 = AC-in 2** (pvinverter-conventie) |
| `StatusCode` | afgeleid | 7 bij >10 W, anders 8 |
| `CustomName` | vast | `Enphase IQ` |

`pvinverter_auto_energy` staat aan als terugval, maar wordt **niet** dubbel
geteld zolang `Ac/Energy/Forward` in de payload zit.

---

## Praktische API-limieten (uit onderzoek)

Gebaseerd op Enphase TEB-00060-2.0 (juni 2025), pyenphase, Home Assistant
`enphase_envoy` en Victron/Enphase community-threads.

- **Modbus TCP (Victron native)** – alleen Metered + CT’s, firmware ≥ 8.2.4264
  (soms 7.6.168), moet door Enphase Support worden geactiveerd, SunSpec 700.
  Standard-gateways vallen af. IP-wissel of dubbele Ethernet+WiFi geeft
  drop-outs.
- **Firmware ≥ 7** – JWT verplicht. Self-signed certificaat: verificatie uit
  (`-k` / `rejectUnauthorized: false`). Firmware 8+ (en veel sites sinds 2026)
  **alleen HTTPS**.
- **Token** – owner ± 1 jaar, installer 12 uur. Self-installer via de web-UI
  krijgt vaak een 12-uurs-token; programmatisch (deze flow) volgt het
  accounttype. **MFA** op het Enlighten-account blokkeert `session_id`; plak
  dan een token van [entrez.enphaseenergy.com](https://entrez.enphaseenergy.com).
- **`/api/v1/production`** – officiële tabel zegt “werkt zonder meter”, in de
  praktijk **nullen** op Standard en Metered-zonder-CT. Niet gebruiken als
  primaire bron.
- **`/ivp/meters/readings`** – alleen met CT’s; zonder spoelen leeg of garbage
  (`activeCount: 0`, `wNow ≈ -8 W`).
- **Micro-omvormers** – rapporteren ongeveer **elke 5–15 minuten**, niet
  synchroon. Sneller pollen levert geen fijnere data op zonder CT.
- **Envoy is traag/kwetsbaar** – agressief pollen (<15 s) geeft
  dropped connections, freeze of reboot. HA-standaard is 60 s; deze flow
  gaat niet onder 15 s, ook niet bij “live kijken”.
- **Keep-alive** – laat de Envoy soms hangen. Requests gebruiken
  `Connection: close`.
- **Lifetime-teller** – kan resetten bij firmware-update (HA: “lifetime
  reset”). De flow houdt de vorige kWh aan bij een plotselinge daling.
- **Gesomde spanning** – aggregate `rmsVoltage` van een 3-fase CT is vaak de
  *som* van de fasen (~690 V). Per-fase lijnen worden gebruikt; een som >320 V
  wordt teruggerekend.
- **>49 omvormers** – `/api/v1/production/inverters` is begrensd; deze flow
  gebruikt het aggregate-segment, niet de individuele lijst.
- **~23:00 UTC** – Envoy doet intern onderhoud; korte gaten zijn normaal.
- **Firmware-push** – tijdens een update is de API even weg; daarna kan
  re-auth nodig zijn. De flow retry’t en vernieuwt het token bij 401.
- **DHCP** – IP kan wisselen. Bij herhaalde netwerkfouten zoekt de flow
  `envoy.local` opnieuw; de knop **Gateway zoeken** doet een volledige
  `/info`-scan.

---

## Vereisten

- Victron GX met **Venus OS Large**, bij voorkeur **v3.70 of nieuwer**
  (virtuele PV-omvormer in `node-red-contrib-victron`; getest tegen de 1.7.x
  API van begin 2026, Venus OS tot v3.75).
- Palette **`@flowfuse/node-red-dashboard`** (Dashboard 2.0) voor de
  VRM-tegel.
- **`functionExternalModules`** aan (standaard op Venus OS Large). IP-zoeken
  gebruikt de Node.js-modules `dns` / `os` / `http` / `https`.
- IQ Gateway en GX op **hetzelfde IPv4-LAN**. Gebruik Ethernet **of** WiFi op
  de Envoy, niet allebei (wisselen ~elke 30 min).
- Enlighten-account dat bij de site hoort (owner bij voorkeur), **of** een
  handmatig token.
- Internet **alleen** nodig voor token ophalen/vernieuwen. Het uitlezen zelf
  is lokaal.

---

## Installatie

Eén bestand: [`enphase-flows.json`](./enphase-flows.json).

1. Installeer eenmalig **`@flowfuse/node-red-dashboard`** (*Manage Palette*).
2. Open Node-RED op de GX (VRM → *Venus OS Large* → Node-RED, of
   `http://<gx-ip>:1880`).
3. Menu → **Import** → plak [`enphase-flows.json`](./enphase-flows.json) →
   **Import** → **Deploy**.
4. Configureer via de VRM-tegel **Enphase**.

Tabbladen:

- **Enphase configuratie (VRM)** – serienummer, inlog, status, knoppen
  *Gateway zoeken* en *Token vernieuwen*.
- **Enphase -> Victron (uitlezen)** – lokale poll + virtuele PV-omvormer.

De flow kan naast Zaptec/Viessmann/Thermia draaien (eigen node-id’s). Het
invulformulier staat op **`/dashboard`** — dezelfde URL als de knop
*Dashboard* in Node-RED (`http://<gx-ip>:1880/dashboard`).

Regenereren na wijziging van de helpers:

```bash
node scripts/build-enphase-flow.js
node test-enphase-flow.js
```

---

## Configuratie

### Optie A – Invulvelden in VRM (aanbevolen)

1. Open in VRM onder **Venus OS Large** de tegel **Enphase**.
2. Vul in:
   - **Gebruikersnaam (e-mail)** en **Wachtwoord** van Enlighten;
   - **IQ Gateway serienummer**;
   - optioneel **Token** (MFA of als je geen wachtwoord wilt bewaren);
   - optioneel **IP-adres** (anders zoekt de flow zelf).
3. Klik **Opslaan en verbinden**. De flow zoekt het IP, haalt een token op
   en begint met uitlezen.
4. Kies **Positie van de PV-omvormer**: AC-in 1 / AC-uit / AC-in 2.
5. Bij IP-wissel of storing: **Gateway zoeken**. Bij 401 / verlopen JWT:
   **Token vernieuwen**.

De **Status**-regel toont de laatste W / kWh, databron (CT of micro-omvormers)
en het gebruikte IP. **Huidige instelling** toont SN, IP, firmware, token-datum
en positie.

Opgeslagen in `/data/enphase-config.json` (wachtwoord en token staan daar in
leesbare vorm, net als bij Zaptec).

### Optie B – Omgevingsvariabelen

VRM-waarden gaan voor; anders:

| Variabele | Verplicht | Standaard | Omschrijving |
|-----------|-----------|-----------|--------------|
| `ENPHASE_SERIAL` | ja | – | IQ Gateway-serienummer |
| `ENPHASE_USERNAME` | ja* | – | Enlighten e-mail |
| `ENPHASE_PASSWORD` | ja* | – | Enlighten-wachtwoord |
| `ENPHASE_TOKEN` | nee | – | Kant-en-klaar JWT (MFA) |
| `ENPHASE_IP` | nee | auto | Vast IP; leeg = zoeken |
| `ENPHASE_POSITION` | nee | `0` (AC-in 1) | `0` / `1` / `2` |
| `ENPHASE_NOMINAL_VOLTAGE` | nee | `230` | Terugvalspanning zonder CT |
| `ENPHASE_MAX_POWER` | nee | – | `Ac/MaxPower` in W |
| `ENPHASE_POLL_WATCHING_SEC` | nee | `20` (min. 15) | Poll bij live meekijken |
| `ENPHASE_POLL_PRODUCING_SEC` | nee | `30` (min. 15) | Poll tijdens productie |
| `ENPHASE_POLL_IDLE_SEC` | nee | `120` | Poll ’s nachts / idle |
| `ENPHASE_WATCH_TIMEOUT_SEC` | nee | `90` | Levensduur “er kijkt iemand” |

\* Niet nodig als `ENPHASE_TOKEN` is gezet (tot het token verloopt).

Live-kijk detectie: MQTT op LAN (plaintext) op de GX, zelfde principe als
Zaptec. Zonder MQTT valt de flow terug op productie-/idle-interval.

---

## Read-only garantie

- Enlighten: `POST /login/login.json?`, `POST /tokens` (alleen authenticatie)
- Lokaal: `GET /info`, `GET /production.json?details=1`

Geen power-limit, geen relay, geen Ensemble-sturing.

---

## Probleemoplossing

| Symptoom | Oorzaak / oplossing |
|----------|---------------------|
| `wacht op VRM-configuratie` | Serienummer nog niet opgeslagen |
| `gateway niet gevonden` | Zelfde LAN? Handmatig IP invullen. mDNS ontbreekt vaak op de GX; de `/info`-scan dekt dat. |
| `MFA of verkeerde inlog` | Geen `session_id`. Token plakken vanaf entrez, of MFA uit. |
| `token mislukt` | Account hoort niet bij deze serial, of installer-token al verlopen |
| `production HTTP 401` | Token verlopen/ongeldig → **Token vernieuwen** (gebeurt ook automatisch) |
| Envoy freeze / timeouts | Interval ≥ 15 s laten; niet extra HTTP-nodes naar dezelfde Envoy zetten |
| 0 W overdag op Standard | Verwacht tot de micro-omvormers rapporteren (tot ~15 min). Bron moet `inverters` zijn, niet CT. |
| 0 W op Metered | CT `activeCount: 0`? Spoelen niet ingeleerd → flow valt terug op micro-omvormers |
| Meter verschijnt niet in GX | `node-red-contrib-victron` te oud; device-type `pvinverter` vereist ~Venus 3.60+ |
| Zonne-opbrengst leeg in VRM | `StatusCode` 7 tijdens productie; energie op `Ac/Energy/Forward` (kWh) |

---

## Bronnen

- Enphase TEB-00060-2.0, juni 2025:
  [IQ Gateway local APIs using token](https://enphase.com/download/iq-gateway-local-apis-or-ui-access-using-token)
- Enphase / Victron Modbus TCP (alleen Metered + CT):
  [AC-coupling with Victron using Modbus TCP/IP](https://enphase.com/en-gb/download/ac-coupling-victron-battery-inverters-using-modbus-tcpip)
- pyenphase (bronkeuze Standard vs Metered):
  <https://github.com/pyenphase/pyenphase>
- Home Assistant Enphase Envoy (bekende firmware-bugs):
  <https://www.home-assistant.io/integrations/enphase_envoy/>
- Victron Virtual Devices:
  <https://github.com/victronenergy/node-red-contrib-victron/wiki/Virtual-Devices>
