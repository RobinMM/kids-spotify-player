# Raspberry Pi Deployment - Copy/Paste Commando's

SSH naar Pi: `ssh robin@<IP_ADRES>`

---

## Stap 1: Git en dependencies installeren

```bash
sudo apt update && sudo apt install -y git python3-pip python3-venv curl librespot
```

## Stap 2: Librespot (Spotify Connect) user service instellen

**BELANGRIJK:** Gebruik de librespot user service, NIET raspotify (system service).

```bash
# User service directory aanmaken
mkdir -p ~/.config/systemd/user

# Service bestand aanmaken
cat > ~/.config/systemd/user/librespot.service << 'EOF'
[Unit]
Description=Librespot (Spotify Connect)
After=network.target sound.target

[Service]
ExecStart=/usr/bin/librespot --name "Raspberry Alpha" --bitrate 320 --backend pulseaudio --device-type speaker --cache /home/%u/.cache/librespot
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF

# Service activeren en starten
systemctl --user daemon-reload
systemctl --user enable librespot
systemctl --user start librespot
```

**Pas `--name "Raspberry Alpha"` aan naar de gewenste naam.**

### Raspotify uitschakelen (indien eerder geïnstalleerd)

```bash
sudo systemctl stop raspotify 2>/dev/null
sudo systemctl disable raspotify 2>/dev/null
```

### Waarom user service?

- Slaat credentials op in `~/.cache/librespot/credentials.json`
- Nodig voor ZeroConf activatie protocol
- Draait onder user context (toegang tot PulseAudio)

## Stap 3: GitHub Personal Access Token aanmaken

1. Ga naar: https://github.com/settings/tokens
2. Klik **"Generate new token (classic)"**
3. Naam: bijv. "Raspberry Pi"
4. Selecteer scope: **`repo`**
5. Klik **"Generate token"** en kopieer de token

## Stap 4: Repository clonen

```bash
git clone https://<JOUW_TOKEN>@github.com/robin-eurostocks/kids-spotify-player.git ~/spotify
```

## Stap 5: Python environment opzetten

```bash
cd ~/spotify && python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt
```

## Stap 6: .env bestand aanmaken

```bash
nano ~/spotify/.env
```

Plak dit (pas de waardes aan):
```
SPOTIFY_CLIENT_ID=jouw_client_id
SPOTIFY_CLIENT_SECRET=jouw_client_secret
SPOTIFY_REDIRECT_URI=http://127.0.0.1:5000/callback
SPOTIFY_DEVICE_NAME=
FLASK_SECRET_KEY=genereer_met_python_secrets_token_hex_32
```

Opslaan: `Ctrl+O`, `Enter`, `Ctrl+X`

**Secret key genereren:**
```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
```

## Stap 7: App testen

```bash
cd ~/spotify && source venv/bin/activate && python app.py
```

Open op de Pi zelf in de browser: `http://127.0.0.1:5000`

Log in met je Spotify account (eerste keer moet op de Pi zelf vanwege 127.0.0.1 callback).

## Stap 8: Spotify Player user service instellen

```bash
cat > ~/.config/systemd/user/spotify-player.service << 'EOF'
[Unit]
Description=Kids Spotify Player
After=network.target librespot.service

[Service]
WorkingDirectory=/home/%u/spotify
Environment=PATH=/home/%u/spotify/venv/bin
ExecStart=/home/%u/spotify/venv/bin/python app.py
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable spotify-player
systemctl --user start spotify-player
```

### User services laten draaien na logout

```bash
# Zorgt dat user services blijven draaien zonder actieve login
loginctl enable-linger $USER
```

## Stap 9: Kiosk mode (optioneel)

Browser in fullscreen kiosk mode starten:
```bash
chromium --kiosk http://127.0.0.1:5000
```

**Auto-start kiosk bij boot:**
```bash
mkdir -p ~/.config/autostart
cat > ~/.config/autostart/kiosk.desktop << 'EOF'
[Desktop Entry]
Type=Application
Name=Spotify Kiosk
Exec=chromium --kiosk --noerrdialogs --disable-infobars http://127.0.0.1:5000
X-GNOME-Autostart-enabled=true
EOF
```

---

## Handige commando's

```bash
# Librespot status/logs
systemctl --user status librespot
journalctl --user -u librespot -f

# Spotify Player status/logs
systemctl --user status spotify-player
journalctl --user -u spotify-player -f

# Services herstarten
systemctl --user restart librespot
systemctl --user restart spotify-player

# Na git pull: update en herstart
cd ~/spotify && git pull && source venv/bin/activate && pip install -r requirements.txt && systemctl --user restart spotify-player

# Kiosk afsluiten
Alt+F4 of Ctrl+W
```

## Deploy commando (snelle update)

```bash
cd ~/spotify && git pull origin main && pip install -r requirements.txt --break-system-packages && systemctl --user restart spotify-player
```

## Troubleshooting

**"Address already in use" bij librespot:**
```bash
# Controleer of raspotify nog draait
sudo systemctl status raspotify
# Zo ja, uitschakelen:
sudo systemctl stop raspotify && sudo systemctl disable raspotify
```

**Librespot credentials controleren:**
```bash
cat ~/.cache/librespot/credentials.json
# Moet username en auth_data bevatten na eerste Spotify Connect verbinding
```

**"pactl not found" error:**
```bash
sudo apt install pulseaudio pulseaudio-utils
```

**User services starten niet na reboot:**
```bash
loginctl enable-linger $USER
```
