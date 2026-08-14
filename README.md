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
2. **Uitlezen (adaptief)** – `GET /api/chargers/{id}/state` wordt opgehaald met een
   *variabel* interval in plaats van constant pollen:
   - **live meekijken** (VRM-app/GX-display open): snel, standaard **5 s**;
   - **aan het laden** (geen kijker): standaard **15 s**;
   - **idle** (niet laden, geen kijker): traag, standaard **120 s** — de meter
     staat dan gewoon op 0 W.

   Zie *Slim pollen* hieronder.
3. **Omzetten** – de relevante observaties worden vertaald naar Victron
   D-Bus-paden.
4. **Presenteren** – de `victron-virtual` node (uit `node-red-contrib-victron`)
   maakt een virtuele energiemeter met rol `evcharger`. Venus OS registreert
   deze onder de service `com.victronenergy.evcharger.*`, waardoor de laadpaal in
   de GX-GUI en VRM als EV-lader verschijnt.

HTTP-calls naar Zaptec gebruiken `Connection: close` (geen keep-alive). Tijdelijke
netwerkfouten zoals `ECONNRESET`, timeouts, HTTP 429 en 502–504 worden tot twee
keer opnieuw geprobeerd met backoff; een 401/403 dwingt een nieuw token af.

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
- Optioneel (voor de live-kijk detectie): **MQTT op LAN (plaintext)** ingeschakeld op
  de GX (*Instellingen → Services*). Zonder dit werkt alles door, maar valt het
  pollen terug op het laad-/idle-interval.
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
  in VRM) met gebruikersnaam/wachtwoord, een dropdown met de gekoppelde laadpalen en
  een dropdown voor de positie.
- **Zaptec -> Victron (uitlezen)** – de eigenlijke integratie die de laadpaal
  read-only uitleest en als virtuele energiemeter toont.

> Geen VRM-invulvelden nodig en liever geen dashboard-palette? Verwijder na het
> importeren de tab **Zaptec configuratie (VRM)** en gebruik uitsluitend
> omgevingsvariabelen (Optie B hieronder). De uitlees-tab werkt dan zelfstandig.

---

## Configuratie

### Optie A – Invulvelden in VRM (aanbevolen)

De **klant of een medewerker** vult de Zaptec-gebruikersnaam, het wachtwoord en de
laadpaalkeuze in via een **formulier in VRM** — zonder Node-RED editor of SSH.

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
3. Vul **gebruikersnaam en wachtwoord** in en klik **"Inloggegevens opslaan"**.
4. De laadpalen worden **automatisch opgehaald**. In de dropdown **"Gekoppelde
   laadpaal"** wordt de eerst gevonden laadpaal automatisch geselecteerd en meteen
   op de achtergrond gebruikt voor het uitlezen. Staat er meer dan één laadpaal op
   het account, dan kies je hier eenvoudig de juiste.
5. Kies bij **"Positie van de laadpaal"** waar de lader in het systeem zit:
   **AC-in** (standaard) of **AC-uit**.
6. Elke wijziging in een dropdown wordt **automatisch opgeslagen** en bevestigd met
   een melding (toast). Alles wordt bewaard in `/data/zaptec-config.json` (blijft
   behouden na herstart).

> Bij het **openen van de dashboard-pagina** worden de opgeslagen waarden hersteld:
> de **gebruikersnaam** wordt voorinvuld, de **laadpaal-dropdown** en de
> **positie** worden gevuld met de opgeslagen keuze. Het **wachtwoord** blijft
> bewust leeg. Ziet je browser toch een gebruikersnaam/wachtwoord (bijv. `admin`)
> ingevuld staan, dan komt dat van de autofill-/wachtwoordmanager van de browser —
> onze prefill zet de juiste gebruikersnaam bij het openen.
>
> Na een herstart worden de laadpalen automatisch opnieuw opgehaald (zolang de
> inloggegevens bekend zijn), zodat de dropdown de actieve laadpaal blijft tonen.

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
| `ZAPTEC_METER_POSITION` | nee    | `1` (AC-in)               | Positie in het systeem: `1` = AC-in, `0` = AC-uit |
| `ZAPTEC_POLL_WATCHING_SEC` | nee | `5`                       | Poll-interval terwijl iemand live meekijkt |
| `ZAPTEC_POLL_CHARGING_SEC` | nee | `15`                      | Poll-interval tijdens laden (geen kijker) |
| `ZAPTEC_POLL_IDLE_SEC` | nee     | `120`                     | Poll-interval bij idle (geen kijker) |
| `ZAPTEC_WATCH_TIMEOUT_SEC` | nee | `90`                      | Hoelang na de laatste MQTT-activiteit "iemand kijkt" blijft gelden |

