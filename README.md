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

## Wat de virtuele energiemeter (rol EV charger) wél en niet toont

> **Belangrijk – gedrag in Venus OS 3.80**
>
> Een **virtuele energiemeter met rol EV charger** is in Venus OS een *meet*-apparaat.
> In de EVCS-widget en op de apparaatpagina toont Venus OS hiervan **alleen het
> actuele vermogen (`Ac/Power`) en de totale energie (`Ac/Energy/Forward`)**.
>
> De overige waarden die dit flow meestuurt — **per-fase spanning/stroom/vermogen**
> en een eventuele **sessie-interface (laadstroom, sessie-energie, laadtijd,
> status)** — worden door Venus OS 3.80 (nog) **niet** op de EVCS-pagina getoond.
> Dit is bevestigd door Victron-gebruikers (o.a. ook met een fysieke EM24 die een
> EVCS meet: *"you only see the power"*) en lijkt nog in ontwikkeling bij Victron.
> Zie de community-thread
> [V3.80~14 virtual EV behaviour](https://community.victronenergy.com/t/v3-80-14-virtual-ev-behaviour/56398).
>
> **Conclusie:** de lege velden voor laadstroom/sessie/tijd zijn *geen fout in dit
> flow* — de data wordt correct naar de D-Bus-meter geschreven (zichtbaar in de
> Node-RED debug), maar Venus OS surfacet ze niet voor dit apparaattype. Er is geen
> volledig virtueel *EV-charger*-apparaattype in `node-red-contrib-victron`, en
> zonder SSH is een externe driver geen optie. Deze integratie levert daarom een
> betrouwbare **vermogens- en energiemeting** van de laadpaal; verschijnt er in een
> latere Venus OS-versie meer detail voor de EVCS-rol, dan komt dat automatisch mee
> omdat de waarden al worden meegestuurd.

> **Let op – "Virtual EV" is iets anders.** In Node-RED bestaat ook een *Virtual EV*
> (device-type `ev`, service `com.victronenergy.ev`). Dat is een **elektrische auto**
> (SoC, TargetSoc, ChargingState, kilometerstand, locatie…), **niet** een laadpaal.
> Gebruik die node dus niet voor een Zaptec-laadpaal.

### Gebruikte Zaptec observatie-ID's

| ID   | Naam                    | Victron D-Bus-pad             | Getoond in Venus OS 3.80 |
|------|-------------------------|-------------------------------|--------------------------|
| -2   | IsOnline                | `Connected`                   | –                        |
| 501/502/503 | VoltagePhase1/2/3 | `Ac/L{1,2,3}/Voltage` (V)     | nee (nog niet)           |
| 507/508/509 | CurrentPhase1/2/3 | `Ac/L{1,2,3}/Current` (A)     | nee (nog niet)           |
| 513  | TotalChargePower        | `Ac/Power` (W)                | **ja**                   |
| 554  | SignedMeterValue (OCMF) | `Ac/Energy/Forward` (kWh)     | **ja**                   |

Per-fase vermogen wordt berekend als `V × I`. De totale energie
(`Ac/Energy/Forward`) komt bij voorkeur uit de gesigneerde OCMF-meterstand
(observatie 554); is die niet beschikbaar, dan wordt het vermogen over tijd
geïntegreerd als terugval.

De volledige lijst met observatie-ID's staat in
<https://api.zaptec.com/api/constants>.

---

## Vereisten

- Een **Victron GX-toestel met Venus OS Large**, bij voorkeur **v3.80 of nieuwer**
  (Node-RED zit daarin). Zie de Victron-handleiding *Venus OS Large: Signal K en
  Node-RED*.
- De node-set **`node-red-contrib-victron`** (standaard aanwezig in Venus OS Large).
  De **Virtual Device**-node met device-type *Energy meter* en rol *EV charger*
  moet beschikbaar zijn (aanwezig in de node-versie die met Venus OS 3.80 meekomt).
  Er is **geen SSH-toegang en geen externe driver** nodig; alles draait binnen
  Node-RED.
- De palette **`@flowfuse/node-red-dashboard`** (Dashboard 2.0) voor de
  VRM-invulvelden. Te installeren via *Manage Palette* in de Node-RED editor.
- **Internettoegang** vanaf de GX naar `api.zaptec.com` (HTTPS).
- Een **Zaptec account met owner-rechten** op de betreffende installatie(s)
  (nodig om charger-state uit te lezen).

---

## Installatie

Eén bestand: [`flows.json`](./flows.json).

1. Installeer eenmalig in Node-RED (**Manage Palette → Install**) de package
   **`@flowfuse/node-red-dashboard`** (Dashboard 2.0, voor de VRM-invulvelden). Dit
   vereist tijdelijk internettoegang op de GX.
2. Open Node-RED op de GX (via VRM → *Venus OS Large* → Node-RED, of
   `http://<gx-ip>:1880`).
3. Menu (rechtsboven) → **Import** → plak de inhoud van [`flows.json`](./flows.json)
   → **Import**.
4. **Deploy**.
5. Configureer via het VRM-formulier (zie *Configuratie* hieronder).

Er verschijnen twee tabbladen:

- **Zaptec configuratie (VRM)** – het invulformulier (verschijnt als dashboard-tegel
  in VRM) plus de knop *"Toon mijn laadpalen"* om de charger-GUID op te zoeken.
- **Zaptec -> Victron (uitlezen)** – de eigenlijke integratie die de laadpaal
  read-only uitleest en als virtuele energiemeter toont.

> Geen VRM-invulvelden nodig en liever geen dashboard-palette? Verwijder na het
> importeren de tab **Zaptec configuratie (VRM)** en gebruik uitsluitend
> omgevingsvariabelen (Optie B hieronder). De uitlees-tab werkt dan zelfstandig.

---

## Configuratie

### Optie A – Invulvelden in VRM (aanbevolen)

De **klant of een medewerker** vult de Zaptec-gebruikersnaam, het wachtwoord en de
charger Id (GUID) in via een **formulier in VRM** — zonder Node-RED editor of SSH.

Waarom dit handig is voor jullie als installateur:

- **Per installatie de eigen Zaptec-inloggegevens** in plaats van één centraal
  account. Zo wordt het pollen verdeeld over meerdere accounts en loop je **niet
  tegen poll-/rate-limieten** aan.
- Configuratie gebeurt volledig **remote via VRM**; geen editor-toegang nodig voor
  de eindgebruiker.

**Zo werkt het** (bevestigd in de Venus OS Large-handleiding):

1. Zorg dat `@flowfuse/node-red-dashboard` is geïnstalleerd en de flow is gedeployed
   (zie *Installatie*).
2. Open in VRM onder **Venus OS Large** de **dashboard-tegel**.
3. Klik op **"Toon mijn laadpalen"** om de laadpalen van het account te tonen
   (naam + Id). Kopieer de juiste **Id (GUID)**.
4. Vul **gebruikersnaam, wachtwoord en charger Id** in en klik **Opslaan**.
5. De configuratie wordt opgeslagen in `/data/zaptec-config.json` (blijft behouden
   na herstart) en de uitlezing start automatisch.

De invoer wordt bewaard in de **global context** en in het bestand
`/data/zaptec-config.json`.

> Tip: het opslagbestand bevat het wachtwoord in leesbare vorm op de (lokale)
> `/data`-partitie van de GX. Wil je dat vermijden, gebruik dan Optie B met
> omgevingsvariabelen.

### Optie B – Omgevingsvariabelen (terugval)

In plaats van (of als terugval op) het VRM-formulier kun je op de GX
omgevingsvariabelen zetten (bijv. via de Node-RED `settings.js` onder
`functionGlobalContext`/`env`, of als OS-omgevingsvariabelen). Ingevulde
VRM-waarden hebben voorrang; ontbreken ze, dan gebruikt de flow deze variabelen:

| Variabele            | Verplicht | Standaard                 | Omschrijving                         |
|----------------------|-----------|---------------------------|--------------------------------------|
| `ZAPTEC_USERNAME`    | ja        | –                         | Zaptec portal-gebruikersnaam (e-mail)|
| `ZAPTEC_PASSWORD`    | ja        | –                         | Zaptec portal-wachtwoord             |
| `ZAPTEC_CHARGER_ID`  | ja        | –                         | GUID (`Id`) van de laadpaal          |
| `ZAPTEC_BASE_URL`    | nee       | `https://api.zaptec.com`  | API-basis-URL                        |
| `ZAPTEC_METER_POSITION` | nee    | `1` (AC-in 1)             | Positie in het systeem: `0` = AC-uit, `1` = AC-in 1, `2` = AC-in 2 |

### Charger-GUID opzoeken

De charger Id is de **GUID** (`Id`) van de laadpaal, niet de zichtbare naam of het
serienummer. Klik in de VRM dashboard-tegel op **"Toon mijn laadpalen"**: je ziet
per laadpaal de naam, de **Id (GUID)** en of hij online is. Kopieer de juiste `Id`.

### Poll-interval

Standaard elke 30 seconden. Aan te passen in de inject-node **Poll** (tab
*Zaptec -> Victron (uitlezen)*). Houd rekening met de Zaptec *API usage guidelines*
en poll niet onnodig vaak. Voor near-realtime data zonder polling biedt Zaptec ook
Service Bus-subscripties aan (buiten scope van dit flow).

---

## Meerdere laadpalen op één locatie

Dit flow is bedoeld voor **één laadpaal per GX** (het meest voorkomende geval). Wil
je op één GX meerdere laadpalen tonen, dupliceer dan op de tab
*Zaptec -> Victron (uitlezen)* de keten **1. Config & token → … →
4. Zaptec -> Victron energiemeter → Laadpaal-meter (Victron)** per extra laadpaal:

1. Geef elke keten een andere charger-GUID.
2. Gebruik **aparte context-sleutels** voor config, token en energieteller
   (bijv. `zaptecCfg2`, `zaptecToken2`, `zaptecEnergyForward2`), zodat de ketens
   elkaar niet overschrijven.
3. Voeg per laadpaal een eigen **`victron-virtual`** node toe (elk krijgt
   automatisch een eigen device-instance).

> Tip: voor veel laadpalen per locatie is een subflow met een eigen scope handiger.

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
- **Positie (AC-in / AC-uit)**: de meter wordt standaard op **AC-in 1**
  gepresenteerd (`Position = 1`). Wil je AC-uit of AC-in 2, zet dan
  `ZAPTEC_METER_POSITION` op respectievelijk `0` of `2` (of pas de `Position`-waarde
  aan in de functie *4. Zaptec -> Victron energiemeter*). Let op: `PositionIsAdjustable`
  van deze virtuele meter staat op `0`, dus de positie is **niet** via de GX-GUI te
  wijzigen — dit gebeurt uitsluitend via de flow. In Venus OS 3.80 kan het
  voorkomen dat de EVCS-widget de positie niet zichtbaar bijwerkt (bekend gedrag).
- **Alleen vermogen + energie zichtbaar**: zie de sectie *"Wat de virtuele
  energiemeter (rol EV charger) wél en niet toont"*. Sessie/laadstroom/laadtijd en
  per-fase-waarden worden door Venus OS 3.80 niet op de EVCS-pagina getoond.
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
| Node-status `auth mislukt`            | Verkeerde gebruikersnaam/wachtwoord (VRM-formulier of env-variabele).      |
| Status `wacht op VRM-configuratie`    | Nog niets ingevuld; vul het VRM-formulier in of zet de env-variabelen.     |
| `charger-id ontbreekt`                | Charger Id (GUID) niet ingevuld; zoek hem via **"Toon mijn laadpalen"**.   |
| `geen state ontvangen`                | Charger offline, of account heeft geen owner-rechten op de installatie.    |
| Dashboard-tegel/formulier ontbreekt   | `@flowfuse/node-red-dashboard` niet geïnstalleerd, of flow niet gedeployed.|
| "Unknown node" bij importeren         | Installeer eerst `@flowfuse/node-red-dashboard` via *Manage Palette*.      |
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
