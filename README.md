# Kids Spotify Player

Een kindvriendelijke Spotify-speler gebouwd met Flask en JavaScript. Ontworpen voor gebruik op een Raspberry Pi met touchscreen, maar ook bruikbaar op Windows/Linux voor ontwikkeling.

## Features

- Spotify OAuth authenticatie
- Playlists bekijken en nummers afspelen
- Playback controls (play, pause, next, previous, shuffle)
- Album art en track info weergave
- Dark/Light theme met aanpasbare kleuren
- Spotify apparaat selectie met live status
- Audio output device selectie (Windows/Linux)
- Kindvriendelijke interface met grote knoppen

## Vereisten

- Python 3.7+
- Spotify Premium account
- Spotify Developer credentials

## Setup

### 1. Spotify Developer Account

1. Ga naar [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Maak een nieuwe app aan
3. Noteer je **Client ID** en **Client Secret**
4. Voeg `http://127.0.0.1:5000/callback` toe aan Redirect URIs

### 2. Installatie

```bash
# Installeer dependencies
pip install -r requirements.txt

# Kopieer config template
copy .env.example .env
```

### 3. Configuratie

Vul `.env` in met je credentials:

```env
SPOTIFY_CLIENT_ID=jouw_client_id
SPOTIFY_CLIENT_SECRET=jouw_client_secret
SPOTIFY_REDIRECT_URI=http://127.0.0.1:5000/callback
FLASK_SECRET_KEY=random_string
SPOTIFY_DEVICE_NAME=  # Optioneel: filter op apparaatnaam
```

### 4. Windows Audio Device Switching (Optioneel)

```powershell
# PowerShell als Administrator
Install-Module -Name AudioDeviceCmdlets -Force -Scope CurrentUser
```

### 5. Starten

```bash
python app.py
```

Open: **http://localhost:5000**

## Gebruik

### Interface

De interface heeft 3 panelen:
- **Links**: Playlists
- **Midden**: Nummers van geselecteerde playlist
- **Rechts**: Now playing + controls

### Instellingen

Klik op de instellingenknop (drie puntjes) voor:
- **Thema**: Kleuren en dark/light mode
- **Apparaten**: Spotify en audio output selectie
- **Overig**: Playlists/devices verversen, uitloggen

## Troubleshooting

| Probleem | Oplossing |
|----------|-----------|
| "Credentials not found" | Controleer `.env` bestand |
| "No active device" | Open Spotify app en start muziek |
| Playback werkt niet | Spotify Premium vereist |
| Audio switch werkt niet (Windows) | Installeer AudioDeviceCmdlets module |

## Licentie

Persoonlijk project voor educatieve doeleinden.
