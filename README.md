# Zaptec → Victron EV Charger Brug (Node-RED)

Integratieproject voor installateurs die **Zaptec laadpalen** uitlezen en de meetwaarden tonen als een **virtueel EV Charger-apparaat** in Victron Venus OS v3.80+.

> **Vereist Venus OS v3.80 of nieuwer** (beta beschikbaar via Online updates).  
> Voor oudere Venus OS versies: zie [legacy/README-legacy.md](legacy/README-legacy.md).

---

## Hoe het werkt

```
┌──────────────────────────────────────────────────────────────┐
│                     Venus OS v3.80 (Cerbo GX)                │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  Node-RED                                               │ │
│  │                                                         │ │
│  │  1. Haal OAuth2 token op bij Zaptec (elk uur)           │ │
│  │  2. Poll alle laadpalen via Zaptec REST API (30s)        │ │
│  │  3. Transformeer meetwaarden naar Victron MQTT formaat   │ │
│  │  4. Schrijf waarden via dbus-mqtt write-topics           │ │
│  └──────────────────┬──────────────────────────────────────┘ │
│                     │  MQTT localhost:1883                    │
│                     │  W/{VRM_ID}/evcharger/{inst}/{pad}      │
│                     │  {"value": 7360}                        │
│                     ▼                                         │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  Victron dbus-mqtt bridge                                │ │
│  │  → Virtueel EV Charger apparaat (aangemaakt in GX menu)  │ │
│  └──────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
           │
           ▼
  Zichtbaar in VRM portaal, GX-display en Victron-apps
  als "EV-laadstation" met vermogen, stroom en energietellers
```

Er zijn **geen extra scripts of Python-services** nodig. Node-RED schrijft rechtstreeks naar de Victron MQTT write-topics via de ingebouwde `dbus-mqtt` bridge.

---

## Vereisten

| Component | Versie / Opmerking |
|---|---|
| Victron Cerbo GX / Venus OS | **v3.80+** (beta) |
| Node-RED | Ingebouwd in Venus OS |
| Zaptec account | Centrale account met alle laadpalen |
| VRM Portal ID | Te vinden in VRM-portaal of GX-instellingen |

---

## Installatie (5 stappen)

### Stap 1 – Venus OS v3.80 beta installeren

Op het GX-display of Remote Console:

```
Instellingen → Firmware → Online updates → Controleer op updates
→ Selecteer beta-kanaal → Installeer v3.80
```

Of via SSH:

```bash
ssh root@venus.local
/opt/victronenergy/swupdate-scripts/check-updates.sh -update -force
```

### Stap 2 – Virtueel EV-apparaat aanmaken in Venus OS

Op het GX-display of Remote Console (`http://venus.local`):

```
Instellingen → EV-laadstation → Voeg virtueel apparaat toe
```

Maak voor **elke Zaptec-laadpaal** een apart virtueel apparaat aan.  
Noteer het **instantienummer** dat Venus OS toewijst (standaard begint het bij **20** of **40**).

### Stap 3 – Bestanden naar Cerbo GX kopiëren

```bash
scp -r . root@venus.local:/tmp/zaptec-install/
```

### Stap 4 – Installatiescript uitvoeren

```bash
ssh root@venus.local
bash /tmp/zaptec-install/scripts/install.sh
```

Het script vraagt om:
- **VRM Portal ID** (te vinden in VRM → Installatie → Instellingen → Algemeen)
- **Zaptec gebruikersnaam** (e-mailadres)
- **Zaptec wachtwoord**

Deze worden opgeslagen in `/etc/venus/nodered.env`.

### Stap 5 – Node-RED flow importeren

1. Open Node-RED: `http://venus.local:1880`
2. Hamburgermenu **≡ → Importeren**
3. Selecteer bestand: `flows/zaptec-victron-bridge.json`
4. Klik **Importeren** → **Implementeren**

Na implementatie start de flow automatisch:
- Na ±1 seconde: eerste authenticatie bij Zaptec
- Na ±5 seconden: eerste dataopvraging, waarden verschijnen in Victron

