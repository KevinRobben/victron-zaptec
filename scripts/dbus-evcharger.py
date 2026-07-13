#!/usr/bin/env python3
"""
Zaptec EV Charger – Victron D-Bus Virtuele Service
===================================================
Luistert op MQTT-topic 'zaptec/+/measurements' (gepubliceerd door Node-RED)
en registreert voor elke Zaptec-laadpaal een com.victronenergy.evcharger
service op de Venus OS D-Bus.

De dbus-mqtt bridge op Venus OS maakt deze services vervolgens automatisch
zichtbaar in het VRM-portaal, het GX-display en de Victron-apps.

Installatie:
  Zie install.sh of README.md

Vereisten (Venus OS):
  - paho-mqtt  (pip3 install paho-mqtt)
  - vedbus / velib_python  (meegeleverd met Venus OS)
  - dbus-python (standaard aanwezig op Venus OS)
"""

import sys
import os
import json
import logging
import time
import threading
import signal

# ──────────────────────────────────────────────
# Zoek de Victron Python-bibliotheken op Venus OS
# ──────────────────────────────────────────────
VELIB_PATHS = [
    '/opt/victronenergy/dbus-systemcalc-py/ext/velib_python',
    '/opt/victronenergy/velib_python',
    '/usr/lib/python3/dist-packages',
    '/usr/local/lib/python3/dist-packages',
]
for p in VELIB_PATHS:
    if os.path.isdir(p):
        sys.path.insert(0, p)

try:
    from vedbus import VeDbusService
    from settingsdevice import SettingsDevice
    import dbus
    from dbus.mainloop.glib import DBusGMainLoop
    try:
        from gi.repository import GLib
    except ImportError:
        import gobject as GLib
    DBUS_AVAILABLE = True
except ImportError:
    DBUS_AVAILABLE = False
    logging.warning("Victron D-Bus bibliotheken niet gevonden – alleen MQTT-logmodus actief")

try:
    import paho.mqtt.client as mqtt
    MQTT_AVAILABLE = True
except ImportError:
    MQTT_AVAILABLE = False
    logging.error("paho-mqtt niet gevonden. Installeer met: pip3 install paho-mqtt")
    sys.exit(1)

# ──────────────────────────────────────────────
# Configuratie via omgevingsvariabelen
# ──────────────────────────────────────────────
MQTT_HOST         = os.environ.get('VENUS_MQTT_HOST', 'localhost')
MQTT_PORT         = int(os.environ.get('VENUS_MQTT_PORT', '1883'))
MQTT_CLIENT_ID    = os.environ.get('MQTT_CLIENT_ID', 'zaptec-dbus-bridge')
DBUS_INSTANCE_BASE = int(os.environ.get('DBUS_INSTANCE_BASE', '40'))
LOG_LEVEL         = os.environ.get('LOG_LEVEL', 'INFO').upper()

logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
log = logging.getLogger('zaptec-dbus')


# ──────────────────────────────────────────────
# Victron EV Charger Status codes
# ──────────────────────────────────────────────
VICTRON_STATUS = {
    0: 'Ontkoppeld',
    1: 'Verbonden',
    2: 'Aan het opladen',
    3: 'Opgeladen',
    4: 'Wacht op zon',
    5: 'Wacht op RFID',
    6: 'Wacht op start',
    7: 'Laag SOC',
    8: 'Aardingsfout',
    9: 'Gelaste contacten',
    10: 'CP-ingang kortgesloten',
}