### Laadpaal kiezen

Je hoeft geen GUID meer op te zoeken of in te typen. Na *"Inloggegevens opslaan"*
worden alle aan het account gekoppelde laadpalen opgehaald en getoond in de dropdown
**"Gekoppelde laadpaal"** (op naam). De eerste wordt automatisch gekozen; selecteer
desgewenst een andere. De keuze wordt direct opgeslagen en gebruikt.

### Slim pollen (adaptief + live-kijk detectie)

In plaats van constant elke 30 s te pollen, past de flow het interval automatisch
aan. Een vaste basistik (5 s) op de tab *Zaptec -> Victron (uitlezen)* laat een
**planner** bepalen of er echt opgehaald wordt:

| Situatie | Interval (instelbaar) | Env-variabele |
|---|---|---|
| Er kijkt iemand live mee | 5 s | `ZAPTEC_POLL_WATCHING_SEC` |
| Aan het laden (geen kijker) | 15 s | `ZAPTEC_POLL_CHARGING_SEC` |
| Idle (niet laden, geen kijker) | 120 s | `ZAPTEC_POLL_IDLE_SEC` |
| "Kijker aanwezig" vervaltijd | 90 s | `ZAPTEC_WATCH_TIMEOUT_SEC` |

**Live-kijk detectie zonder extra API-calls.** De flow luistert *passief* mee op de
lokale Venus MQTT-broker (`N/+/system/0/#`). De Venus-broker stuurt alleen live
data zolang een client (de **VRM-app**, het **GX-display** of een lokale app) hem
"wakker" houdt via keepalives. Onze flow stuurt **zelf geen keepalive**, dus we
ontvangen alleen berichten wanneer er daadwerkelijk iemand live meekijkt. Zodra dat
zo is, schakelt de planner over op snel pollen (5 s); daarna weer terug.

> **Vereist voor de live-kijk detectie:** *MQTT op LAN (plaintext)* moet aan staan op
> de GX: **Instellingen → Services → MQTT op LAN (plaintext)**. Staat dit uit, dan
> werkt de rest gewoon door; de flow valt dan terug op het laad-/idle-interval.
>
> **Let op:** heeft je GX een fysiek aangesloten display (bijv. GX Touch), dan houdt
> dat display de broker mogelijk continu wakker, waardoor "live kijken" vrijwel
> altijd als actief wordt gezien. Op een Cerbo zonder display werkt de detectie het
> zuiverst.

Zo krijg je hoge resolutie precies wanneer het nuttig is (iemand kijkt of er wordt
geladen) en minimaliseer je API-verkeer als er niets te zien is — in lijn met de
Zaptec *API usage guidelines* (vermijd agressief pollen; max. 10 requests/s per
account).

### Nog verder: echte push via Zaptec Service Bus (geavanceerd)

Zaptec raadt voor realtime-data **Service Bus (AMQP)** aan in plaats van pollen: de
laadpaal *pusht* dan state-observaties. Dit is de meest efficiënte optie, maar
vergt: per installatie een *message subscription* aanzetten, verbindingsgegevens via
de API ophalen (`/api/userGroups/{id}/messagingConnectionDetails`), en een AMQP
1.0-client in Node-RED. Subscripties worden na 14 dagen inactiviteit uitgeschakeld
en per installatie kunnen max. 2 subscripties tegelijk meelezen. Voor een
installateur met veel locaties is dit zwaarder in beheer; daarom gebruikt dit flow
standaard het adaptieve pollen hierboven. De Service Bus-aanpak is een mogelijke
uitbreiding.

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
- **Positie (AC-in / AC-uit)**: standaard **AC-in** (`Position = 1`). Instelbaar via
  het **VRM-formulier** (keuzemenu *Positie van de laadpaal*: AC-in = `1`,
  AC-uit = `0`) of via de env-variabele `ZAPTEC_METER_POSITION`. Let op:
  `PositionIsAdjustable` van deze virtuele meter staat op `0`, dus de positie is
  **niet** via de GX-GUI te wijzigen — dit gebeurt uitsluitend via de flow/het
  formulier. In Venus OS 3.80 kan het voorkomen dat de EVCS-widget de positie niet
  zichtbaar bijwerkt (bekend gedrag).
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
- **Tijdelijke API-fouten**: `ECONNRESET`, timeouts en HTTP 429/5xx worden tot
  twee keer opnieuw geprobeerd. Blijft Zaptec onbereikbaar, dan pollen we
  langzamer tot het weer lukt (de meter blijft op de laatste geldige waarde).

