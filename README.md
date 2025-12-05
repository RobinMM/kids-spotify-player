# Kids Spotify Player

A kid-friendly Spotify player built with Flask and JavaScript. Designed for use on a Raspberry Pi with touchscreen.

> **🚧 Early Development**
>
> This project is still a work in progress and not fully stable yet. The installation script is fresh and needs more real-world testing.
>
> Found a bug? I'd love to hear about it! Please [open an issue](https://github.com/RobinMM/kids-spotify-player/issues) with clear steps to reproduce. I'm a dad of two with a full-time job, so my time is limited — but I'll do my best to look into it when I can. Thanks for your patience and interest in this project! 🙏

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

## Installation

### Prerequisites

1. **Raspberry Pi** with Raspberry Pi OS (Lite or Desktop)
2. **SSH enabled** and connected to your network
3. **Spotify Premium** account
4. **Spotify Developer App** - Create at [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard):
   - Click "Create App"
   - Set Redirect URI to: `http://127.0.0.1:5000/callback`
   - Note your **Client ID** and **Client Secret**

### One-Command Install

SSH into your Raspberry Pi and run:

```bash
curl -sSL https://raw.githubusercontent.com/RobinMM/kids-spotify-player/main/install.sh | bash
```

The installer will:
- Detect your OS (Lite or Desktop)
- Install all required packages
- Set up Spotify Connect (librespot)
- Configure kiosk mode for touchscreen
- Guide you through Spotify credentials setup

After installation, reboot to start in kiosk mode: `sudo reboot`

### First Login

**Important**: The first Spotify login must be done on the Pi itself.

1. Open browser on the Pi: `http://127.0.0.1:5000`
2. Log in with your Spotify Premium account
3. Done! The app will remember your credentials.

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

---
Built with [Claude Code](https://claude.ai/code) 🤖

## License

Personal project for educational purposes.
