# Kids Spotify Player

A kid-friendly Spotify player built with Flask and JavaScript. Designed for use on a Raspberry Pi with touchscreen.

> **Note**: This is a personal hobby project. Use at your own risk.
> I cannot provide support for installation or configuration issues.

## Features

- Spotify OAuth authentication
- Browse playlists and followed artists
- Playback controls (play, pause, next, previous, shuffle)
- Album art and track info display
- Dark/Light theme with customizable colors
- Spotify device selection with live status
- Local Spotify Connect devices via mDNS discovery (librespot/Raspotify)
- Audio output device selection
- Bluetooth device pairing and connection
- Kid-friendly interface with large buttons
- Device security (only allowed devices can control playback)
- In-app updates from GitHub releases

## Requirements

- Python 3.7+
- Spotify Premium account
- Spotify Developer credentials

## Setup

### 1. Spotify Developer Account

1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Create a new app
3. Note your **Client ID** and **Client Secret**
4. Add `http://127.0.0.1:5000/callback` to Redirect URIs

### 2. Installation

```bash
# Install dependencies
pip install -r requirements.txt

# Copy config template
cp .env.example .env
```

### 3. Configuration

Fill in `.env` with your credentials:

```env
SPOTIFY_CLIENT_ID=your_client_id
SPOTIFY_CLIENT_SECRET=your_client_secret
SPOTIFY_REDIRECT_URI=http://127.0.0.1:5000/callback
FLASK_SECRET_KEY=random_string

# Device security (optional, comma-separated for multiple)
# Empty = all devices allowed
SPOTIFY_DEVICE_NAME=DESKTOP-PC,RaspberryPi
```

### 4. Start

```bash
python app.py
```

Open: **http://localhost:5000**

## Usage

### Interface

The interface has 3 panels:
- **Left**: Playlists / Artists (toggle)
- **Middle**: Tracks from selected playlist
- **Right**: Now playing + controls

### Settings

Click the settings button (three dots) for:
- **Theme**: Colors and dark/light mode
- **Devices**: Spotify and audio output selection
- **Bluetooth**: Pair and connect Bluetooth speakers
- **Other**: Update app, refresh playlists, logout, shutdown

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Credentials not found" | Check `.env` file |
| "No active device" | Open Spotify app and start playing music |
| "Control not allowed" | Add device to `SPOTIFY_DEVICE_NAME` in `.env` |
| Playback not working | Spotify Premium required |

## Disclaimer

This software is provided "as is", without warranty of any kind, express or implied. This is a hobby project - no support is provided for installation, configuration, or usage issues.

## License

Personal project for educational purposes.