class ZaptecEvChargerService:
    """
    Registreert één com.victronenergy.evcharger D-Bus service
    voor een enkele Zaptec-laadpaal en werkt de waarden bij
    zodra nieuwe MQTT-meetwaarden binnenkomen.
    """

    def __init__(self, serial: str, name: str, dbus_instance: int, bus):
        self.serial        = serial
        self.name          = name
        self.dbus_instance = dbus_instance
        self._last_update  = None

        service_name = f'com.victronenergy.evcharger.zaptec_{serial}'
        log.info(f"Registreer D-Bus service: {service_name} (instantie {dbus_instance})")

        self._service = VeDbusService(service_name, bus)

        # ── Verplichte Management-paden ──────────────────────────────
        self._service.add_path('/Mgmt/ProcessName',    __file__)
        self._service.add_path('/Mgmt/ProcessVersion', '1.0.0')
        self._service.add_path('/Mgmt/Connection',     'MQTT – Zaptec API')

        # ── Apparaatidentificatie ────────────────────────────────────
        self._service.add_path('/DeviceInstance',  dbus_instance)
        self._service.add_path('/ProductId',       0xB040)      # Victron EV Charger product-ID
        self._service.add_path('/ProductName',     'Zaptec EV Charger')
        self._service.add_path('/CustomName',      name)
        self._service.add_path('/Serial',          serial)
        self._service.add_path('/FirmwareVersion', '1.0.0')
        self._service.add_path('/Connected',       1)

        # ── Status & modus ──────────────────────────────────────────
        self._service.add_path('/Status',          0)    # 0 = Ontkoppeld
        self._service.add_path('/Mode',            0)    # 0 = Handmatig

        # ── Totale AC-grootheden ─────────────────────────────────────
        self._service.add_path('/Ac/Power',        None, gettextcallback=lambda p, v: '{:.0f}W'.format(v) if v is not None else '--')
        self._service.add_path('/Ac/Current',      None, gettextcallback=lambda p, v: '{:.1f}A'.format(v) if v is not None else '--')
        self._service.add_path('/Ac/Voltage',      None, gettextcallback=lambda p, v: '{:.1f}V'.format(v) if v is not None else '--')

        # ── Per-fase AC-grootheden ───────────────────────────────────
        for phase in ('L1', 'L2', 'L3'):
            self._service.add_path(f'/Ac/{phase}/Power',   None, gettextcallback=lambda p, v: '{:.0f}W'.format(v) if v is not None else '--')
            self._service.add_path(f'/Ac/{phase}/Current', None, gettextcallback=lambda p, v: '{:.1f}A'.format(v) if v is not None else '--')
            self._service.add_path(f'/Ac/{phase}/Voltage', None, gettextcallback=lambda p, v: '{:.1f}V'.format(v) if v is not None else '--')

        # ── Energietellers ───────────────────────────────────────────
        self._service.add_path('/Ac/Energy/Forward',       None, gettextcallback=lambda p, v: '{:.3f}kWh'.format(v) if v is not None else '--')
        self._service.add_path('/Ac/EnergySession',        None, gettextcallback=lambda p, v: '{:.3f}kWh'.format(v) if v is not None else '--')

        # ── Laadstroom (alleen-lezen in deze brug) ───────────────────
        self._service.add_path('/Current',         None)
        self._service.add_path('/MaxCurrent',      None)
        self._service.add_path('/SetCurrent',      None)

        # ── Laadtijd en positie ──────────────────────────────────────
        self._service.add_path('/ChargingTime',    None)
        self._service.add_path('/Position',        1)   # 1 = AC-uitgang

        log.info(f"D-Bus service aangemaakt voor laadpaal '{name}' ({serial})")

    def update(self, data: dict):
        """Verwerk nieuwe meetwaarden van Zaptec en schrijf naar D-Bus."""
        try:
            s = self._service

            # Status & modus
            s['/Status'] = data.get('status', 0)
            s['/Mode']   = 0  # Altijd handmatig (read-only brug)

            # Totale vermogen & stroom
            power   = data.get('power')
            current = data.get('current')
            volt_l1 = data.get('voltage_l1')

            s['/Ac/Power']   = float(power)   if power   is not None else None
            s['/Ac/Current'] = float(current) if current is not None else None
            s['/Ac/Voltage'] = float(volt_l1) if volt_l1 is not None else None

            # Per fase
            for phase, suffix in (('L1', '1'), ('L2', '2'), ('L3', '3')):
                p = data.get(f'power_l{suffix}')
                c = data.get(f'current_l{suffix}')
                v = data.get(f'voltage_l{suffix}')
                s[f'/Ac/{phase}/Power']   = float(p) if p is not None else None
                s[f'/Ac/{phase}/Current'] = float(c) if c is not None else None
                s[f'/Ac/{phase}/Voltage'] = float(v) if v is not None else None

            # Energie
            e_total = data.get('energy_total')
            e_sess  = data.get('energy_session')
            s['/Ac/Energy/Forward'] = float(e_total) if e_total is not None else None
            s['/Ac/EnergySession']  = float(e_sess)  if e_sess  is not None else None

            # Laadstroom
            set_c   = data.get('set_current')
            s['/Current']    = float(current)  if current is not None else None
            s['/SetCurrent'] = float(set_c)    if set_c   is not None else None
            s['/MaxCurrent'] = 32.0  # Standaard Zaptec maximumstroom

            self._last_update = time.time()

            status_label = VICTRON_STATUS.get(data.get('status', 0), 'Onbekend')
            log.debug(
                f"[{self.name}] {power or 0:.0f} W | "
                f"Status: {status_label} | "
                f"Sessie: {e_sess or 0:.3f} kWh"
            )

        except Exception as exc:
            log.error(f"Fout bij bijwerken D-Bus waarden voor {self.serial}: {exc}")


