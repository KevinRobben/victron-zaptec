# Thermia Calibra Cool (Genesis) → Victron

[`thermia-flows.json`](./thermia-flows.json) is een losse Node-RED-flow voor een
Thermia Calibra Cool met Genesis-controller.

De flow:

- leest het opgenomen vermogen via Modbus TCP;
- publiceert dit in Venus OS en VRM als virtuele **AC Load**;
- bouwt automatisch een energieteller op;
- bepaalt de vijf goedkoopste uren van de lokale kalenderdag;
- kan in die uren **SG Ready Boost** activeren;
- herstelt buiten die uren altijd de SG Ready-modus **Normal**.

Schrijven naar de warmtepomp staat standaard uit.

## Ondersteunde registers

De flow gebruikt zero-based Modbus-adressen. De nummers in de eerste kolom zijn de
de-facto nummers uit Thermia's registerkaart.

| De-facto | Modbus-adres | FC | Schaal | Gebruik |
|---|---:|---:|---:|---|
| `30159` | 158 | 4 | 100 | opgenomen vermogen van de warmtepomp in kW (Genesis 17.1) |
| `30079..30081` | 78..80 | 4 | 1 | alternatief: L1..L3 vermogen van Thermia's externe energiemeter |
| `30083` | 82 | 4 | 1 | werkelijk actieve Smart Grid-modus |
| `40125` | 124 | 3/6 | 1 | gewenste Power Consumption Control-modus |

Register `30158` is het **afgegeven thermische vermogen** en is dus nadrukkelijk
niet geschikt om het stroomverbruik in VRM te tonen. De flow gebruikt `30159`.

`30159` is toegevoegd in nieuwere Genesis-registerkaarten. Kies bij oudere
firmware `powerSource: 'meter'`; daarvoor moeten de stroombegrenzingsmodule en de
bijbehorende energiemeting van Thermia aanwezig zijn. Controleer altijd de
registerkaart die bij de geïnstalleerde controllerfirmware hoort.

## Vereisten

- Venus OS Large met Node-RED;
- een recente `node-red-contrib-victron` met Virtual AC Load;
- de palette `node-red-contrib-modbus`;
- Modbus TCP/IP ingeschakeld onder **Settings → BMS** op het Thermia-display;
- bereikbaarheid van de display-unit op TCP-poort 502;
- internettoegang vanaf de GX naar `api.energy-charts.info`.

Installeer `node-red-contrib-modbus` via **Manage Palette → Install**. Importeer
daarna `thermia-flows.json`.

## Configuratie

Alle installatie-instellingen staan bovenaan de flow in de oranje Function-node
**CONFIGURATIE — DUBBELKLIK**. Dubbelklik deze node en wijzig alleen dit blok:

```javascript
const config = {
    host: '192.168.1.50', // IP-adres Thermia-display
    port: 502,
    unitId: 1,
    powerSource: 'unit',  // 'unit' of 'meter'
    enableWrites: false   // pas op true na SG-Ready-controle
};
```

Na Deploy configureert deze node zelf de gedeelde Modbus TCP-verbinding. Je hoeft
de verborgen Modbus-configuratienode dus niet te openen. Klik desgewenst handmatig
op **Laad configuratie** om de instellingen opnieuw toe te passen.

De flow gebruikt altijd de vijf goedkoopste uren en accepteert prijsdata maximaal
90 minuten zonder verversing.

De flow schrijft waarde `3` (Boost) tijdens goedkope uren en waarde `0` (Normal)
daarbuiten naar `40125`. De tapwater-start- en stoptemperaturen worden niet
gewijzigd.

## Dynamische prijzen

De flow haalt de Nederlandse day-ahead beursprijzen volledig automatisch op. Er
is geen account, API-token, leverancier of Dynamic ESS-configuratie nodig.

EPEX SPOT heeft geen vrije publieke API. De officiële MATS/EEX-feed vereist een
betaald datacontract; rechtstreeks de EPEX-website scrapen is instabiel en de
gebruiksvoorwaarden beperken geautomatiseerd hergebruik. Daarom gebruikt de flow
de publieke **Fraunhofer Energy-Charts API** voor biedzone `NL`. Deze levert
dezelfde day-ahead marktprijzen onder CC BY 4.0.

De flow:

1. haalt bij het starten en daarna elke 30 minuten de prijzen op;
2. zet `EUR/MWh` om naar `EUR/kWh`;
3. middelt de 15-minutenprijzen naar uurprijzen;
4. kiest de vijf goedkoopste uren van de lokale kalenderdag.

De prijzen worden na publicatie vanzelf vernieuwd. Bij een API-storing blijft de
laatste geldige reeks maximaal 90 minuten bruikbaar. Daarna wordt Boost veilig
opgeheven en SG Ready `Normal` gevraagd.

### Optionele eigen prijsbron

De automatische feed is de standaard. Desgewenst kan een bestaande Dynamic
ESS-flow nog steeds op **Dynamic ESS prijsdata (optioneel)** worden aangesloten,
of kan een JSON-array retained op `thermia/day-ahead-prices` worden gepubliceerd:

   ```json
   [
     { "start": "2026-07-28T00:00:00+02:00", "price": 0.21 },
     { "start": "2026-07-28T01:00:00+02:00", "price": 0.18 }
   ]
   ```

Lever alle uren van de dag. Numerieke Unix-timestamps in seconden of milliseconden
worden eveneens geaccepteerd. Een handmatig aangeleverde reeks vervangt de
automatisch opgehaalde reeks tot de volgende automatische update.

## Veilig inschakelen

1. Laat `enableWrites: false`.
2. Deploy en controleer of de virtuele warmtepomp een geloofwaardig vermogen
   toont. Is `30159` niet beschikbaar, probeer de meterbron.
3. Controleer dat **Power Consumption Control** op de Thermia als
   **SG-Ready** is geconfigureerd, niet als `PL/LU`.
4. Controleer dat register `40125` leesbaar is en `30083` normaal waarde `4`
   rapporteert.
5. Controleer de groene status bij **Energy-Charts prijzen (NL)** en
   **Bepaal 5 goedkoopste uren**.
6. Zet pas daarna `enableWrites: true`.

De flow schrijft `40125` met Modbus FC6 en maximaal eenmaal per minuut. De volgende
poll leest zowel de gevraagde als werkelijk actieve modus terug. Voor de actuele
modus gebruikt Thermia: `1` = EVU, `4` = Normal, `5` = Comfort/Load-Up en `6` =
Boost.

> **Belangrijk:** in `PL/LU`-modus betekent waarde `3` Power Limit in plaats van
> Boost. Schakel schrijven daarom alleen in nadat SG-Ready op het display is
> bevestigd. Fysieke Smart Grid-ingangen kunnen de BMS-opdracht overschrijven.

Welke tapwater- en ruimteverwarmingsverhoging Boost veroorzaakt, stel je in op de
Thermia zelf in. De flow verandert die temperaturen niet. Houd rekening met
legionellapreventie en installatiegrenzen; de flow vervangt de ingebouwde
beveiligingen niet.

## Bronnen

- Thermia, *Modbus protocol for Atlas, Calibra, Calibra E, Calibra Cool,
  Calibra RXT and Diplomat Inverter – Genesis platform 17.1*.
- Victron Energy, `node-red-contrib-victron` Virtual Devices.
- Victron Energy, Dynamic ESS Node-RED-referentieflow.
- Fraunhofer ISE Energy-Charts API, Nederlandse day-aheadprijzen
  (`api.energy-charts.info`, CC BY 4.0).
