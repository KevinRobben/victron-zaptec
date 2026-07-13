# Zaptec -> Victron laadpaal-energiemeter (Node-RED)

Node-RED-applicatie die een **Zaptec laadpaal read-only** uitleest via de centrale
ZapCloud API en de meetwaarden in **Victron (Venus OS / VRM)** presenteert als een
**energiemeter met de rol `EV charger`**.

Op de GX en in VRM verschijnt de laadpaal daardoor als een gemeten EV-lader
(vermogen, stroom/spanning per fase en verbruikte energie). Er wordt **niets
gestuurd** richting Zaptec: de integratie leest uitsluitend uit.

Ideaal voor installateurs: alle Zaptec laadpalen staan onder één centraal Zaptec
account en alle Victron installaties onder één centraal Victron/VRM account. Per
locatie draait dit flow op de GX (Cerbo/Ecu) en toont daar de bijbehorende
laadpaal.

---

## Hoe het werkt

```
  Zaptec Cloud (read-only)                 Victron Venus OS
  ┌─────────────────────┐                  ┌───────────────────────────┐
  │ POST /oauth/token    │   Node-RED       │ victron-virtual node       │
  │ GET  /api/chargers/  │  ┌───────────┐   │ device: energymeter        │
  │      {id}/state      │─▶│ omzetten  │──▶│ rol: evcharger (EV charger)│
  └─────────────────────┘  └───────────┘   │ -> com.victronenergy.      │
                                            │    evcharger.virtual_...   │
                                            └───────────────────────────┘
```

1. **Authenticatie** – OAuth2 *password grant* (ROPC) tegen
   `https://api.zaptec.com/oauth/token`. Het token wordt gecachet en pas
   vernieuwd als het (bijna) verloopt.
2. **Uitlezen** – periodiek (standaard elke 30 s) wordt
   `GET /api/chargers/{id}/state` opgehaald. Dit geeft een lijst van
   *state-observaties*.
3. **Omzetten** – de relevante observaties worden vertaald naar Victron
   D-Bus-paden.
4. **Presenteren** – de `victron-virtual` node (uit `node-red-contrib-victron`)
   maakt een virtuele energiemeter met rol `evcharger`. Venus OS registreert
   deze onder de service `com.victronenergy.evcharger.*`, waardoor de laadpaal in
   de GX-GUI en VRM als EV-lader verschijnt.

### Gebruikte Zaptec observatie-ID's

| ID   | Naam                    | Gebruik in Victron            |
|------|-------------------------|-------------------------------|
| -2   | IsOnline                | `Connected`                   |
| 501/502/503 | VoltagePhase1/2/3 | `Ac/L{1,2,3}/Voltage` (V)     |
| 507/508/509 | CurrentPhase1/2/3 | `Ac/L{1,2,3}/Current` (A)     |
| 513  | TotalChargePower        | `Ac/Power` (W)                |
| 554  | SignedMeterValue (OCMF) | `Ac/Energy/Forward` (kWh)     |

Per-fase vermogen wordt berekend als `V × I`. De totale energie
(`Ac/Energy/Forward`) komt bij voorkeur uit de gesigneerde OCMF-meterstand
(observatie 554); is die niet beschikbaar, dan wordt het vermogen over tijd
geïntegreerd als terugval.

De volledige lijst met observatie-ID's staat in
<https://api.zaptec.com/api/constants>.

---

## Vereisten

- Een **Victron GX-toestel met Venus OS Large** (Node-RED en het Mosquitto-broker
  zitten daarin). Zie de Victron-handleiding *Venus OS Large: Signal K en Node-RED*.
- De node-set **`node-red-contrib-victron`** (standaard aanwezig in Venus OS Large).
  Zorg dat de versie de **Virtual Device**-node met device-type *Energy meter* en
  rol *EV charger* bevat (recente versies). Zo nodig bijwerken via het Node-RED
  palette.
- **Internettoegang** vanaf de GX naar `api.zaptec.com` (HTTPS).
- Een **Zaptec account met owner-rechten** op de betreffende installatie(s)
  (nodig om charger-state uit te lezen).

---

## Installatie

1. Open Node-RED op de GX (via VRM → *Venus OS Large* → Node-RED, of
   `http://<gx-ip>:1880`).
2. Menu (rechtsboven) → **Import** → plak de inhoud van [`flows.json`](./flows.json)
   → **Import**.
3. Stel de credentials in (zie hieronder).
4. **Deploy**.

Er verschijnen twee tabbladen:

- **Zaptec -> Victron (laadpaal-meter)** – de eigenlijke integratie.
- **Zaptec - chargers opzoeken** – hulpmiddel om de charger-GUID op te zoeken.

---

## Configuratie

Er zijn twee manieren om de credentials in te stellen. **Omgevingsvariabelen
worden aanbevolen**, omdat je dan geen wachtwoorden in de flow bewaart.

### Optie A – Omgevingsvariabelen (aanbevolen)

Zet op de GX de volgende variabelen (bijv. via de Node-RED `settings.js` onder
`functionGlobalContext`/`env`, of als OS-omgevingsvariabelen):

| Variabele            | Verplicht | Standaard                 | Omschrijving                         |
|----------------------|-----------|---------------------------|--------------------------------------|
| `ZAPTEC_USERNAME`    | ja        | –                         | Zaptec portal-gebruikersnaam (e-mail)|
| `ZAPTEC_PASSWORD`    | ja        | –                         | Zaptec portal-wachtwoord             |
| `ZAPTEC_CHARGER_ID`  | ja        | –                         | GUID (`Id`) van de laadpaal          |
| `ZAPTEC_BASE_URL`    | nee       | `https://api.zaptec.com`  | API-basis-URL                        |