---

## Probleemoplossing

| Symptoom                              | Oorzaak / oplossing                                                        |
|---------------------------------------|---------------------------------------------------------------------------|
| `auth mislukt (400)` / `inloggen mislukt (HTTP 400)` | Verkeerde gebruikersnaam/wachtwoord, **of** dit Zaptec-account heeft geen API-toegang/owner-rechten. Test dezelfde inloggegevens op <https://portal.zaptec.com>. |
| `auth mislukt (401/403)`              | Account bestaat maar mag deze installatie/charger niet uitlezen (owner-rol nodig). |
| Status `wacht op VRM-configuratie`    | Nog niets ingevuld; vul het VRM-formulier in of zet de env-variabelen.     |
| `charger-id ontbreekt`                | Nog geen laadpaal gekozen; sla inloggegevens op en kies er één in de dropdown. |
| `geen state ontvangen`                | Charger offline, of account heeft geen owner-rechten op de installatie.    |
| `RequestError: read ECONNRESET` / status `verbinding met Zaptec verbroken` | Zaptec (nginx) heeft de TCP-verbinding verbroken, meestal door een gesloten keep-alive socket of een korte storing. De flow sluit verbindingen bewust (`Connection: close`) en probeert het tot 2× opnieuw. Een losse melding is onschuldig; de volgende poll gaat vanzelf verder. Blijft het **aanhouden**: GX herstarten, internetpad naar `api.zaptec.com` controleren, of even later opnieuw. Bij een GX Touch kan "live kijken" continu actief zijn (poll elke 5 s); dat is geen oorzaak van ECONNRESET, maar bij aanhoudende resets kun je `ZAPTEC_POLL_WATCHING_SEC` tijdelijk verhogen. |
| Dashboard-tegel/formulier ontbreekt   | `@flowfuse/node-red-dashboard` niet geïnstalleerd, of flow niet gedeployed.|
| "Unknown node" bij importeren         | Installeer eerst `@flowfuse/node-red-dashboard` via *Manage Palette*.      |
| Meldingen `Cannot save user settings: Settings not available` / `Property 'telemetryEnabled'…` | **Onschuldig.** Dit zijn bekende Node-RED/Venus OS-meldingen van Dashboard 2.0 rond runtime-settings/telemetry; ze blokkeren de werking niet en mogen genegeerd worden. |
| Meter verschijnt niet in de GX        | `node-red-contrib-victron` te oud, of device-type/rol niet ondersteund.    |
| Energie loopt niet op                 | Configureer een persistent context store of vertrouw op OCMF (obs. 554).   |

**Feedback in VRM:** het dashboard toont nu een **melding (toast)** bij opslaan en bij
fouten, en een **Status-regel** met de laatste uitlezing of foutmelding. Zie je daar
`inloggen mislukt (HTTP 400)`, dan ligt het aan de inloggegevens/rechten van het
Zaptec-account, niet aan de flow.

Zet in de node **meter payload** (debug) op *actief* om de exacte payload naar de
virtuele meter te inspecteren.

---

## Bronnen

- Zaptec API-authenticatie: <https://docs.zaptec.com/docs/api-authentication>
- Zaptec API usage guidelines: <https://docs.zaptec.com/docs/api-usage-guidelines>
- Zaptec constants (observatie-ID's): <https://api.zaptec.com/api/constants>
- Victron `node-red-contrib-victron` (Virtual Devices):
  <https://github.com/victronenergy/node-red-contrib-victron/wiki/Virtual-Devices>
