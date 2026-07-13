#!/bin/bash
# =============================================================================
# Zaptec → Victron EV Charger – Installatiescript (Venus OS v3.80+)
# =============================================================================
# Configureert omgevingsvariabelen voor Node-RED en geeft stapsgewijze
# instructies voor het aanmaken van het virtuele EV-apparaat in Venus OS.
#
# Gebruik:
#   ssh root@venus.local
#   bash /tmp/zaptec-install/scripts/install.sh
# =============================================================================

set -e

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()    { echo -e "${GREEN}[INFO]${NC}  $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $1"; }
error()   { echo -e "${RED}[ERROR]${NC} $1"; }
section() { echo -e "\n${GREEN}══════════════════════════════════════════${NC}"; echo -e "${GREEN}  $1${NC}"; echo -e "${GREEN}══════════════════════════════════════════${NC}"; }

if [ "$(id -u)" -ne 0 ]; then
    error "Voer dit script uit als root (ssh root@venus.local)"
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"

# ── Venus OS versie controleren ────────────────────────────────────
section "1. Venus OS versie controleren"
if [ -f /etc/venus/machine ]; then
    MACHINE=$(cat /etc/venus/machine)
    info "Apparaat: $MACHINE"
fi

if [ -f /opt/victronenergy/version ]; then
    VER=$(cat /opt/victronenergy/version 2>/dev/null || echo 'onbekend')
    info "Venus OS versie: $VER"
    # Controleer op v3.80+
    MAJOR=$(echo "$VER" | cut -d. -f1)
    MINOR=$(echo "$VER" | cut -d. -f2 | cut -d~ -f1)
    if [ "$MAJOR" -lt 3 ] || { [ "$MAJOR" -eq 3 ] && [ "$MINOR" -lt 80 ]; }; then
        warn "Venus OS v3.80+ aanbevolen voor virtueel EV-apparaat support"
        warn "Huidige versie: $VER"
        warn "Installeer Venus OS v3.80 beta via: Instellingen → Firmware → Online updates → Controleer op updates (beta)"
    else
        info "Venus OS versie is geschikt voor virtueel EV-apparaat"
    fi
fi

# ── Node-RED omgevingsvariabelen instellen ─────────────────────────
section "2. Node-RED omgevingsvariabelen"

NODERED_ENV="/etc/venus/nodered.env"

# Vraag om VRM Portal ID
echo ""
echo "  Het VRM Portal ID vind je via:"
echo "  • VRM portaal: https://vrm.victronenergy.com → klik op installatie → Settings"
echo "  • Of op het GX-scherm: Instellingen → VRM Online portaal → VRM Portal ID"
echo ""
read -p "  Voer VRM_PORTAL_ID in (bijv. a1b2c3d4e5f6): " VRM_ID

if [ -z "$VRM_ID" ]; then
    warn "VRM_PORTAL_ID niet ingevoerd – stel dit later handmatig in via Node-RED"
fi

echo ""
read -p "  Voer ZAPTEC_USERNAME in (e-mailadres): " ZAPTEC_USER
read -s -p "  Voer ZAPTEC_PASSWORD in: " ZAPTEC_PASS
echo ""

# Schrijf omgevingsvariabelen
if [ -n "$VRM_ID" ] || [ -n "$ZAPTEC_USER" ]; then
    # Verwijder bestaande instellingen
    if [ -f "$NODERED_ENV" ]; then
        sed -i '/^VRM_PORTAL_ID=/d' "$NODERED_ENV"
        sed -i '/^ZAPTEC_USERNAME=/d' "$NODERED_ENV"
        sed -i '/^ZAPTEC_PASSWORD=/d' "$NODERED_ENV"
        sed -i '/^DBUS_INSTANCE_BASE=/d' "$NODERED_ENV"
    fi

    [ -n "$VRM_ID" ]     && echo "VRM_PORTAL_ID=$VRM_ID"          >> "$NODERED_ENV"
    [ -n "$ZAPTEC_USER" ] && echo "ZAPTEC_USERNAME=$ZAPTEC_USER"  >> "$NODERED_ENV"
    [ -n "$ZAPTEC_PASS" ] && echo "ZAPTEC_PASSWORD=$ZAPTEC_PASS"  >> "$NODERED_ENV"
    echo "DBUS_INSTANCE_BASE=40"                                   >> "$NODERED_ENV"

    info "Omgevingsvariabelen opgeslagen in $NODERED_ENV"
else
    warn "Geen variabelen opgegeven – stel deze in via Node-RED beheerinterface"
fi

# ── Node-RED flow importeren ───────────────────────────────────────
section "3. Node-RED flow importeren"
echo ""
info "Importeer de flow handmatig in Node-RED:"
echo ""
echo "  1. Open Node-RED: http://$(hostname -I | awk '{print $1}'):1880"
echo "  2. Hamburgermenu (≡) → Importeren"
echo "  3. Selecteer bestand: flows/zaptec-victron-bridge.json"
echo "  4. Klik 'Importeren' → 'Implementeren'"
echo ""

# Kopieer flow naar bekende locatie
FLOW_DEST="/root/zaptec-victron-bridge.json"
cp "$REPO_DIR/flows/zaptec-victron-bridge.json" "$FLOW_DEST"
info "Flow ook gekopieerd naar: $FLOW_DEST"

# ── Virtueel EV-apparaat aanmaken in Venus OS v3.80 ───────────────
section "4. Virtueel EV-apparaat aanmaken (Venus OS v3.80)"
echo ""
warn "BELANGRIJK: voer onderstaande stappen uit op het GX-display of via Remote Console"
echo ""
echo "  Navigeer naar:"
echo "  Instellingen → EV-laadstation → Voeg virtueel apparaat toe"
echo ""
echo "  Of via Remote Console (http://venus.local):"
echo "  Settings → EV Charging Station → Add virtual EV charger"
echo ""
echo "  Noteer het toegewezen instantienummer (bijv. 40, 41, 42...)"
echo "  Standaard gebruikt deze brug instantienummer 40 voor de eerste laadpaal."
echo ""
echo "  Als het GX een ander instantienummer toewijst, pas dan DBUS_INSTANCE_BASE"
echo "  aan in $NODERED_ENV en herstart Node-RED."
echo ""

# ── Node-RED herstarten ────────────────────────────────────────────
section "5. Node-RED herstarten"
if sv status nodered 2>/dev/null | grep -q "run:"; then
    read -p "  Node-RED herstarten om variabelen toe te passen? [J/n]: " RESTART
    if [ "$RESTART" != "n" ] && [ "$RESTART" != "N" ]; then
        sv restart nodered
        info "Node-RED herstart – wacht 10 seconden..."
        sleep 10
        info "Node-RED draait weer"
    fi
else
    warn "Node-RED service niet gevonden via runit – herstart handmatig"
fi

section "Installatie voltooid!"
echo ""
echo "  Controleer de meetwaarden:"
echo "  • Node-RED debug panel: http://$(hostname -I | awk '{print $1}'):1880"
echo "  • Victron VRM: https://vrm.victronenergy.com"
echo "  • GX-display: Apparaten → EV-laadstation"
echo ""
echo "  MQTT berichten controleren:"
echo "  mosquitto_sub -v -t 'W/${VRM_ID}/evcharger/#'"
echo ""
