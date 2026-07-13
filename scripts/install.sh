#!/bin/bash
# =============================================================================
# Zaptec EV Charger – Victron Venus OS Installatiescript
# =============================================================================
# Installeert de Zaptec D-Bus brug op een Victron Cerbo GX / Venus OS apparaat.
# Voer dit script uit als root op het Cerbo GX/Venus OS systeem.
#
# Gebruik:
#   scp -r . root@venus.local:/tmp/zaptec-install/
#   ssh root@venus.local "bash /tmp/zaptec-install/scripts/install.sh"
# =============================================================================

set -e

INSTALL_DIR="/opt/victronenergy/zaptec-evcharger"
SERVICE_DIR="/opt/victronenergy/service"
RUNIT_DIR="/service"
LOG_DIR="/var/log/zaptec-evcharger"
CONF_FILE="/etc/default/zaptec-evcharger"

# Kleuren voor output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info()    { echo -e "${GREEN}[INFO]${NC}  $1"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC}  $1"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $1"; }
log_section() { echo -e "\n${GREEN}=== $1 ===${NC}"; }

# Controleer of we als root draaien
if [ "$(id -u)" -ne 0 ]; then
    log_error "Dit script moet als root worden uitgevoerd"
    exit 1
fi

# Controleer of we op Venus OS draaien
if [ ! -f /etc/venus/machine ]; then
    log_warn "Geen Venus OS gedetecteerd (/etc/venus/machine ontbreekt)"
    log_warn "Verdergaan in testmodus – sommige stappen worden overgeslagen"
    VENUS_OS=false
else
    MACHINE=$(cat /etc/venus/machine)
    log_info "Venus OS apparaat: $MACHINE"
    VENUS_OS=true
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"

log_section "1. paho-mqtt Python bibliotheek installeren"
if python3 -c "import paho.mqtt" 2>/dev/null; then
    log_info "paho-mqtt is al geïnstalleerd"
else
    log_info "paho-mqtt installeren..."
    pip3 install paho-mqtt --break-system-packages 2>/dev/null || \
    pip3 install paho-mqtt || \
    opkg install python3-paho-mqtt 2>/dev/null || \
    { log_error "Kon paho-mqtt niet installeren. Installeer handmatig met: pip3 install paho-mqtt"; exit 1; }
    log_info "paho-mqtt geïnstalleerd"
fi

log_section "2. Python D-Bus brug service installeren"
mkdir -p "$INSTALL_DIR"
cp "$SCRIPT_DIR/dbus-evcharger.py" "$INSTALL_DIR/"
chmod +x "$INSTALL_DIR/dbus-evcharger.py"
log_info "Script geïnstalleerd in $INSTALL_DIR"

log_section "3. Runit service installeren"
SERVICE_INSTALL_DIR="$SERVICE_DIR/zaptec-evcharger"
mkdir -p "$SERVICE_INSTALL_DIR/log"
mkdir -p "$LOG_DIR"

cp "$REPO_DIR/services/zaptec-evcharger/run"     "$SERVICE_INSTALL_DIR/run"
cp "$REPO_DIR/services/zaptec-evcharger/log/run" "$SERVICE_INSTALL_DIR/log/run"
chmod +x "$SERVICE_INSTALL_DIR/run"
chmod +x "$SERVICE_INSTALL_DIR/log/run"
log_info "Runit service bestanden geïnstalleerd"

log_section "4. Configuratiebestand aanmaken"
if [ ! -f "$CONF_FILE" ]; then
    cp "$REPO_DIR/services/zaptec-evcharger/conf" "$CONF_FILE"
    log_info "Configuratiebestand aangemaakt: $CONF_FILE"
    log_warn "Pas $CONF_FILE aan indien nodig (bijv. ander MQTT broker adres)"
else
    log_info "Configuratiebestand bestaat al: $CONF_FILE (niet overschreven)"
fi

log_section "5. Node-RED omgevingsvariabelen"
log_warn "Stel de volgende omgevingsvariabelen in voor Node-RED:"
echo ""
echo "  ZAPTEC_USERNAME   = jouw Zaptec account e-mailadres"
echo "  ZAPTEC_PASSWORD   = jouw Zaptec account wachtwoord"
echo "  VENUS_MQTT_HOST   = localhost (of IP van MQTT broker)"
echo ""

if $VENUS_OS; then
    NODERED_ENV="/etc/venus/nodered.env"
    if [ -f "$NODERED_ENV" ]; then
        log_info "Voeg variabelen toe aan $NODERED_ENV of stel ze in via Node-RED beheerinterface"
    else
        log_info "Stel omgevingsvariabelen in via Node-RED beheerinterface (Beheer > Omgevingsvariabelen)"
        log_info "Of maak /etc/venus/nodered.env aan met de variabelen"
    fi
fi

log_section "6. Node-RED flow importeren"
echo ""
echo "  1. Open Node-RED in uw browser: http://venus.local:1880"
echo "  2. Klik op het hamburgermenu (≡) rechtsboven"
echo "  3. Kies 'Importeren'"
echo "  4. Klik 'Bestand selecteren' en kies: flows/zaptec-victron-bridge.json"
echo "  5. Klik 'Importeren' en vervolgens 'Implementeren'"
echo ""

log_section "7. Runit service activeren en starten"
if $VENUS_OS; then
    # Koppel de service aan /service voor automatisch opstarten
    if [ ! -L "$RUNIT_DIR/zaptec-evcharger" ]; then
        ln -sf "$SERVICE_DIR/zaptec-evcharger" "$RUNIT_DIR/zaptec-evcharger"
        log_info "Runit symlink aangemaakt"
    fi

    # Service starten
    sleep 1
    if sv status zaptec-evcharger 2>/dev/null | grep -q "run:"; then
        log_info "Service draait al"
    else
        sv start zaptec-evcharger 2>/dev/null && log_info "Service gestart" || \
            log_warn "Service kon niet automatisch worden gestart. Probeer: sv start zaptec-evcharger"
    fi
else
    log_info "Niet op Venus OS – service handmatig starten met:"
    echo "  python3 $INSTALL_DIR/dbus-evcharger.py"
fi

log_section "Installatie voltooid!"
echo ""
echo "  Controleer service status:  sv status zaptec-evcharger"
echo "  Bekijk service logs:        tail -f $LOG_DIR/current"
echo "  Herstart service:           sv restart zaptec-evcharger"
echo ""
log_info "Zodra Node-RED de eerste Zaptec-meetwaarden publiceert, verschijnen"
log_info "de laadpalen automatisch als EV Charger in Victron VRM en GX-display."
