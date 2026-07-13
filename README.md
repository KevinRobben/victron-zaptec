# Zaptec → Victron EV Charger Brug (Node-RED)

Integratieproject voor installateurs die **Zaptec laadpalen** uitlezen en de meetwaarden tonen als een **Victron EV Charger energiemeter** in Venus OS (Cerbo GX, EKRANO GX, etc.).

---

## Architectuur

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Venus OS (Cerbo GX)                          │
│                                                                     │
│  ┌───────────────┐   MQTT (localhost:1883)   ┌────────────────────┐ │
│  │               │  ──────────────────────▶  │   Python D-Bus     │ │
│  │   Node-RED    │   zaptec/{serial}/        │   brug service     │ │
│  │   (flow)      │   measurements            │   dbus-evcharger   │ │
│  │               │                           │   .py              │ │
│  └───────┬───────┘                           └────────┬───────────┘ │
│          │ HTTPS REST (poll 30s)                      │ D-Bus       │
│          │                                            ▼             │
│          │                               com.victronenergy          │
│          │                               .evcharger.zaptec_*        │
└──────────┼────────────────────────────────────────────┼─────────────┘
           │                                            │
           ▼                                            ▼
  ┌─────────────────┐                       ┌──────────────────────┐
  │  Zaptec Cloud   │                       │  Victron VRM / GX-   │
  │  API            │                       │  display / Venus OS  │
  │  api.zaptec.com │                       │  Energieoverzicht    │
  └─────────────────┘                       └──────────────────────┘
```

### Componenten

| Component | Bestand | Doel |
|---|---|---|
| **Node-RED flow** | `flows/zaptec-victron-bridge.json` | Zaptec API pollen, data transformeren, MQTT publiceren |
| **Python D-Bus service** | `scripts/dbus-evcharger.py` | Victron D-Bus EV Charger services aanmaken en bijwerken |
| **Runit service** | `services/zaptec-evcharger/` | Automatisch opstarten op Venus OS |
| **Installatiescript** | `scripts/install.sh` | Geautomatiseerde installatie |

---

## Vereisten

- **Victron Cerbo GX** of ander Venus OS apparaat (v2.90 of nieuwer)
- **Node-RED** (standaard aanwezig op Venus OS via `Settings > General > Node-RED`)
- **Python 3** (standaard aanwezig op Venus OS)
- **paho-mqtt** Python bibliotheek
- Zaptec account met API-toegang (portal.zaptec.com)
- Victron VRM account

---

## Installatie

### Stap 1 – Bestanden naar Cerbo GX kopiëren

```bash
# Vervang venus.local door het IP-adres van uw Cerbo GX
scp -r . root@venus.local:/tmp/zaptec-install/
```

### Stap 2 – Installatiescript uitvoeren

```bash
ssh root@venus.local
bash /tmp/zaptec-install/scripts/install.sh
```

Het script:
- Installeert `paho-mqtt`
- Plaatst de Python D-Bus service in `/opt/victronenergy/zaptec-evcharger/`
- Registreert de runit service (automatisch opstarten)
- Geeft instructies voor de Node-RED flow

### Stap 3 – Zaptec inloggegevens configureren in Node-RED

1. Open Node-RED: `http://venus.local:1880`
2. Ga naar het hamburgermenu **≡ → Beheer → Omgevingsvariabelen**
3. Voeg toe:

| Variabele | Waarde | Verplicht |
|---|---|---|
| `ZAPTEC_USERNAME` | E-mailadres van het centrale Zaptec account | ✅ |
| `ZAPTEC_PASSWORD` | Wachtwoord van het centrale Zaptec account | ✅ |
| `VENUS_MQTT_HOST` | `localhost` (of IP van de MQTT broker) | optioneel |

> **Tip:** Gebruik een speciaal Zaptec API-account met alleen leesrechten (`Roles=Observer`) voor maximale veiligheid.

### Stap 4 – Node-RED flow importeren

