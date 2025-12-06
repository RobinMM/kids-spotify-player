#!/bin/bash
#
# Kids Spotify Player - Raspberry Pi Installer
# https://github.com/RobinMM/kids-spotify-player
#
# Usage: curl -sSL https://raw.githubusercontent.com/RobinMM/kids-spotify-player/main/install.sh | bash
#

set -euo pipefail
IFS=$'\n\t'

# Check for interactive shell
if [[ ! -t 0 ]]; then
    echo "Dit installatie-script vereist een interactieve shell (stdin is geen tty)." >&2
    exit 1
fi

# ==============================================================================
# Configuration
# ==============================================================================

VERSION="1.0.0"
REPO_URL="https://github.com/RobinMM/kids-spotify-player.git"
INSTALL_DIR="$HOME/spotify"
CONFIG_DIR="$HOME/.config/spotify-player"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# Global variables
OS_VARIANT=""
TOUCH_DISPLAY=""
DISPLAY_ROTATION=""
SPOTIFY_CLIENT_ID=""
SPOTIFY_CLIENT_SECRET=""
DEVICE_NAME=""
SETTINGS_PIN=""
INSTALL_MODE="fresh"
CHROMIUM_CMD=""

# ==============================================================================
# Helper Functions
# ==============================================================================

print_header() {
    if [[ -t 1 ]]; then clear; fi
    echo -e "${BLUE}"
    echo "╔═══════════════════════════════════════════════════════════════╗"
    echo "║                                                               ║"
    echo "║          Kids Spotify Player Installer v${VERSION}              ║"
    echo "║                                                               ║"
    echo "╚═══════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
    echo ""
}

print_step() {
    echo -e "${BLUE}[$1/$2]${NC} ${BOLD}$3${NC}"
}

print_success() {
    echo -e "  ${GREEN}✓${NC} $1"
}

print_warning() {
    echo -e "  ${YELLOW}!${NC} $1"
}

print_error() {
    echo -e "  ${RED}✗${NC} $1"
}

print_info() {
    echo -e "  ${CYAN}→${NC} $1"
}

# Check if a command exists
require_cmd() {
    local cmd="$1"
    if ! command -v "$cmd" >/dev/null 2>&1; then
        print_error "Vereiste command niet gevonden: $cmd"
        echo "    Installeer het ontbrekende pakket en probeer opnieuw."
        exit 1
    fi
}

# Check if systemd user services are available
check_systemd_user() {
    if ! systemctl --user show-environment >/dev/null 2>&1; then
        print_error "Systemd user services zijn niet beschikbaar."
        echo "    Zorg dat je als normale gebruiker bent ingelogd (geen sudo su)"
        echo "    en dat systemd user sessions ondersteund worden."
        exit 1
    fi
}

# Detect chromium binary
detect_chromium() {
    if command -v chromium-browser >/dev/null 2>&1; then
        CHROMIUM_CMD="chromium-browser"
    elif command -v chromium >/dev/null 2>&1; then
        CHROMIUM_CMD="chromium"
    else
        print_error "Chromium niet gevonden (chromium-browser / chromium)."
        echo "    Installeer Chromium en voer het script opnieuw uit."
        exit 1
    fi
}

# Error handler
error_handler() {
    local line_no=$1
    local error_code=$2
    echo ""
    echo -e "${RED}"
    echo "╔═══════════════════════════════════════════════════════════════╗"
    echo "║                     INSTALLATION FAILED                       ║"
    echo "╚═══════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
    echo ""
    echo "Error at line $line_no (exit code: $error_code)"
    echo ""
    echo "Common solutions:"
    echo "  1. Ensure you have a stable internet connection"
    echo "  2. Run: sudo apt update && sudo apt upgrade"
    echo "  3. Check your Spotify API credentials"
    echo ""
    echo "For help: https://github.com/RobinMM/kids-spotify-player/issues"
    exit 1
}

trap 'error_handler ${LINENO} $?' ERR

