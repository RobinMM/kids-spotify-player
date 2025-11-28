# Kids Spotify Player

Een kindvriendelijke Spotify-speler gebouwd met Flask en JavaScript. Ontworpen voor gebruik op een Raspberry Pi met touchscreen.

## Features

- Spotify OAuth authenticatie
- Playlists en gevolgde artiesten bekijken
- Playback controls (play, pause, next, previous, shuffle)
- Album art en track info weergave
- Dark/Light theme met aanpasbare kleuren
- Spotify apparaat selectie met live status
- Lokale Spotify Connect devices via mDNS discovery (librespot/Raspotify)
- Audio output device selectie
- Bluetooth device pairing en connectie
- Kindvriendelijke interface met grote knoppen
- Apparaat beveiliging (alleen toegestane devices kunnen bedienen)

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

# Apparaat beveiliging (optioneel, comma-separated voor meerdere)
# Leeg = alle apparaten toegestaan
SPOTIFY_DEVICE_NAME=DESKTOP-16R31VC,RaspberryPi
```

### 4. Starten

```bash
python app.py
```

Open: **http://localhost:5000**

## Gebruik

### Interface

De interface heeft 3 panelen:
- **Links**: Playlists / Artiesten (toggle)
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
| "Bediening niet toegestaan" | Voeg device toe aan `SPOTIFY_DEVICE_NAME` in `.env` |
| Playback werkt niet | Spotify Premium vereist |

## Licentie

Persoonlijk project voor educatieve doeleinden.
