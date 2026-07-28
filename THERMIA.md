# Thermia Calibra Cool (Genesis) → Victron

[`thermia-flows.json`](./thermia-flows.json) is een losse Node-RED-flow voor een
Thermia Calibra Cool met Genesis-controller.

De flow:

- leest het opgenomen vermogen via Modbus TCP;
- publiceert dit in Venus OS en VRM als virtuele **AC Load**;
- bouwt automatisch een energieteller op;
- bepaalt de vijf goedkoopste uren van de lokale kalenderdag;
- kan in die uren de tapwater-start- én stoptemperatuur met dezelfde waarde
  verhogen, zodat de bestaande hysterese gelijk blijft;
- herstelt buiten die uren altijd de normale ingestelde temperaturen.

Schrijven naar de warmtepomp staat standaard uit.

## Ondersteunde registers

De flow gebruikt zero-based Modbus-adressen. De nummers in de eerste kolom zijn de
de-facto nummers uit Thermia's registerkaart.

| De-facto | Modbus-adres | FC | Schaal | Gebruik |
|---|---:|---:|---:|---|
| `30159` | 158 | 4 | 100 | opgenomen vermogen van de warmtepomp in kW (Genesis 17.1) |
| `30079..30081` | 78..80 | 4 | 1 | alternatief: L1..L3 vermogen van Thermia's externe energiemeter |
| `40023` | 22 | 3/16 | 100 | starttemperatuur tapwater |
| `40024` | 23 | 3/16 | 100 | stoptemperatuur tapwater |

Register `30158` is het **afgegeven thermische vermogen** en is dus nadrukkelijk
niet geschikt om het stroomverbruik in VRM te tonen. De flow gebruikt `30159`.

`30159` is toegevoegd in nieuwere Genesis-registerkaarten. Kies bij oudere
firmware `THERMIA_POWER_SOURCE=meter`; daarvoor moeten de stroombegrenzingsmodule
en de bijbehorende energiemeting van Thermia aanwezig zijn. Controleer altijd de
registerkaart die bij de geïnstalleerde controllerfirmware hoort.

## Vereisten

- Venus OS Large met Node-RED;
- een recente `node-red-contrib-victron` met Virtual AC Load;
- de palette `node-red-contrib-modbus`;
- Modbus TCP/IP ingeschakeld onder **Settings → BMS** op het Thermia-display;
- bereikbaarheid van de display-unit op TCP-poort 502.

Installeer `node-red-contrib-modbus` via **Manage Palette → Install**. Importeer
daarna `thermia-flows.json` en voer vóór Deploy het IP-adres in bij de
configuratienode **Thermia Genesis**, of stel `THERMIA_HOST` in.

## Configuratie

Node-RED vervangt `${THERMIA_HOST}` in de Modbus-configuratienode uit een
omgevingsvariabele. De overige waarden worden rechtstreeks in de Function-nodes
uit de omgeving gelezen.

| Variabele | Standaard | Betekenis |
|---|---|---|
| `THERMIA_HOST` | verplicht | IP-adres/hostnaam van de Genesis-display-unit |
| `THERMIA_UNIT_ID` | `1` | Modbus unit-id; bij TCP meestal niet relevant |
| `THERMIA_POWER_SOURCE` | `unit` | `unit` = register 30159, `meter` = som 30079..30081 |
| `THERMIA_ENABLE_WRITES` | `false` | pas na controle op `true` zetten |
| `THERMIA_TAPWATER_START_C` | automatisch leren | normale starttemperatuur |
| `THERMIA_TAPWATER_STOP_C` | automatisch leren | normale stoptemperatuur |
| `THERMIA_CHEAP_DELTA_C` | `3` | verhoging tijdens goedkope uren, 0–10 °C |
| `THERMIA_MAX_TAPWATER_C` | `60` | absolute bovengrens voor beide doelwaarden |
| `THERMIA_CHEAPEST_HOURS` | `5` | aantal goedkoopste uren, 1–24 |
| `THERMIA_PRICE_MAX_AGE_MIN` | `90` | maximale ouderdom van aangeleverde prijsdata |

Vul de normale start- en stoptemperatuur bij voorkeur expliciet in. Als ze
ontbreken, leert de flow ze alleen tijdens een geldig, niet-goedkoop uur. Daardoor
kan de regeling bij een eerste start in een goedkoop uur bewust nog niets
schrijven.

## Dynamic ESS-prijzen koppelen

Venus OS zelf is prijsagnostisch: de VRM-versie van Dynamic ESS publiceert de
uurprijzen niet als lokaal D-Bus- of MQTT-pad. De flow kan ze daarom niet
rechtstreeks uit `com.victronenergy.system` lezen.

Er zijn drie ondersteunde koppelingen:

1. **Dynamic ESS Node-RED-flow**  
   Maak na een prijsupdate een Change-node:
   - zet `msg.payload` op `flow.dess`;
   - verbind deze met **Dynamic ESS prijsdata (optioneel)**, of sla de waarde op
     als `global.thermiaDess`.

   De officiële Dynamic ESS-structuur `dess.output.p_b` wordt direct herkend.

2. **MQTT**  
   Publiceer een JSON-array retained op `thermia/day-ahead-prices`:

   ```json
   [
     { "start": "2026-07-28T00:00:00+02:00", "price": 0.21 },
     { "start": "2026-07-28T01:00:00+02:00", "price": 0.18 }
   ]
   ```

   Lever alle 24 uren van de dag. Numerieke Unix-timestamps in seconden of
   milliseconden worden eveneens geaccepteerd.

3. **Global context**  
   Zet een van bovenstaande objecten in `global.thermiaPrices`.

De vijf laagste prijzen worden over de **lokale kalenderdag van de GX** gekozen.
Bij ontbrekende, onvolledige of te oude prijsdata wordt niet verhoogd. Als
schrijven aan staat en normale waarden bekend zijn, herstelt de flow dan de
normale tapwaterinstellingen.

## Veilig inschakelen

1. Laat `THERMIA_ENABLE_WRITES=false`.
2. Deploy en controleer of de virtuele warmtepomp een geloofwaardig vermogen
   toont. Is `30159` niet beschikbaar, probeer de meterbron.
3. Controleer in Debug de gelezen waarden van `40023/40024`.
4. Stel normale start/stop, delta en maximale temperatuur expliciet in.
5. Koppel de prijsreeks en controleer de status onder **Bepaal 5 goedkoopste uren**.
6. Zet pas daarna `THERMIA_ENABLE_WRITES=true`.

De flow schrijft beide temperaturen atomair met Modbus FC16 en maximaal eenmaal
per minuut. De volgende poll leest de waarden terug. Thermia geeft aan dat deze
registers alleen geldig zijn als de tapwatermodus **Normal** is.

Houd rekening met legionellapreventie, lokale regelgeving, boilervat- en
installatiegrenzen. Deze flow vervangt de beveiligingen of het periodieke
anti-legionellaprogramma van de warmtepomp niet.

## Bronnen

- Thermia, *Modbus protocol for Atlas, Calibra, Calibra E, Calibra Cool,
  Calibra RXT and Diplomat Inverter – Genesis platform 17.1*.
- Victron Energy, `node-red-contrib-victron` Virtual Devices.
- Victron Energy, Dynamic ESS Node-RED-referentieflow.