# ==============================================================================
# Pre-flight Checks
# ==============================================================================

detect_os_variant() {
    # Check for desktop environment packages
    if dpkg -l 2>/dev/null | grep -qE "ii\s+(lxde|lxqt|xfce4|gnome-shell|kde-plasma|wayfire)"; then
        OS_VARIANT="desktop"
    elif [[ -d /etc/xdg/lxsession ]] || [[ -f /usr/bin/startlxde-pi ]]; then
        OS_VARIANT="desktop"
    elif [[ -f /usr/bin/wayfire ]]; then
        OS_VARIANT="desktop"
    elif systemctl is-active --quiet lightdm 2>/dev/null && [[ -d /usr/share/wayland-sessions || -d /usr/share/xsessions ]]; then
        OS_VARIANT="desktop"
    else
        OS_VARIANT="lite"
    fi
}

detect_touch_display() {
    # Check for DSI display (Touch Display 2)
    if ls /sys/class/drm/*/status 2>/dev/null | xargs grep -l "connected" 2>/dev/null | grep -qi "DSI"; then
        TOUCH_DISPLAY="dsi"
    else
        TOUCH_DISPLAY="none"
    fi
}

preflight_checks() {
    echo -e "${BOLD}Pre-flight checks...${NC}"
    echo ""

    # Check for Debian-based OS (apt required)
    if ! command -v apt >/dev/null 2>&1; then
        print_error "Dit script is gemaakt voor Debian/Raspberry Pi OS (apt vereist)."
        echo "    Andere distributies worden niet ondersteund."
        exit 1
    fi
    print_success "Debian-based OS detected"

    # Install git and curl if missing (essential for this script)
    if ! command -v git >/dev/null 2>&1 || ! command -v curl >/dev/null 2>&1; then
        print_info "Installing essential packages (git, curl)..."
        sudo apt update -qq
        sudo apt install -y -qq git curl
    fi

    # Check required commands
    for cmd in sudo git curl python3 systemctl; do
        require_cmd "$cmd"
    done
    print_success "Required commands available"

    # Check systemd user services
    check_systemd_user
    print_success "Systemd user services available"

    # Check if running on Raspberry Pi
    if [[ -f /proc/device-tree/model ]]; then
        local model
        model=$(cat /proc/device-tree/model 2>/dev/null | tr -d '\0')
        if echo "$model" | grep -qi "raspberry"; then
            print_success "Raspberry Pi detected: $model"
        else
            print_warning "Not a Raspberry Pi: $model"
            read -p "    Continue anyway? [y/N]: " continue_anyway
            if [[ ! "${continue_anyway:-}" =~ ^[Yy]$ ]]; then
                exit 1
            fi
        fi
    else
        print_warning "Could not detect hardware model"
        read -p "    Continue anyway? [y/N]: " continue_anyway
        if [[ ! "${continue_anyway:-}" =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi

    # Detect OS variant
    detect_os_variant
    if [[ "$OS_VARIANT" == "desktop" ]]; then
        print_success "OS variant: Raspberry Pi OS Desktop (GUI present)"
    else
        print_success "OS variant: Raspberry Pi OS Lite (no GUI)"
        print_info "Will install X11 + Openbox + Chromium for kiosk mode"
    fi

    # Detect Touch Display 2
    detect_touch_display
    if [[ "$TOUCH_DISPLAY" == "dsi" ]]; then
        print_success "Touch Display 2 (DSI) detected"
    fi

    # Check internet connectivity (HTTP instead of ICMP)
    if curl -s --head --max-time 10 https://github.com >/dev/null 2>&1; then
        print_success "Internet connection OK"
    else
        print_error "Geen internetverbinding (HTTP naar github.com lukt niet)"
        echo "    Controleer je netwerk en probeer opnieuw."
        exit 1
    fi

    # Check sudo access
    if sudo -n true 2>/dev/null; then
        print_success "Sudo access OK"
    else
        print_info "Sudo password may be required"
        if ! sudo true; then
            print_error "Sudo access required"
            exit 1
        fi
        print_success "Sudo access OK"
    fi

    # Check disk space
    local available_mb
    available_mb=$(df -m "$HOME" | awk 'NR==2 {print $4}')
    local required_mb=200
    if [[ "$OS_VARIANT" == "lite" ]]; then
        required_mb=500
    fi

    if [[ $available_mb -lt $required_mb ]]; then
        print_error "Insufficient disk space: ${available_mb}MB available, ${required_mb}MB required"
        exit 1
    fi
    print_success "Disk space OK (${available_mb}MB available)"

    echo ""
}

check_existing_installation() {
    if [[ -d "$INSTALL_DIR" ]]; then
        echo -e "${YELLOW}Existing installation detected at $INSTALL_DIR${NC}"
        echo ""
        echo "Options:"
        echo "  1) Update - Keep settings, update application"
        echo "  2) Reinstall - Fresh install (backup settings)"
        echo "  3) Cancel"
        echo ""
        read -p "Choose option [1-3]: " install_option

        case $install_option in
            1)
                INSTALL_MODE="update"
                print_info "Will update existing installation"
                ;;
            2)
                INSTALL_MODE="reinstall"
                if [[ -f "$INSTALL_DIR/.env" ]]; then
                    cp "$INSTALL_DIR/.env" "/tmp/spotify-env-backup-$(date +%s)"
                    print_info "Settings backed up to /tmp/"
                fi
                ;;
            3)
                echo "Installation cancelled."
                exit 0
                ;;
            *)
                echo "Invalid option. Exiting."
                exit 1
                ;;
        esac
        echo ""
    fi
}

# ==============================================================================
# Spotify Developer Instructions
# ==============================================================================

show_spotify_instructions() {
    echo -e "${BLUE}"
    echo "════════════════════════════════════════════════════════════════"
    echo "                  SPOTIFY DEVELOPER APP SETUP"
    echo "════════════════════════════════════════════════════════════════"
    echo -e "${NC}"
    echo ""
    echo "Before continuing, create a Spotify Developer App:"
    echo ""
    echo -e "  1. Go to: ${CYAN}https://developer.spotify.com/dashboard${NC}"
    echo ""
    echo "  2. Log in with your Spotify account"
    echo ""
    echo -e "  3. Click '${BOLD}Create App${NC}'"
    echo "     - App name: Kids Spotify Player"
    echo "     - App description: Touchscreen music player"
    echo -e "     - Redirect URI: ${GREEN}http://127.0.0.1:5000/callback${NC}"
    echo ""
    echo "  4. In your app settings, copy:"
    echo -e "     - ${BOLD}Client ID${NC} (32 characters)"
    echo -e "     - ${BOLD}Client Secret${NC} (click 'View client secret')"
    echo ""
    echo -e "${YELLOW}IMPORTANT: The Redirect URI must be exactly:${NC}"
    echo -e "           ${GREEN}http://127.0.0.1:5000/callback${NC}"
    echo ""
    read -p "Press ENTER when you have your credentials ready..."
    echo ""
}

# ==============================================================================
# Credential Collection
# ==============================================================================

validate_client_id() {
    local id="$1"
    # Spotify Client IDs are 32 hex characters
    if [[ "$id" =~ ^[a-f0-9]{32}$ ]]; then
        return 0
    fi
    return 1
}

validate_secret() {
    local secret="$1"
    # Client Secret: minimaal 20 karakters (flexibeler voor toekomstige wijzigingen)
    if [[ "${#secret}" -ge 20 ]]; then
        return 0
    fi
    return 1
}

validate_pin() {
    local pin="$1"
    if [[ "$pin" =~ ^[0-9]{6}$ ]]; then
        return 0
    fi
    return 1
}

collect_credentials() {
    echo -e "${BOLD}Enter your Spotify API credentials:${NC}"
    echo ""

    # Client ID
    while true; do
        read -p "  Spotify Client ID: " SPOTIFY_CLIENT_ID
        if validate_client_id "$SPOTIFY_CLIENT_ID"; then
            print_success "Client ID accepted"
            break
        else
            print_error "Invalid Client ID (must be 32 hex characters)"
        fi
    done

    # Client Secret (hidden input)
    while true; do
        read -sp "  Spotify Client Secret: " SPOTIFY_CLIENT_SECRET
        echo ""
        if validate_secret "$SPOTIFY_CLIENT_SECRET"; then
            print_success "Client Secret accepted"
            break
        else
            print_error "Invalid Client Secret (te kort, minimaal 20 karakters)"
        fi
    done

    # Device Name
    local default_name=$(hostname)
    read -p "  Spotify Device Name [$default_name]: " DEVICE_NAME
    DEVICE_NAME="${DEVICE_NAME:-$default_name}"
    print_success "Device name: $DEVICE_NAME"

    # Settings PIN
    while true; do
        read -p "  Settings PIN (6 digits) [123456]: " SETTINGS_PIN
        SETTINGS_PIN="${SETTINGS_PIN:-123456}"
        if validate_pin "$SETTINGS_PIN"; then
            print_success "PIN accepted"
            break
        else
            print_error "PIN must be exactly 6 digits"
        fi
    done

    echo ""
}

collect_display_settings() {
    # Only ask about rotation if DSI display detected on Lite
    if [[ "$TOUCH_DISPLAY" != "dsi" ]] || [[ "$OS_VARIANT" != "lite" ]]; then
        return
    fi

    echo -e "${BOLD}Touch Display 2 detected${NC}"
    echo ""
    echo "Choose screen rotation:"
    echo "  1) 0° - Portrait (native)"
    echo "  2) 90° - Landscape (USB ports up)"
    echo "  3) 180° - Portrait inverted"
    echo "  4) 270° - Landscape (USB ports down)"
    echo ""
    read -p "Choose option [1-4, default 4]: " rotation_option

    case "${rotation_option:-4}" in
        1) DISPLAY_ROTATION="0" ;;
        2) DISPLAY_ROTATION="90" ;;
        3) DISPLAY_ROTATION="180" ;;
        4|*) DISPLAY_ROTATION="270" ;;
    esac
    print_success "Display rotation: ${DISPLAY_ROTATION}°"
    echo ""
}

# ==============================================================================
# Package Installation
# ==============================================================================

install_packages() {
    local step=$1
    local total=$2
    print_step "$step" "$total" "Installing system packages..."

    # Update package list
    print_info "Updating package list..."
    if ! sudo apt update -qq; then
        print_error "apt update faalde. Controleer je apt-sources en netwerk."
        exit 1
    fi

    # Core packages
    print_info "Installing core packages..."
    if ! sudo apt install -y -qq git python3-pip python3-venv curl; then
        print_error "Installatie van core packages faalde."
        exit 1
    fi
    print_success "Core packages installed"

    # Librespot (via raspotify)
    print_info "Installing librespot (Spotify Connect)..."
    if ! command -v librespot >/dev/null 2>&1; then
        if ! curl -sL https://dtcooper.github.io/raspotify/install.sh | sh; then
            print_error "Installatie van raspotify/librespot faalde."
            exit 1
        fi
    fi
    print_success "Librespot installed (via raspotify)"

    # Audio packages
    print_info "Installing audio packages..."
    if ! sudo apt install -y -qq pipewire pipewire-pulse wireplumber libspa-0.2-bluetooth pulseaudio-utils 2>/dev/null; then
        # Fallback to PulseAudio if PipeWire not available
        print_warning "PipeWire not available, using PulseAudio"
        if ! sudo apt install -y -qq pulseaudio pulseaudio-utils pulseaudio-module-bluetooth; then
            print_error "Installatie van audio packages faalde."
            exit 1
        fi
    fi
    print_success "Audio packages installed"

    # Bluetooth packages
    print_info "Installing Bluetooth packages..."
    if ! sudo apt install -y -qq bluetooth bluez bluez-tools; then
        print_error "Installatie van Bluetooth packages faalde."
        exit 1
    fi
    print_success "Bluetooth packages installed"

    # Kiosk packages (only for Lite)
    if [[ "$OS_VARIANT" == "lite" ]]; then
        print_info "Installing GUI packages for kiosk mode..."
        if ! sudo apt install -y -qq xserver-xorg-core xserver-xorg-input-all xinit openbox chromium lightdm; then
            print_error "Installatie van GUI packages faalde."
            exit 1
        fi
        print_success "GUI packages installed"
    fi

    # Detect chromium binary after installation
    detect_chromium
    print_success "Chromium detected: $CHROMIUM_CMD"

    echo ""
}

# ==============================================================================
# Audio Setup
# ==============================================================================

setup_audio() {
    local step=$1
    local total=$2
    print_step "$step" "$total" "Configuring audio system..."

    # Disable raspotify if installed (conflicts with librespot user service)
    if systemctl is-active --quiet raspotify 2>/dev/null; then
        print_info "Disabling raspotify (using librespot user service instead)..."
        sudo systemctl stop raspotify
        sudo systemctl disable raspotify
        print_success "Raspotify disabled"
    fi

    # Enable user lingering (required for user services)
    loginctl enable-linger "$USER" 2>/dev/null || true

    # Check if PipeWire is available and configure
    if systemctl --user is-active --quiet pipewire.service 2>/dev/null || \
       systemctl --user list-unit-files pipewire.service 2>/dev/null | grep -q pipewire; then
        print_info "Configuring PipeWire..."
        systemctl --user enable pipewire.socket pipewire-pulse.socket 2>/dev/null || true
        systemctl --user start pipewire.socket pipewire-pulse.socket 2>/dev/null || true
        print_success "PipeWire configured"
    else
        print_info "Using PulseAudio..."
        systemctl --user enable pulseaudio.service 2>/dev/null || true
        systemctl --user start pulseaudio.service 2>/dev/null || true
        print_success "PulseAudio configured"
    fi

    echo ""
}

# ==============================================================================
# Display Rotation Setup
# ==============================================================================

setup_display_rotation() {
    local step=$1
    local total=$2
    print_step "$step" "$total" "Configuring display rotation..."

    # Skip if no DSI display, no rotation needed, or portrait mode
    if [[ "$TOUCH_DISPLAY" != "dsi" ]] || [[ -z "$DISPLAY_ROTATION" ]] || [[ "$DISPLAY_ROTATION" == "0" ]]; then
        print_info "No rotation needed, skipping"
        echo ""
        return
    fi

    # Backup and modify config.txt
    print_info "Configuring boot parameters..."
    sudo cp /boot/firmware/config.txt /boot/firmware/config.txt.backup

    if ! grep -q "vc4-kms-dsi-ili9881-7inch" /boot/firmware/config.txt; then
        echo "dtoverlay=vc4-kms-dsi-ili9881-7inch,rotation=${DISPLAY_ROTATION}" | sudo tee -a /boot/firmware/config.txt > /dev/null
    else
        sudo sed -i "s/vc4-kms-dsi-ili9881-7inch.*/vc4-kms-dsi-ili9881-7inch,rotation=${DISPLAY_ROTATION}/" /boot/firmware/config.txt
    fi
    print_success "config.txt updated"

    # Modify cmdline.txt
    sudo cp /boot/firmware/cmdline.txt /boot/firmware/cmdline.txt.backup
    if ! grep -q "video=DSI-1" /boot/firmware/cmdline.txt; then
        sudo sed -i "s/$/ video=DSI-1:720x1280@60,rotate=${DISPLAY_ROTATION}/" /boot/firmware/cmdline.txt
    fi
    print_success "cmdline.txt updated"

    print_success "Display rotation configured (${DISPLAY_ROTATION}°)"
    echo ""
}

