# Legacy aanpak – Venus OS vóór v3.80

> **Gebruik dit alleen als u Venus OS v3.80 niet kunt installeren.**  
> Voor Venus OS v3.80+ gebruikt u de hoofdaanpak in de repository root.

## Verschil met de v3.80 aanpak

In Venus OS < v3.80 ondersteunt de `dbus-mqtt` bridge geen virtuele EV-apparaten via MQTT. Daarom is een extra Python D-Bus service (`dbus-evcharger.py`) nodig die:

1. Luistert op MQTT-topic `zaptec/+/measurements`
2. Voor elke laadpaal een `com.victronenergy.evcharger` D-Bus service registreert
3. De D-Bus waarden bijwerkt bij elk binnenkomend MQTT-bericht

De `dbus-mqtt` bridge op Venus OS maakt deze D-Bus services vervolgens zichtbaar in VRM en het GX-display.

## Installatie (legacy)

```bash
scp -r . root@venus.local:/tmp/zaptec-install/
ssh root@venus.local "bash /tmp/zaptec-install/legacy/install-legacy.sh"
```

Importeer daarna dezelfde `flows/zaptec-victron-bridge.json` in Node-RED.  
De flow publiceert meetwaarden naar `zaptec/{serial}/measurements` en de Python service schrijft deze naar D-Bus.

> **Opmerking:** In de huidige flow (v3.80 versie) publiceert Node-RED rechtstreeks naar de Victron write-topics en is de Python service overbodig geworden. Als u de legacy Python service gebruikt, moet u de `func-transform-to-victron` functie aanpassen om naar `zaptec/{serial}/measurements` te publiceren in plaats van de directe Victron write-topics.
