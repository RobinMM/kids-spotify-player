# Raspberry Pi Deployment - Copy/Paste Commando's

SSH naar Pi: `ssh pi@<IP_ADRES>`

---

## Stap 1: Git en dependencies installeren

```bash
sudo apt update && sudo apt install -y git python3-pip python3-venv curl
```

## Stap 2: Raspotify (Spotify Connect) installeren

```bash
curl -sL https://dtcooper.github.io/raspotify/install.sh | sh
```

Configuratie aanpassen (optioneel):
```bash
sudo nano /etc/raspotify/conf
```

Belangrijke opties:
```
LIBRESPOT_NAME="Kids Speaker"
LIBRESPOT_BITRATE="320"
```

Herstarten na wijzigingen:
```bash
sudo systemctl restart raspotify
```

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
cd ~/spotify && python3 -m venv venv && source venv/bin/activate && pip install -r requirements-pi.txt
```

**Let op:** Gebruik `requirements-pi.txt` (niet `requirements.txt` - die bevat Windows-only packages)

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

## Stap 8: Auto-start service instellen

```bash
sudo tee /etc/systemd/system/spotify-player.service << 'EOF'
[Unit]
Description=Kids Spotify Player
After=network.target

[Service]
User=pi
WorkingDirectory=/home/pi/spotify
Environment=PATH=/home/pi/spotify/venv/bin
ExecStart=/home/pi/spotify/venv/bin/python app.py
Restart=always

[Install]
WantedBy=multi-user.target
EOF
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable spotify-player && sudo systemctl start spotify-player
```

## Stap 9: Kiosk mode (optioneel)

Browser in fullscreen kiosk mode starten:
```bash
chromium --kiosk http://127.0.0.1:5000
```

**Auto-start kiosk bij boot:**
```bash
mkdir -p ~/.config/autostart
nano ~/.config/autostart/kiosk.desktop
```

Plak dit:
```
[Desktop Entry]
Type=Application
Name=Spotify Kiosk
Exec=chromium --kiosk --noerrdialogs --disable-infobars http://127.0.0.1:5000
X-GNOME-Autostart-enabled=true
```

Opslaan: `Ctrl+O`, `Enter`, `Ctrl+X`

---

## Handige commando's

```bash
# Status bekijken
sudo systemctl status spotify-player

# Logs bekijken
sudo journalctl -u spotify-player -f

# Herstarten na update
cd ~/spotify && git pull && pip install -r requirements-pi.txt && sudo systemctl restart spotify-player

# Kiosk afsluiten
Alt+F4 of Ctrl+W
```

## App handmatig draaien (zonder service)

**Op voorgrond (blokkeert terminal):**
```bash
cd ~/spotify && source venv/bin/activate && python app.py
```
Stop met: `Ctrl+C`

**Op achtergrond (terminal blijft vrij):**
```bash
cd ~/spotify && source venv/bin/activate && nohup python app.py > app.log 2>&1 &
```

Logs bekijken:
```bash
tail -f ~/spotify/app.log
```

App stoppen:
```bash
pkill -f "python app.py"
```

## Troubleshooting

**"pactl not found" error:**
Niet kritiek - audio wordt door Raspotify beheerd. Optioneel installeren:
```bash
sudo apt install pulseaudio pulseaudio-utils
```

**pywin32/pycaw error bij pip install:**
Gebruik `requirements-pi.txt` in plaats van `requirements.txt`
