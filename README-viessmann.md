# Viessmann -> Victron warmtepomp-energiemeter (Node-RED)

Node-RED-applicatie die een **Viessmann warmtepomp read-only** uitleest via de
**Viessmann IoT API** en het **totaalverbruik** (vermogen in **W** en energie in
**kWh**) in **Victron (Venus OS / VRM)** presenteert als een **energiemeter met de
rol `AC load`**.

Op de GX en in VRM verschijnt de warmtepomp daardoor als een gemeten AC-verbruiker
(vermogen + verbruikte energie). Er wordt **niets gestuurd** richting Viessmann: de
integratie leest uitsluitend uit.

Deze integratie deelt bewust dezelfde onderliggende architectuur als de
[Zaptec -> Victron integratie](./README.md): een **VRM-invulformulier** voor de
inloggegevens en een **adaptief uitlees-flow** dat de meetwaarden als virtuele
Victron-meter toont. Alleen de API en de authenticatie verschillen.

- **Zaptec-flow:** [`zaptec-flows.json`](./zaptec-flows.json)
- **Viessmann-flow:** [`viessmann-flows.json`](./viessmann-flows.json)

De twee flows zijn volledig gescheiden (eigen tabbladen, eigen dashboard-tegel,
eigen node-id's en eigen configuratiebestand) en kunnen los of naast elkaar in
dezelfde Node-RED draaien.

---

## Hoe het werkt

```
  Viessmann IoT API                        Victron Venus OS
  ┌──────────────────────────┐             ┌───────────────────────────┐
  │ POST /idp/v3/authorize    │  Node-RED   │ victron-virtual node       │
  │ POST /idp/v3/token        │ ┌────────┐  │ device: energymeter        │
  │ GET  /iot/v2/.../features/ │─▶│ omzetten │─▶│ rol: acload (AC load)      │
  │      heating.power.        │ └────────┘  │ -> com.victronenergy.      │
  │      consumption.total     │             │    acload.virtual_...      │
  └──────────────────────────┘             └───────────────────────────┘
```

1. **Authenticatie** – OAuth2 *Authorization Code flow met PKCE* tegen
   `https://iam.viessmann-climatesolutions.com`. Viessmann ondersteunt geen
   *password grant*; in plaats daarvan sturen we (net als PyViCare/ViCare) een
   `authorize`-request met **HTTP Basic auth** (e-mail:wachtwoord). Viessmann
   antwoordt met een **302-redirect** naar `vicare://oauth-callback/everest?code=…`.
   Die redirect volgen we **niet**, maar we lezen de `code` uit de `Location`-header
   en wisselen die in voor een **access token** + **refresh token** (scope
   `IoT offline_access`).
2. **Token vernieuwen** – de access token (60 min geldig) wordt gecachet en met de
   **refresh token** automatisch vernieuwd, zonder opnieuw in te loggen. De refresh
   token wordt persistent bewaard, zodat het uitlezen ook na een herstart doorloopt.
3. **Uitlezen (adaptief)** – het feature `heating.power.consumption.total` wordt
   opgehaald met een *variabel* interval (zie *Slim pollen*). De Viessmann Basic-API
   kent een daglimiet, dus de intervallen staan bewust ruim.
4. **Omzetten** – de verbruiksdata wordt vertaald naar Victron D-Bus-paden
   (`Ac/Power`, `Ac/Energy/Forward`).
5. **Presenteren** – de `victron-virtual` node maakt een virtuele energiemeter met
   rol `acload`. Venus OS registreert deze onder `com.victronenergy.acload.*`,
   waardoor de warmtepomp in de GX-GUI en VRM als AC-verbruiker verschijnt.

## Wat wordt uitgelezen (verbruik in W en kWh)

Het feature `heating.power.consumption.total` levert **kWh-statistieken**
(dag/week/maand/jaar-arrays), geen momentaan vermogen. De flow leidt hieruit af:

| Victron D-Bus-pad        | Bron                                                        | Nauwkeurigheid |
|--------------------------|-------------------------------------------------------------|----------------|
| `Ac/Energy/Forward` (kWh)| **Som van de `year`-array** = cumulatief levensduurverbruik | nauwkeurig (monotoon oplopend) |
| `Ac/Power` (W)           | **Toename** van dat totaal tussen twee metingen, omgerekend naar gemiddeld vermogen | schatting (gemiddelde) |

> **Belangrijk over het vermogen (W).** Viessmann ververst de verbruiksdata maar
> **enkele keren per dag**. De getoonde W is daardoor een **gemiddeld vermogen** over
> de periode sinds de vorige update, geen realtime momentaan vermogen. De **kWh-teller
> is wel nauwkeurig** (dat is de officiële verbruiksstatistiek van Viessmann). Voor
> energiemonitoring/-registratie is dit prima; voor seconde-nauwkeurig live vermogen
> is de Viessmann-API (met name in het Basic-plan) niet bedoeld.

> **Let op – beschikbaarheid van verbruiksdata.** Of `heating.power.consumption.total`
> data teruggeeft, hangt af van het **toestelmodel** en je **API-plan**. Bij sommige
> modellen is de verbruiksstatistiek alleen beschikbaar in het **Advanced-plan**
> (betaald), ook al toont de ViCare-app hem wel. Krijg je `feature niet beschikbaar`
> (HTTP 404 / `FEATURE_NOT_FOUND`), controleer dan of het verbruik in de ViCare-app
> zichtbaar is en of je plan de feature dekt. Zie *Probleemoplossing*.

### Ander feature uitlezen

Standaard leest de flow `heating.power.consumption.total`. Wil je een ander feature
(bijv. alleen `heating.power.consumption.heating` of `...dhw`), zet dan de
env-variabele `VIESSMANN_CONSUMPTION_FEATURE`. De volledige lijst staat in de
Viessmann data-points-documentatie: <https://documentation.viessmann.com/static/iot/data-points>.

---

## Vereisten

- Een **Victron GX-toestel met Venus OS Large**, bij voorkeur **v3.80 of nieuwer**
  (Node-RED zit daarin).
- De node-set **`node-red-contrib-victron`** met de **Virtual Device**-node en de
  energiemeter-rol **`AC load`** (aanwezig in recente versies).
- De palette **`@flowfuse/node-red-dashboard`** (Dashboard 2.0) voor de
  VRM-invulvelden. Te installeren via *Manage Palette*.
- **`functionExternalModules`** ingeschakeld in Node-RED (standaard aan). De
  PKCE-login gebruikt de ingebouwde Node.js-module `crypto` via het *Setup/modules*
  tabblad van de function-node.
- Optioneel (voor de live-kijk detectie): **MQTT op LAN (plaintext)** op de GX.
- **Internettoegang** vanaf de GX naar `iam.viessmann-climatesolutions.com` en
  `api.viessmann-climatesolutions.com` (HTTPS).
- Een **Viessmann/ViCare-account** dat aan de installatie gekoppeld is, plus een
  **Client ID** (zie hieronder).

### Eenmalig: Client ID aanmaken (installateur)

De Viessmann-API vereist een **Client ID** (API key). Dit maak je **eenmalig** aan;
klanten hebben er verder geen omkijken naar.

1. Log in op de [Viessmann Developer Portal](https://app.developer.viessmann.com/)
   met een ViCare-account.
2. Ga naar **My Dashboard → Clients → + Add** en maak een client:
   - **Name:** bijv. `Victron-integratie`
   - **Google reCAPTCHA:** **Disabled** (belangrijk – anders werkt de login niet)
   - **Redirect URIs:** `vicare://oauth-callback/everest`
3. Kopieer de **Client ID**.

> Je kunt één Client ID voor meerdere installaties gebruiken. Houd wel rekening met
> de **rate limits** van je API-plan (die gelden per client/account). Voor een grote
> vloot kan het verstandig zijn per (groep) installatie(s) een eigen Client ID te
> gebruiken, zodat je niet tegen de daglimiet aanloopt.

---

## Installatie

Eén bestand: [`viessmann-flows.json`](./viessmann-flows.json).

1. Installeer eenmalig in Node-RED (**Manage Palette → Install**) de package
   **`@flowfuse/node-red-dashboard`** (Dashboard 2.0).
2. Open Node-RED op de GX (via VRM → *Venus OS Large* → Node-RED, of
   `http://<gx-ip>:1880`).
3. Menu (rechtsboven) → **Import** → plak de inhoud van
   [`viessmann-flows.json`](./viessmann-flows.json) → **Import**.
4. **Deploy**.
5. Configureer via het VRM-formulier (zie *Configuratie* hieronder).

Er verschijnen twee tabbladen:

- **Viessmann configuratie (VRM)** – het invulformulier (verschijnt als
  dashboard-tegel in VRM) met e-mail, wachtwoord, Client ID, een dropdown met de
  gekoppelde apparaten en een positie-keuze.
- **Viessmann -> Victron (uitlezen)** – de integratie die de warmtepomp read-only
  uitleest en als virtuele energiemeter toont.

> De Zaptec- en Viessmann-flows kunnen tegelijk in dezelfde Node-RED draaien: ze
> hebben eigen node-id's, een eigen dashboard-tegel (`/dashboard-viessmann`) en een
> eigen configuratiebestand (`/data/viessmann-config.json`).

---

## Configuratie

### Optie A – Invulvelden in VRM (aanbevolen)

De **klant of een medewerker** vult de gegevens in via een **formulier in VRM** —
zonder Node-RED editor of SSH.

1. Zorg dat `@flowfuse/node-red-dashboard` is geïnstalleerd en de flow is gedeployed.
2. Open in VRM onder **Venus OS Large** de **Viessmann dashboard-tegel**.
3. Vul in:
   - **Gebruikersnaam (e-mail)** en **Wachtwoord** van het ViCare-account;
   - **Client ID** (de API key uit de Developer Portal — kan door de installateur
     worden voorgevuld via de env-variabele `VIESSMANN_CLIENT_ID`, zodat de klant
     alleen e-mail + wachtwoord invult).
   Klik **"Inloggegevens opslaan"**.
4. De apparaten worden **automatisch opgehaald**. In de dropdown **"Gekoppeld
   apparaat (warmtepomp)"** wordt het eerst gevonden apparaat automatisch gekozen en
   meteen gebruikt. Staan er meerdere apparaten op het account, kies dan de juiste.
5. Kies bij **"Positie van de warmtepomp"** waar de warmtepomp in het systeem zit:
   **AC-in** (standaard) of **AC-uit**.
6. Elke wijziging wordt **automatisch opgeslagen** en bevestigd met een melding.
   Alles wordt bewaard in `/data/viessmann-config.json` (blijft behouden na herstart).

> Bij het **openen van de dashboard-pagina** worden de opgeslagen waarden hersteld:
> **e-mail** en **Client ID** worden voorinvuld, de apparaat-dropdown en de positie
> worden gevuld met de opgeslagen keuze. Het **wachtwoord** blijft bewust leeg.
>
> Na een herstart loopt het uitlezen door zolang de (persistent bewaarde) **refresh
> token** nog geldig is; verloopt die, dan wordt met de opgeslagen inloggegevens
> automatisch opnieuw ingelogd.

> Tip: het opslagbestand bevat het wachtwoord en de refresh token in leesbare vorm op
> de (lokale) `/data`-partitie van de GX. Wil je het wachtwoord vermijden, gebruik dan
> Optie B (env-variabelen) en log eenmalig in via het formulier om een refresh token
> te verkrijgen.

### Optie B – Omgevingsvariabelen (terugval / geavanceerd)

Ingevulde VRM-waarden hebben voorrang; ontbreken ze, dan gebruikt de flow deze
variabelen. De uitlees-tab kan hiermee zelfstandig werken **mits er al een geldige
refresh token bekend is** (die verkrijg je door eenmalig via het formulier in te
loggen, of via een externe OAuth-tool).

| Variabele                     | Verplicht | Standaard                                        | Omschrijving |
|-------------------------------|-----------|--------------------------------------------------|--------------|
| `VIESSMANN_CLIENT_ID`         | ja        | –                                                | Client ID uit de Developer Portal |
| `VIESSMANN_INSTALLATION_ID`   | ja*       | –                                                | Installation ID (via formulier of API) |
| `VIESSMANN_GATEWAY_SERIAL`    | ja*       | –                                                | Gateway-serienummer |
| `VIESSMANN_DEVICE_ID`         | nee       | `0`                                              | Device ID (meestal `0`) |
| `VIESSMANN_CONSUMPTION_FEATURE`| nee      | `heating.power.consumption.total`                | Uit te lezen feature |
| `VIESSMANN_METER_POSITION`    | nee       | `1` (AC-in)                                       | `1` = AC-in, `0` = AC-uit |
| `VIESSMANN_API_URL`           | nee       | `https://api.viessmann-climatesolutions.com`     | API-basis-URL |
| `VIESSMANN_IAM_URL`           | nee       | `https://iam.viessmann-climatesolutions.com`     | IAM/OAuth-basis-URL |
| `VIESSMANN_POLL_WATCHING_SEC` | nee       | `300`                                            | Poll-interval terwijl iemand live meekijkt |
| `VIESSMANN_POLL_ACTIVE_SEC`   | nee       | `900`                                            | Poll-interval als de warmtepomp actief verbruikt |
| `VIESSMANN_POLL_IDLE_SEC`     | nee       | `1800`                                           | Poll-interval bij idle |
| `VIESSMANN_WATCH_TIMEOUT_SEC` | nee       | `90`                                             | Hoelang "iemand kijkt" blijft gelden na de laatste MQTT-activiteit |

\* `INSTALLATION_ID`/`GATEWAY_SERIAL` worden normaal automatisch bepaald na het
inloggen via het formulier en in `/data/viessmann-config.json` bewaard; de
env-variabelen zijn alleen nodig als je volledig zonder formulier wilt werken.

### Slim pollen (adaptief + live-kijk detectie)

Net als de Zaptec-flow past deze flow het poll-interval automatisch aan: sneller als
iemand live in VRM meekijkt, trager bij idle. Omdat de Viessmann-data zelf maar
enkele keren per dag ververst én de Basic-API een daglimiet kent, staan de
intervallen bewust ruim (5/15/30 min). De live-kijk detectie werkt passief via de
lokale Venus MQTT-broker (`N/+/system/0/#`), zonder extra API-calls.

---

## Read-only garantie

Deze integratie gebruikt uitsluitend **lezende** API-aanroepen naar het IoT-endpoint:

- `POST /idp/v3/authorize` + `POST /idp/v3/token` (inloggen / token vernieuwen)
- `GET /iot/v2/equipment/installations?includeGateways=true` (apparaten opzoeken)
- `GET /iot/v2/features/installations/{id}/gateways/{serial}/devices/{deviceId}/features/{feature}` (meetwaarden)

Er worden geen `commands`/setter-endpoints aangeroepen; er wordt niets aan de
warmtepomp of installatie gewijzigd.

---

## Beperkingen & aandachtspunten

- **W is een gemiddelde, kWh is nauwkeurig** – zie *Wat wordt uitgelezen*. Door de
  lage ververssnelheid van de Viessmann-data is momentaan vermogen niet mogelijk.
- **Verbruiksdata niet altijd in Basic-plan** – afhankelijk van het model kan
  `heating.power.consumption.total` alleen in het Advanced-plan data teruggeven.
- **Rate limits** – de Basic-API heeft een daglimiet. De ruime poll-intervallen zijn
  hierop afgestemd; verlaag ze niet onnodig, zeker niet bij meerdere installaties op
  één Client ID.
- **reCAPTCHA moet uit** op de client, anders mislukt de Basic-auth-login.
- **Rol `AC load`** – standaard wordt de warmtepomp als AC-verbruiker getoond. In
  recente `node-red-contrib-victron`-versies bestaat ook een rol **`Heat pump`**
  (service `com.victronenergy.heatpump`); die is semantisch mooier maar wordt niet
  door elke Venus OS-versie herkend. Wil je die gebruiken, zet dan in de node
  **Warmtepomp-meter (Victron)** de energiemeter-rol op *Heat pump*.
- **Energieteller-persistentie** – de cumulatieve kWh komt uit de officiële
  Viessmann-jaarstatistiek en is dus stabiel na een herstart, ook zonder persistent
  context store.
- **Refresh-token-geldigheid** – refresh tokens verlopen na verloop van tijd. Bij een
  verlopen token logt de flow met de opgeslagen inloggegevens automatisch opnieuw in.

---

## Probleemoplossing

| Symptoom                                   | Oorzaak / oplossing |
|--------------------------------------------|---------------------|
| `login mislukt (400/401)`                  | Verkeerde e-mail/wachtwoord/Client ID, **of** reCAPTCHA staat nog aan op de client. Test dezelfde inloggegevens in de ViCare-app / op de Developer Portal. |
| `token mislukt` / `token vernieuwen mislukt` | Client ID onjuist, of refresh token verlopen. Log opnieuw in via het formulier. |
| `feature niet beschikbaar` (HTTP 404)      | Het toestelmodel/plan levert `heating.power.consumption.total` niet. Controleer of het verbruik in de ViCare-app zichtbaar is en of je plan dit dekt; probeer eventueel een ander feature via `VIESSMANN_CONSUMPTION_FEATURE`. |
| Status `wacht op VRM-configuratie`         | Nog niets ingevuld; vul het VRM-formulier in of zet de env-variabelen. |
| `log in via VRM-formulier`                 | Geen (geldige) refresh token; sla eenmalig inloggegevens op via het formulier. |
| `geen data ontvangen`                      | Apparaat offline of geen rechten op de installatie. |
| Dashboard-tegel/formulier ontbreekt        | `@flowfuse/node-red-dashboard` niet geïnstalleerd, of flow niet gedeployed. |
| Fout `crypto`/module niet gevonden bij login | `functionExternalModules` staat uit; zet die aan in `settings.js` (standaard aan in recente Node-RED). |
| Meter verschijnt niet in de GX             | `node-red-contrib-victron` te oud, of rol `AC load` niet ondersteund. |

Zet in de node **meter payload** (debug) op *actief* om de exacte payload naar de
virtuele meter te inspecteren.

---

## Bronnen

- Viessmann Developer Portal: <https://developer.viessmann-climatesolutions.com/>
- Viessmann API-authenticatie: <https://documentation.viessmann.com/static/authentication>
- Viessmann IoT data-points: <https://documentation.viessmann.com/static/iot/data-points>
- PyViCare (referentie voor de OAuth/PKCE-login): <https://github.com/somm15/PyViCare>
- Victron `node-red-contrib-victron` (Virtual Devices):
  <https://github.com/victronenergy/node-red-contrib-victron/wiki/Virtual-Devices>