# ==============================================================================
# Application Installation
# ==============================================================================

install_application() {
    local step=$1
    local total=$2
    print_step "$step" "$total" "Installing Kids Spotify Player..."

    if [[ "$INSTALL_MODE" == "update" ]]; then
        print_info "Updating existing installation..."
        cd "$INSTALL_DIR"
        git pull origin main
        source venv/bin/activate
        pip install -q -r requirements.txt
        print_success "Application updated"
    else
        if [[ "$INSTALL_MODE" == "reinstall" ]]; then
            print_info "Removing old installation..."
            rm -rf "$INSTALL_DIR"
        fi

        print_info "Cloning repository..."
        git clone -q "$REPO_URL" "$INSTALL_DIR"
        print_success "Repository cloned"

        print_info "Creating Python virtual environment..."
        cd "$INSTALL_DIR"
        python3 -m venv venv
        print_success "Virtual environment created"

        print_info "Installing Python dependencies..."
        source venv/bin/activate
        pip install -q --upgrade pip
        pip install -q -r requirements.txt
        print_success "Dependencies installed"
    fi

    echo ""
}

# ==============================================================================
# Configuration Files
# ==============================================================================

create_env_file() {
    local step=$1
    local total=$2
    print_step "$step" "$total" "Creating configuration files..."

    # Skip if updating and .env exists
    if [[ "$INSTALL_MODE" == "update" ]] && [[ -f "$INSTALL_DIR/.env" ]]; then
        print_info "Keeping existing .env file"
        echo ""
        return
    fi

    # Generate Flask secret key
    local flask_secret=$(python3 -c "import secrets; print(secrets.token_hex(32))")

    # Create .env file
    cat > "$INSTALL_DIR/.env" << EOF
# Spotify API Credentials
SPOTIFY_CLIENT_ID=${SPOTIFY_CLIENT_ID}
SPOTIFY_CLIENT_SECRET=${SPOTIFY_CLIENT_SECRET}
SPOTIFY_REDIRECT_URI=http://127.0.0.1:5000/callback

# Flask Configuration
FLASK_SECRET_KEY=${flask_secret}

# Device Filter
SPOTIFY_DEVICE_NAME=${DEVICE_NAME}

# Settings PIN (6 digits)
SETTINGS_PIN=${SETTINGS_PIN}
EOF

    # Secure the file
    chmod 600 "$INSTALL_DIR/.env"
    print_success ".env file created"

    # Create config directory
    mkdir -p "$CONFIG_DIR"
    print_success "Config directory created"

    echo ""
}