class MockEvChargerService:
    """Vervangt VeDbusService als D-Bus niet beschikbaar is (test/debug modus)."""

    def __init__(self, serial: str, name: str, dbus_instance: int, bus=None):
        self.serial        = serial
        self.name          = name
        self.dbus_instance = dbus_instance
        self._last_update  = None
        log.info(f"[MOCK] EV Charger service aangemaakt voor '{name}' ({serial})")

    def update(self, data: dict):
        status_label = VICTRON_STATUS.get(data.get('status', 0), 'Onbekend')
        log.info(
            f"[MOCK][{self.name}] "
            f"Vermogen: {data.get('power', 0):.0f} W | "
            f"Stroom: {data.get('current', 0):.1f} A | "
            f"Status: {status_label} | "
            f"Sessie: {data.get('energy_session', 0):.3f} kWh | "
            f"Totaal: {data.get('energy_total', 0):.3f} kWh"
        )
        self._last_update = time.time()


class ZaptecVictronBridge:
    """
    Hoofdklasse die de MQTT-client beheert en D-Bus services aanmaakt
    en bijwerkt op basis van binnenkomende Zaptec-meetwaarden.
    """

    def __init__(self):
        self._services:   dict[str, ZaptecEvChargerService | MockEvChargerService] = {}
        self._instance_counter = DBUS_INSTANCE_BASE
        self._lock = threading.Lock()

        # D-Bus initialiseren
        if DBUS_AVAILABLE:
            DBusGMainLoop(set_as_default=True)
            self._bus = dbus.SystemBus()
        else:
            self._bus = None

        # MQTT-client instellen
        self._mqtt = mqtt.Client(client_id=MQTT_CLIENT_ID, protocol=mqtt.MQTTv311)
        self._mqtt.on_connect    = self._on_connect
        self._mqtt.on_disconnect = self._on_disconnect
        self._mqtt.on_message    = self._on_message

    # ── MQTT callbacks ────────────────────────────────────────────────

    def _on_connect(self, client, userdata, flags, rc):
        if rc == 0:
            log.info(f"Verbonden met MQTT broker {MQTT_HOST}:{MQTT_PORT}")
            client.subscribe('zaptec/+/measurements', qos=0)
            log.info("Geabonneerd op: zaptec/+/measurements")
        else:
            log.error(f"MQTT verbindingsfout, code: {rc}")

    def _on_disconnect(self, client, userdata, rc):
        if rc != 0:
            log.warning(f"Onverwacht verbroken van MQTT broker (code {rc}) – opnieuw verbinden...")

    def _on_message(self, client, userdata, msg):
        try:
            data = json.loads(msg.payload.decode('utf-8'))
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            log.warning(f"Ongeldig JSON bericht op {msg.topic}: {exc}")
            return

        serial = data.get('serial')
        name   = data.get('name', serial)

        if not serial:
            log.warning(f"Bericht zonder 'serial' veld ontvangen op {msg.topic}")
            return

        with self._lock:
            if serial not in self._services:
                self._services[serial] = self._create_service(serial, name)

            # Bijwerken van de naam als die gewijzigd is
            service = self._services[serial]
            if hasattr(service, 'name') and service.name != name:
                service.name = name

            service.update(data)

    # ── Service aanmaken ──────────────────────────────────────────────

    def _create_service(self, serial: str, name: str):
        instance = self._instance_counter
        self._instance_counter += 1
        log.info(f"Nieuwe laadpaal gevonden: '{name}' ({serial}), D-Bus instantie {instance}")

        if DBUS_AVAILABLE:
            return ZaptecEvChargerService(serial, name, instance, self._bus)
        else:
            return MockEvChargerService(serial, name, instance)

    # ── Starten en stoppen ────────────────────────────────────────────

    def start(self):
        log.info("=== Zaptec-Victron D-Bus brug starten ===")
        log.info(f"MQTT broker: {MQTT_HOST}:{MQTT_PORT}")
        log.info(f"D-Bus beschikbaar: {DBUS_AVAILABLE}")

        self._mqtt.connect(MQTT_HOST, MQTT_PORT, keepalive=60)
        self._mqtt.loop_start()

        if DBUS_AVAILABLE:
            mainloop = GLib.MainLoop()

            def stop_handler(signum, frame):
                log.info("Afsluitverzoek ontvangen – service stoppen...")
                self._mqtt.loop_stop()
                self._mqtt.disconnect()
                mainloop.quit()

            signal.signal(signal.SIGTERM, stop_handler)
            signal.signal(signal.SIGINT,  stop_handler)

            log.info("D-Bus GLib mainloop gestart")
            mainloop.run()
        else:
            log.info("D-Bus niet beschikbaar – draaien in test/logmodus (Ctrl+C om te stoppen)")
            try:
                while True:
                    time.sleep(1)
            except KeyboardInterrupt:
                log.info("Gestopt door gebruiker")
            finally:
                self._mqtt.loop_stop()
                self._mqtt.disconnect()


def main():
    bridge = ZaptecVictronBridge()
    bridge.start()


if __name__ == '__main__':
    main()