### Optie B – Rechtstreeks in de flow

Open de functie **`1. Config & token`** (tab *Zaptec -> Victron*) en de functie
**`Auth-request bouwen`** (tab *chargers opzoeken*) en vervang de
`VUL_...`-standaardwaarden door je eigen gegevens.

### Charger-GUID opzoeken

De `ZAPTEC_CHARGER_ID` is de **GUID** (`Id`) van de laadpaal, niet de zichtbare
naam of het serienummer.

1. Ga naar het tabblad **Zaptec - chargers opzoeken**.
2. Klik op de inject-knop **Lijst chargers**.
3. Open het **debug-paneel** (rechts). Je ziet per laadpaal `Id`, `DeviceId`,
   `Name`, `InstallationName` en `IsOnline`.
4. Gebruik de waarde van **`Id`** als `ZAPTEC_CHARGER_ID`.

### Poll-interval

Standaard elke 30 seconden. Aan te passen in de inject-node **Poll** (tab
*Zaptec -> Victron*). Houd rekening met de Zaptec *API usage guidelines* en poll
niet onnodig vaak. Voor near-realtime data zonder polling biedt Zaptec ook
Service Bus-subscripties aan (buiten scope van dit basisflow).

---

## Meerdere laadpalen op één locatie

Wil je op één GX meerdere laadpalen tonen, dupliceer dan per extra laadpaal deze
keten en geef elk een eigen charger-GUID en een eigen `victron-virtual` node:

1. Kopieer de nodes **1. Config & token → … → 4. Zaptec -> Victron energiemeter →
   Laadpaal-meter (Victron)**.
2. Geef in de gekopieerde `1. Config & token` een andere charger-GUID op
   (bijv. via een aparte `flow.set`-sleutel of een eigen env-variabele).
3. Gebruik in de gekopieerde flow **aparte flow-context-sleutels** voor het token
   en de energieteller (bijv. `zaptecCfg2`, `zaptecToken2`,
   `zaptecEnergyForward2`), zodat de ketens elkaar niet overschrijven.
4. Voeg een tweede **`victron-virtual`** node toe (elk krijgt automatisch een
   eigen device-instance).

> Tip: voor veel laadpalen per locatie is een subflow met een eigen scope
> handiger. Dit basisflow is bewust eenvoudig gehouden voor het meest
> voorkomende geval van één laadpaal per GX.

---

## Read-only garantie

Deze integratie gebruikt uitsluitend **lezende** API-aanroepen:

- `POST /oauth/token` (inloggen)
- `GET /api/chargers` (overzicht opzoeken)
- `GET /api/chargers/{id}/state` (meetwaarden)

Er worden geen `update`/`command`-endpoints aangeroepen; er wordt niets aan de
laadpaal of installatie gewijzigd.

---

## Beperkingen & aandachtspunten

- **Energieteller-persistentie**: de terugval-integratie van energie gebruikt de
  Node-RED flow-context. Standaard is die in-memory en reset bij een herstart.
  Voor een blijvende teller kun je in `settings.js` een *persistent context
  store* (bijv. `localfilesystem`) configureren, of vertrouwen op de OCMF-waarde
  (observatie 554) die Zaptec zelf bijhoudt.
- **Aantal fasen**: de virtuele meter staat op 3 fasen. Bij een 1-fase laadpaal
  blijven L2/L3 op 0. Desgewenst kun je in de `victron-virtual` node het aantal
  fasen op 1 zetten.
- **OCMF/SignedMeterValue** wordt vooral rond sessie-events bijgewerkt; tussentijds
  vult de integratie het verbruik aan.
- **Tokengeldigheid**: tokens worden gecachet en automatisch vernieuwd. De ROPC
  password-grant wordt door Zaptec ondersteund; volg toekomstige wijzigingen in
  hun authenticatie-provider (zie de Zaptec-documentatie).

---

## Probleemoplossing

| Symptoom                              | Oorzaak / oplossing                                                        |
|---------------------------------------|---------------------------------------------------------------------------|
| Node-status `auth mislukt`            | Verkeerde `ZAPTEC_USERNAME`/`ZAPTEC_PASSWORD`.                             |
| Node-status `charger-id ontbreekt`    | `ZAPTEC_CHARGER_ID` niet gezet; zoek de GUID via het hulp-tabblad.         |
| `geen state ontvangen`                | Charger offline, of account heeft geen owner-rechten op de installatie.    |
| Meter verschijnt niet in de GX        | `node-red-contrib-victron` te oud, of device-type/rol niet ondersteund.    |
| Energie loopt niet op                 | Configureer een persistent context store of vertrouw op OCMF (obs. 554).   |

Zet in de node **meter payload** (debug) op *actief* om de exacte payload naar de
virtuele meter te inspecteren.

---

## Bronnen

- Zaptec API-authenticatie: <https://docs.zaptec.com/docs/api-authentication>
- Zaptec API usage guidelines: <https://docs.zaptec.com/docs/api-usage-guidelines>
- Zaptec constants (observatie-ID's): <https://api.zaptec.com/api/constants>
- Victron `node-red-contrib-victron` (Virtual Devices):
  <https://github.com/victronenergy/node-red-contrib-victron/wiki/Virtual-Devices>