# ==============================================================================
# Systemd Services
# ==============================================================================

setup_services() {
    local step=$1
    local total=$2
    print_step "$step" "$total" "Setting up systemd services..."

    # Create systemd user directory
    mkdir -p "$HOME/.config/systemd/user"

    local user_uid
    user_uid=$(id -u)

    # Check XDG_RUNTIME_DIR
    local xdg_dir="/run/user/${user_uid}"
    if [[ ! -d "$xdg_dir" ]]; then
        print_warning "XDG_RUNTIME_DIR ${xdg_dir} bestaat nog niet."
        echo "    Dit wordt normaal door systemd aangemaakt na login."
        echo "    Als services niet werken, log even uit/in en probeer opnieuw."
    fi

    # Create librespot service
    print_info "Creating librespot service..."
    cat > "$HOME/.config/systemd/user/librespot.service" << EOF
[Unit]
Description=Librespot (Spotify Connect)
After=pipewire.service pipewire-pulse.service
Wants=pipewire-pulse.service

[Service]
ExecStart=/usr/bin/librespot --name "${DEVICE_NAME}" --bitrate 320 --backend pulseaudio --device-type speaker --cache %h/.cache/librespot --initial-volume 100
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
EOF
    print_success "Librespot service created"

    # Create spotify-player service
    print_info "Creating spotify-player service..."
    cat > "$HOME/.config/systemd/user/spotify-player.service" << EOF
[Unit]
Description=Kids Spotify Player
After=network.target pipewire.service librespot.service
Wants=pipewire.service

[Service]
WorkingDirectory=${INSTALL_DIR}
Environment=PATH=${INSTALL_DIR}/venv/bin:/usr/bin:/bin
Environment=XDG_RUNTIME_DIR=/run/user/${user_uid}
ExecStartPre=/bin/sleep 2
ExecStart=${INSTALL_DIR}/venv/bin/python app.py
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
EOF
    print_success "Spotify-player service created"

    # Reload and enable services
    print_info "Enabling services..."
    if ! systemctl --user daemon-reload; then
        print_error "Kon systemd user daemon niet reloaden."
        echo "    Controleer of systemd user sessions beschikbaar zijn."
        exit 1
    fi

    if ! systemctl --user enable librespot.service spotify-player.service; then
        print_error "Kon services niet enablen."
        exit 1
    fi

    # Start services
    print_info "Starting services..."
    if ! systemctl --user start librespot.service; then
        print_warning "Librespot service kon niet starten (mogelijk al actief)"
    fi
    sleep 2
    if ! systemctl --user start spotify-player.service; then
        print_warning "Spotify-player service kon niet starten (mogelijk al actief)"
    fi

    print_success "Services configured"
    echo ""
}