1. Open Node-RED: `http://venus.local:1880`
2. Klik op het hamburgermenu **≡ → Importeren**
3. Selecteer het bestand `flows/zaptec-victron-bridge.json`
4. Klik **Importeren** → **Implementeren**

### Stap 5 – Verificatie

Controleer of de laadpalen verschijnen in Victron:

```bash
# Controleer D-Bus service
dbus -y com.victronenergy.evcharger.zaptec_<serial> /Ac/Power GetValue

# Controleer service status
sv status zaptec-evcharger

# Bekijk logs
tail -f /var/log/zaptec-evcharger/current
```

In het **GX-display** en **VRM-portaal** verschijnen de laadpalen automatisch onder:
- *Instellingen → ESS → Laadpalen* (indien ESS actief)
- *Apparaten → EV Charger*
- *Energie → Laadpalen* (vermogen en energiemeter)

---

## Configuratie

### Meerdere laadpalen

De brug ondersteunt automatisch meerdere Zaptec-laadpalen. Voor elke laadpaal die gevonden wordt in het Zaptec-account, wordt een aparte D-Bus service aangemaakt:

- `com.victronenergy.evcharger.zaptec_<serienummer_1>` (instantie 40)
- `com.victronenergy.evcharger.zaptec_<serienummer_2>` (instantie 41)
- etc.

### Polling interval aanpassen

Het standaard polling interval is **30 seconden**. Om dit aan te passen:

1. Open de flow in Node-RED
2. Dubbelklik op de **"Poll elke 30 seconden"** inject node (tab: Laadpaal Data)
3. Pas de **Herhalingstijd** aan
4. Klik **Gereed** → **Implementeren**

### MQTT broker adres wijzigen

Als Node-RED en de D-Bus service op verschillende machines draaien:

1. Open de flow in Node-RED
2. Dubbelklik op een van de **mqtt-out** nodes
3. Klik op het potloodicoon naast de broker
4. Pas **Server** en **Poort** aan
5. Klik **Bijwerken** → **Implementeren**

---

## Dataflow en MQTT-topics

### Node-RED publiceert naar:

```
zaptec/{serienummer}/measurements
```

**Voorbeeld payload (JSON):**

```json
{
  "serial":          "ZAP123456",
  "name":            "Laadpaal Garage",
  "power":           7360,
  "power_l1":        2453,
  "power_l2":        2453,
  "power_l3":        2454,
  "current":         9.6,
  "current_l1":      3.2,
  "current_l2":      3.2,
  "current_l3":      3.2,
  "voltage_l1":      230.1,
  "voltage_l2":      229.8,
  "voltage_l3":      230.3,
  "energy_session":  12.543,
  "energy_total":    1250.300,
  "status":          2,
  "operation_mode":  3,
  "set_current":     16.0,
  "timestamp":       "2024-01-15T14:30:00.000Z"
}
```

### Zaptec StateID referentietabel

| StateID | Beschrijving | Eenheid | Victron pad |
|---|---|---|---|
| 513 | Totaal actief vermogen | kW | `/Ac/Power` (×1000 → W) |
| 501 | Stroom fase 1 | A | `/Ac/L1/Current` |
| 502 | Stroom fase 2 | A | `/Ac/L2/Current` |
| 503 | Stroom fase 3 | A | `/Ac/L3/Current` |
| 553 | Spanning fase 1 | V | `/Ac/L1/Voltage` |
| 554 | Spanning fase 2 | V | `/Ac/L2/Voltage` |
| 555 | Spanning fase 3 | V | `/Ac/L3/Voltage` |
| 521 | Energie huidige sessie | kWh | `/Ac/EnergySession` |
| 552 | Totale afgeleverde energie | kWh | `/Ac/Energy/Forward` |
| 544 | Operatiemodus | 0–6 | `/Status` (zie tabel) |
| 520 | Laadstroom setpoint | A | `/SetCurrent` |

### Statusmapping: Zaptec → Victron