---

## Omgevingsvariabelen

Stel in via `/etc/venus/nodered.env` of Node-RED beheerinterface:

| Variabele | Beschrijving | Verplicht | Voorbeeld |
|---|---|---|---|
| `ZAPTEC_USERNAME` | E-mailadres centrale Zaptec account | ✅ | `beheer@uwbedrijf.nl` |
| `ZAPTEC_PASSWORD` | Wachtwoord Zaptec account | ✅ | `GeheimWachtwoord` |
| `VRM_PORTAL_ID` | VRM Portal ID van dit Cerbo GX apparaat | ✅ | `a1b2c3d4e5f6` |
| `DBUS_INSTANCE_BASE` | Eerste D-Bus instantienummer (standaard: 40) | optioneel | `40` |

> **VRM Portal ID vinden:** VRM portaal → klik op uw installatie → Instellingen → Algemeen → VRM Portal ID  
> Of op het GX-display: Instellingen → VRM Online portaal → VRM Portal ID

---

## MQTT write-topics (Victron dbus-mqtt formaat)

Node-RED schrijft voor elke laadpaal naar de volgende topics:

```
W/{VRM_PORTAL_ID}/evcharger/{instantie}/{pad}
```

Payload altijd als JSON: `{"value": <getal>}`

| Pad | Beschrijving | Eenheid |
|---|---|---|
| `/Ac/Power` | Totaal actief vermogen | W |
| `/Ac/L1/Power` | Vermogen fase 1 | W |
| `/Ac/L2/Power` | Vermogen fase 2 | W |
| `/Ac/L3/Power` | Vermogen fase 3 | W |
| `/Ac/L1/Current` | Stroom fase 1 | A |
| `/Ac/L2/Current` | Stroom fase 2 | A |
| `/Ac/L3/Current` | Stroom fase 3 | A |
| `/Ac/L1/Voltage` | Spanning fase 1 | V |
| `/Ac/L2/Voltage` | Spanning fase 2 | V |
| `/Ac/L3/Voltage` | Spanning fase 3 | V |
| `/Ac/Energy/Forward` | Totale afgeleverde energie | kWh |
| `/Ac/EnergySession` | Energie huidige sessie | kWh |
| `/Status` | Laderstatus (0–10) | – |
| `/Current` | Actuele laadstroom | A |
| `/MaxCurrent` | Maximale laadstroom (32A) | A |
| `/SetCurrent` | Ingesteld laadstroom setpoint | A |
| `/Mode` | Modus (0 = handmatig) | – |

---

## Meerdere laadpalen

De flow wijst automatisch een D-Bus instantienummer toe aan elke laadpaal:

| Laadpaal | Serienummer | D-Bus instantie | MQTT basis-topic |
|---|---|---|---|
| Laadpaal 1 | `ZAP001234` | 40 | `W/{VRM_ID}/evcharger/40/` |
| Laadpaal 2 | `ZAP001235` | 41 | `W/{VRM_ID}/evcharger/41/` |
| Laadpaal 3 | `ZAP001236` | 42 | `W/{VRM_ID}/evcharger/42/` |

**Belangrijk:** Maak in Venus OS evenveel virtuele EV-apparaten aan als laadpalen in uw Zaptec account. De instantienummers die Venus OS toekent moeten overeenkomen met `DBUS_INSTANCE_BASE` (en oplopend).

Als de instantienummers niet kloppen, pas dan `DBUS_INSTANCE_BASE` aan in de omgevingsvariabelen zodat ze beginnen bij het eerste instantienummer dat Venus OS heeft toegewezen.

---

## Zaptec StateID referentietabel