# ==============================================================================
# Kiosk Mode Setup
# ==============================================================================

setup_kiosk() {
    local step=$1
    local total=$2
    print_step "$step" "$total" "Setting up kiosk mode..."

    if [[ "$OS_VARIANT" == "lite" ]]; then
        # Lite variant: configure LightDM autologin + Openbox
        print_info "Configuring LightDM autologin..."

        # Create LightDM config directory if needed
        sudo mkdir -p /etc/lightdm/lightdm.conf.d

        # Create autologin config
        sudo tee /etc/lightdm/lightdm.conf.d/50-autologin.conf > /dev/null << EOF
[Seat:*]
autologin-user=${USER}
autologin-session=openbox
EOF
        print_success "LightDM autologin configured"

        # Create Openbox autostart
        print_info "Creating Openbox autostart..."
        mkdir -p "$HOME/.config/openbox"

        # Build xrandr rotation command if needed (runs AFTER Chromium to prevent reset)
        local xrandr_cmd=""
        if [[ -n "$DISPLAY_ROTATION" ]] && [[ "$DISPLAY_ROTATION" != "0" ]]; then
            local xrandr_rotate=""
            case "$DISPLAY_ROTATION" in
                90) xrandr_rotate="right" ;;
                180) xrandr_rotate="inverted" ;;
                270) xrandr_rotate="left" ;;
            esac
            xrandr_cmd="