| Zaptec modus | Omschrijving | Victron status | Omschrijving |
|---|---|---|---|
| 0 | Onbekend | 0 | Ontkoppeld |
| 1 | Ontkoppeld | 0 | Ontkoppeld |
| 2 | Verbonden – wacht | 6 | Wacht op start |
| 3 | Aan het opladen | 2 | Aan het opladen |
| 4 | Opladen voltooid | 3 | Opgeladen |
| 5 | Fout | 0 | Ontkoppeld |
| 6 | Verbonden – geen stroom | 4 | Wacht op zon |

---

## Victron D-Bus paden

De Python service registreert de volgende D-Bus paden voor elke laadpaal:

| D-Bus pad | Beschrijving | Eenheid |
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
| `/MaxCurrent` | Maximale laadstroom | A |
| `/SetCurrent` | Ingestelde laadstroom | A |
| `/CustomName` | Naam van de laadpaal | – |
| `/Serial` | Serienummer | – |

---

## Beveiliging

- De brug leest **alleen** (GET requests) van de Zaptec API – er worden geen opdrachten verzonden
- Zaptec OAuth2-tokens worden opgeslagen in het Node-RED flow-geheugen en worden elk uur automatisch vernieuwd
- MQTT-communicatie vindt uitsluitend intern plaats op `localhost`
- Victron D-Bus paden zijn geconfigureerd als read-only (geen schrijfpad voor laadstroom)

---

## Probleemoplossing

### Laadpalen verschijnen niet in Victron

1. Controleer of de D-Bus service draait: `sv status zaptec-evcharger`
2. Controleer de logs: `tail -f /var/log/zaptec-evcharger/current`
3. Controleer of MQTT berichten binnenkomen: `mosquitto_sub -t 'zaptec/#' -v`
4. Controleer D-Bus services: `dbus-spy` of `dbus -y com.victronenergy.evcharger.zaptec_*`

### Authenticatiefout in Node-RED

1. Open Node-RED debug panel (rechter tabblad)
2. Controleer of `ZAPTEC_USERNAME` en `ZAPTEC_PASSWORD` correct zijn ingesteld
3. Test login op https://portal.zaptec.com met dezelfde gegevens
4. Klik op de "Handmatig: herverifieer" inject button in de Status & Debug tab

### Verkeerde meetwaarden

- Controleer de Zaptec StateID mapping in de transformatiefunctie
- Zaptec geeft vermogen in **kW** (niet W) – de brug vermenigvuldigt automatisch met 1000
- Als geen fasen beschikbaar zijn, berekent de brug het vermogen uit spanning × stroom per fase

### Venus OS update overschrijft de service

Na een Venus OS firmware-update kan de service zijn overschreven. Voer het installatiescript opnieuw uit:

```bash
bash /tmp/zaptec-install/scripts/install.sh
```

Of maak de service persistent via `rcS.d` of de Venus OS `opkg`-overlay.

---

## Ontwikkeling en testen zonder Cerbo GX

De Python D-Bus service detecteert automatisch of Venus OS D-Bus bibliotheken beschikbaar zijn. Zonder D-Bus draait de service in **logmodus** en toont meetwaarden in de console:

```bash
# Test op een gewone Linux machine
pip3 install paho-mqtt
python3 scripts/dbus-evcharger.py
```

Voor Node-RED testing zonder Cerbo GX: installeer Node-RED lokaal en configureer de MQTT broker naar een lokale Mosquitto instantie.

---

## Projectstructuur

```
zaptec-victron-nodered-bridge/
├── flows/
│   └── zaptec-victron-bridge.json    # Node-RED flow (importeerbaar)
├── scripts/
│   ├── dbus-evcharger.py             # Python Victron D-Bus service
│   └── install.sh                    # Installatiescript voor Venus OS
├── services/
│   └── zaptec-evcharger/
│       ├── run                       # Runit service runner
│       ├── log/run                   # Runit log runner
│       └── conf                      # Standaardconfiguratie
├── package.json
└── README.md
```

---

## Licentie

MIT License – zie [LICENSE](LICENSE)