| StateID | Beschrijving | Eenheid | Conversie |
|---|---|---|---|
| 513 | Totaal actief vermogen | kW | × 1000 → W |
| 501 | Stroom fase 1 | A | – |
| 502 | Stroom fase 2 | A | – |
| 503 | Stroom fase 3 | A | – |
| 553 | Spanning fase 1 | V | – |
| 554 | Spanning fase 2 | V | – |
| 555 | Spanning fase 3 | V | – |
| 521 | Energie huidige sessie | kWh | – |
| 552 | Totale afgeleverde energie | kWh | – |
| 544 | ChargerOperationMode | 0–6 | zie tabel |
| 520 | Laadstroom setpoint | A | – |

### Statusmapping: Zaptec → Victron

| Zaptec modus | Beschrijving | Victron status | Beschrijving |
|---|---|---|---|
| 0 | Onbekend | 0 | Ontkoppeld |
| 1 | Ontkoppeld | 0 | Ontkoppeld |
| 2 | Verbonden, wacht | 6 | Wacht op start |
| 3 | Aan het opladen | 2 | Aan het opladen |
| 4 | Opladen klaar | 3 | Opgeladen |
| 5 | Fout | 0 | Ontkoppeld |
| 6 | Verbonden, geen stroom | 4 | Wacht op zon |

---

## Node-RED flow tabs

| Tab | Inhoud |
|---|---|
| **Zaptec Authenticatie** | OAuth2 login bij Zaptec, automatisch tokenvernieuwing elk uur |
| **Laadpaal Data** | Poll elke 30s, transformeer meetwaarden, schrijf naar Victron MQTT write-topics + keepalive |
| **Status & Debug** | Toon instantie-toewijzingen, handmatige triggers voor auth en poll |

---

## Probleemoplossing

### Laadpalen verschijnen niet in Victron

1. **Controleer of het virtuele apparaat is aangemaakt** in Venus OS:
   ```
   Instellingen → EV-laadstation
   ```
2. **Controleer instantienummers** – klik in Node-RED Status-tab op "Toon D-Bus instantie toewijzingen" en vergelijk met de instanties in Venus OS
3. **Bekijk Node-RED debug panel** – zijn er foutmeldingen?
4. **Controleer MQTT berichten:**
   ```bash
   mosquitto_sub -v -t 'W/#'
   ```

### Authenticatiefout (401)

- Controleer `ZAPTEC_USERNAME` en `ZAPTEC_PASSWORD` in `/etc/venus/nodered.env`
- Test login via https://portal.zaptec.com
- Klik op **"Handmatig: herverifieer"** in de Status & Debug tab

### Verkeerde instantienummers

Venus OS v3.80 kent automatisch instantienummers toe aan virtuele apparaten. Controleer welke nummers zijn toegewezen:

```bash
dbus -y | grep evcharger
```

Pas `DBUS_INSTANCE_BASE` aan zodat het overeenkomt met het eerste toegewezen nummer en herstart Node-RED:

```bash
sv restart nodered
```

### Venus OS v3.80 beta installeren

```bash
# Via SSH op de Cerbo GX:
/opt/victronenergy/swupdate-scripts/check-updates.sh -update -force -version v3.80~1
```

Of via het GX-display: **Instellingen → Firmware → Online updates → Bèta-firmware → Controleren**

---

## Beveiliging

- De brug leest **uitsluitend** van de Zaptec API (GET requests) – geen stuurcommando's
- Zaptec OAuth2-tokens worden in Node-RED flow-geheugen bewaard en elk uur vernieuwd
- MQTT-communicatie vindt alleen intern op `localhost` plaats
- Overweeg een apart Zaptec API-account met alleen leesrechten (`Observer` rol)

---

## Projectstructuur

```
zaptec-victron-nodered-bridge/
├── flows/
│   └── zaptec-victron-bridge.json    # Node-RED flow (Venus OS v3.80+)
├── scripts/
│   └── install.sh                    # Installatiescript
├── legacy/                           # Aanpak voor Venus OS < v3.80
│   ├── dbus-evcharger.py             # Python D-Bus virtuele service
│   ├── install-legacy.sh             # Installatiescript legacy
│   └── services/zaptec-evcharger/   # Runit service definitie
├── package.json
└── README.md
```

---

## Licentie

MIT License – zie [LICENSE](LICENSE)