# Rotate display after Chromium starts (prevents reset)
sleep 2
xrandr --output DSI-1 --rotate ${xrandr_rotate} 2>/dev/null || true"
        fi

        cat > "$HOME/.config/openbox/autostart" << EOF
# Disable screen blanking
xset s off
xset s noblank
xset -dpms

# Start Chromium in kiosk mode
${CHROMIUM_CMD} --kiosk --noerrdialogs --disable-infobars --touch-events=enabled --enable-features=TouchpadOverscrollHistoryNavigation --disable-pinch --overscroll-history-navigation=0 file://${INSTALL_DIR}/static/loader.html &
${xrandr_cmd}
EOF
        print_success "Openbox autostart configured"

        # Enable LightDM and set graphical boot target
        sudo systemctl enable lightdm
        sudo systemctl set-default graphical.target

    else
        # Desktop variant: only add autostart entry
        print_info "Creating autostart entry..."
        mkdir -p "$HOME/.config/autostart"
        cat > "$HOME/.config/autostart/spotify-kiosk.desktop" << EOF
[Desktop Entry]
Type=Application
Name=Kids Spotify Player
Comment=Touchscreen Spotify player for kids
Exec=${CHROMIUM_CMD} --kiosk --noerrdialogs --disable-infobars --touch-events=enabled --enable-features=TouchpadOverscrollHistoryNavigation --disable-pinch --overscroll-history-navigation=0 file://${INSTALL_DIR}/static/loader.html
X-GNOME-Autostart-enabled=true
EOF
        print_success "Autostart entry created"
    fi

    echo ""
}

# ==============================================================================
# Verification
# ==============================================================================

verify_installation() {
    local step=$1
    local total=$2
    print_step "$step" "$total" "Verifying installation..."

    local errors=0

    # Check librespot service
    if systemctl --user is-active --quiet librespot.service; then
        print_success "Librespot service: Running"
    else
        print_error "Librespot service: Not running"
        ((errors++))
    fi

    # Check spotify-player service
    if systemctl --user is-active --quiet spotify-player.service; then
        print_success "Spotify Player service: Running"
    else
        print_error "Spotify Player service: Not running"
        ((errors++))
    fi

    # Check if app is responding
    sleep 3
    if curl -s http://127.0.0.1:5000/api/health 2>/dev/null | grep -q "ok"; then
        print_success "Web application: Responding"
    else
        print_warning "Web application: Starting up (may take a moment)"
    fi

    echo ""
    return $errors
}

# ==============================================================================
# Success Message
# ==============================================================================

print_final_message() {
    echo -e "${GREEN}"
    echo "╔═══════════════════════════════════════════════════════════════╗"
    echo "║                                                               ║"
    echo "║            INSTALLATION COMPLETED SUCCESSFULLY!               ║"
    echo "║                                                               ║"
    echo "╚═══════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
    echo ""
    echo -e "${BOLD}Next Steps:${NC}"
    echo ""
    echo "  1. Open a browser on this Raspberry Pi and visit:"
    echo -e "     ${CYAN}http://127.0.0.1:5000${NC}"
    echo ""
    echo "  2. Log in with your Spotify Premium account"
    echo -e "     ${YELLOW}(First login MUST be done on the Pi itself)${NC}"
    echo ""
    echo "  3. Activate Spotify Connect:"
    echo "     Open the Spotify app on your phone, select '${DEVICE_NAME}'"
    echo "     as playback device, and play something briefly."
    echo -e "     ${YELLOW}(One-time step to register the device)${NC}"
    echo ""
    echo "  4. Reboot to start in kiosk mode:"
    echo -e "     ${CYAN}sudo reboot${NC}"
    echo ""
    echo -e "${BOLD}Useful Commands:${NC}"
    echo ""
    echo "  View logs:      journalctl --user -u spotify-player -f"
    echo "  Restart app:    systemctl --user restart spotify-player"
    echo "  Exit kiosk:     Alt+F4 or Ctrl+W"
    echo ""
    echo -e "${BLUE}Enjoy your Kids Spotify Player!${NC}"
    echo ""
}

# ==============================================================================
# Main
# ==============================================================================

main() {
    print_header
    preflight_checks
    check_existing_installation

    # Only show Spotify instructions and collect credentials for fresh/reinstall
    if [[ "$INSTALL_MODE" != "update" ]]; then
        show_spotify_instructions
        collect_credentials
        collect_display_settings
    fi

    echo -e "${BOLD}Starting installation...${NC}"
    echo ""

    local total_steps=8
    local current_step=1

    install_packages $((current_step++)) $total_steps
    setup_audio $((current_step++)) $total_steps
    setup_display_rotation $((current_step++)) $total_steps
    install_application $((current_step++)) $total_steps

    if [[ "$INSTALL_MODE" != "update" ]]; then
        create_env_file $((current_step++)) $total_steps
    else
        ((current_step++))
    fi

    setup_services $((current_step++)) $total_steps
    setup_kiosk $((current_step++)) $total_steps
    verify_installation $((current_step++)) $total_steps

    print_final_message
}

# Run main
main "$@"
