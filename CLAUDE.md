# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Git Regels

**BELANGRIJK:** Maak NOOIT automatisch git commits. Vraag ALTIJD eerst toestemming aan de gebruiker voordat je commits maakt of code naar GitHub pusht.

## README Richtlijnen

De README.md moet beknopt en actueel zijn. Volg deze regels:

**Wat WEL in README:**
- Korte projectbeschrijving (max 3 zinnen)
- Features lijst (huidige staat, geen "Nieuw" markers)
- Setup instructies (Spotify credentials + installatie)
- Basis gebruik
- Troubleshooting (alleen veelvoorkomende problemen)

**Wat NIET in README:**
- Changelog of sessie geschiedenis
- "Nieuw" of "✅" markers bij features
- Technische implementatie details (hoort in CLAUDE.md)
- Toekomstige verbeteringen / roadmap
- Code voorbeelden van interne implementatie

**Doel:** Een nieuwe gebruiker moet binnen 5 minuten kunnen begrijpen wat de app doet en hoe deze te installeren.

## Project Overview

This is a kids-friendly Spotify player built with Flask (Python backend) and vanilla JavaScript (frontend). The application is designed for use on a Raspberry Pi with touchscreen. It provides a simplified, touch-friendly interface for children to browse playlists and control music playback.

## Development Commands

### Setup and Run
```bash
# Install dependencies
pip install -r requirements.txt

# Run the development server
python app.py
```

The app runs on `http://localhost:5000` with Flask debug mode enabled.

### Configuration
- Copy `.env.example` to `.env` and fill in Spotify API credentials
- Get credentials from https://developer.spotify.com/dashboard
- `SPOTIFY_DEVICE_NAME` environment variable filters which Spotify devices are shown (optional)
- OAuth scope includes `user-follow-read` for followed artists feature

## Architecture

### Backend (app.py)
Single-file Flask application (~644 lines) with these key components:

**Authentication Flow:**
- Spotify OAuth2 with session-based token management
- Automatic token refresh using spotipy library
- Session storage with per-user cache files (`.cache-{user_id}`)
- Logout mechanism with comprehensive cleanup:
  - Deletes all `.cache-*` files via glob pattern
  - Clears Flask session completely
  - Removes cookies using Flask config params (SESSION_COOKIE_NAME, path, domain, samesite, secure, httponly)
  - Adds Cache-Control headers (no-store, no-cache, must-revalidate, max-age=0)
  - Invalidates Spotipy in-memory cache via cache_handler
  - `show_dialog=True` in SpotifyOAuth forces account selection screen for easy account switching

**Audio Device Management:**
- Uses `pactl` for audio device enumeration and switching
- Device enumeration via `pactl list sinks`
- Device switching via `pactl set-default-sink`

**API Endpoints:**
- Authentication: `/logout` (clears session, deletes cache files, invalidates cookies with Cache-Control headers)
- Spotify operations: `/api/playlists`, `/api/playlist/<id>`, `/api/current`, `/api/devices`
- Playback control: `/api/play`, `/api/pause`, `/api/next`, `/api/previous`, `/api/play-track`, `/api/shuffle`
- Device management: `/api/transfer-playback` (Spotify devices), `/api/audio/devices` (system audio), `/api/audio/output` (switch audio device)
- Artists: `/api/artists` (gevolgde artiesten), `/api/artist/<id>/top-tracks` (top 10 tracks)
- Local discovery: `/api/spotify-connect/local` (mDNS discovered devices), `/api/transfer-playback-local` (transfer to local device)
- Special: `/api/audio/devices/refresh` re-enumerates audio devices

**mDNS Discovery (Local Spotify Connect Devices):**
- Uses `zeroconf` library to discover `_spotify-connect._tcp.local.` services on LAN
- `SpotifyConnectListener` class handles service add/remove events
- Discovered devices stored in global `local_spotify_devices` dict with TTL
- Background cleanup thread removes stale devices (older than 5 minutes)
- Devices found via mDNS may not appear in Spotify Web API until activated
- ZeroConf `getInfo` endpoint returns device details (publicKey, deviceId, remoteName)
- Transfer to local devices via `/api/transfer-playback-local` endpoint

**ZeroConf addUser Protocol (spotify_zeroconf.py):**

Dit is de implementatie voor het activeren van librespot devices via het Spotify Connect ZeroConf protocol. Deze activatie is nodig zodat het device verschijnt in de Spotify Web API.

*Cryptografische parameters (KRITISCH):*
- **DH Prime:** 768-bit (96 bytes), NIET 1536-bit. Spotify gebruikt een specifieke prime uit librespot's `diffie_hellman.rs`
- **Base key:** Eerste 16 bytes van SHA1(shared_secret), NIET alle 20 bytes. Dit was de oorzaak van MAC errors
- **Key derivation:** `base_key = sha1(shared_secret)[:16]`, daarna `checksum_key = HMAC(base_key, "checksum")` en `encryption_key = HMAC(base_key, "encryption")[:16]`

*Credentials blob format (KRITISCH):*
```
Tag 0x01 + varint(len) + username (UTF-8)
Tag 0x02 + 32-bit big-endian auth_type
Tag 0x03 + varint(len) + auth_data
```

*Dubbele encryptie structuur:*
1. **Inner layer (AES-192-ECB):** Credentials blob encrypted met device_id-derived key
   - Key: `SHA1(PBKDF2(SHA1(device_id), username, 256 iterations)) + big-endian(20)`
   - PKCS7 padding naar 16-byte boundary
2. **Outer layer (AES-128-CTR):** Inner blob (base64) encrypted met DH shared secret
   - Random 16-byte IV
   - HMAC-SHA1 MAC over encrypted data
   - Output: `IV + encrypted_data + MAC`

*Credentials:*
- Gebruikt stored credentials uit `~/.cache/librespot/credentials.json`
- auth_type = 1 (AUTH_STORED_CREDENTIALS)

*Device ID verschil:*
- mDNS `deviceId` (uit getInfo) ≠ Spotify API `device_id`
- Na activatie: fetch `/api/devices` en match op device name
- Frontend retry logic: 3 pogingen met 2 seconde interval

**Important Implementation Details:**
- All Spotify API calls use `get_spotify_client()` which handles authentication and token refresh
- Playlists endpoint uses pagination to fetch ALL user playlists (not just first 50)
- Audio device enumeration includes timing logs for performance monitoring

### Frontend Structure
```
templates/
  index.html        # Main UI with 3-panel layout and settings modal
  setup.html        # First-time setup instructions

static/
  css/styles.css    # Theme system using CSS custom properties
  js/app.js         # Application logic, API calls, theme management, toast notifications
```

**User Notifications:**
- Custom toast notification system (`showToast()`) for all user feedback
- Replaces browser `alert()` calls with styled, themed notifications
- Toast types: 'error' (red) and 'info' (blue)
- Auto-dismisses after 2 seconds with smooth slide-up animation
- Non-blocking UI, consistent with app's design language

**Three-Panel Layout:**
1. Left: Playlists/Artists toggle + list (scrollable)
2. Middle: Tracks from selected playlist/artist
3. Right: Now playing info + playback controls

**View Toggle (Playlists/Artiesten):**
- Segmented control in linker paneel header
- Toggle tussen playlists en gevolgde artiesten weergave
- Styling: pill-vorm buttons met gradient, actieve button gebruikt accent kleur
- Artiesten hebben circulaire foto's (vs vierkant voor playlists)
- Middenpaneel titel wijzigt: "Nummers" vs "Top Nummers"

**Settings Modal:**
Tab-based interface with 3 tabs and fixed 360px height:
1. Thema: 16 preset buttons (8 light + 8 dark) in 4x4 grid. Each button combines theme mode + colors. Sun icon for light themes, moon icon for dark themes.
2. Apparaten: Computer geluid (system audio) + Spotify devices with live status polling (3 second interval)
3. Overig: Playlist refresh, audio device refresh, logout, shutdown (placeholder)

**Modal UI:**
- No header - modal closes by clicking outside
- Fixed 360px height prevents size-jumping between tabs
- Thema tab opens by default
- Subtle hover animations on theme buttons (scale 1.08)

### Theme System
- Uses CSS custom properties (variables) for dynamic styling
- Dark mode implemented via `body[data-theme="dark"]` selector
- Settings persisted to LocalStorage (`theme`, `primaryColor`, `secondaryColor`, `accentColor`)
- 16 presets: 8 light mode (sun icon) + 8 dark mode (moon icon)
- Each preset sets theme mode, primary/secondary colors, AND accent color in one click
- Light presets: Paars, Oceaan, Bubblegum, Bos, Zonsondergang, Sinaasappel, Aardbei, Druif
- Dark presets: Nacht Paars, Neon Blauw, Neon Roze, Aurora, Lava, Middernacht, Cosmic, Matrix

**Accent Color System:**
- Each preset button has `data-accent` attribute with complementary color (via colorhexa.com)
- CSS variable `--accent-color` set dynamically per preset
- Shuffle button `.shuffle-on` uses `background: var(--accent-color)` when active
- JavaScript state: `accentColor` variable + localStorage persistence
- Provides visual distinction between shuffle (accent) and play (gradient) buttons

### Key Design Patterns

**Polling Behavior:**
- Spotify devices: Only polls when "Apparaten" tab is active (3s interval)
- Current track: Continuous polling (implemented in app.js)
- Polling stops when modal closed or tab switched to prevent unnecessary API calls

**Error Handling:**
- All API endpoints return JSON with `{error: string}` on failure
- Frontend displays user-friendly messages in Dutch via toast notifications (never browser alerts)
- **Playback endpoints return 404 (not 500)** for "no active device" scenarios
- Specific handling for: 'no active device', 'device_not_found', 'player command failed' errors
- All 5 playback endpoints (/api/play, /api/pause, /api/next, /api/previous, /api/play-track) return:
  - Status: 404 with Dutch message "Geen Spotify apparaat actief. Selecteer een apparaat in het instellingen menu."
- Debug logging enabled for troubleshooting (timing logs, device enumeration details)

## Important Implementation Notes

1. **Never skip token refresh:** Always use `get_spotify_client()` - it handles token expiration automatically
2. **Playlist context playback:** Use `context_uri` with `offset` to play from playlist (maintains queue)
3. **Device filtering:** `SPOTIFY_DEVICE_NAME` uses case-insensitive substring matching
4. **Settings modal tabs:** Only 4 tabs exist (Thema, Apparaten, Bluetooth, Overig). Always use `switchTab('theme')` when opening modal - theme is the first tab.
5. **Modal fixed height:** `.tab-content-wrapper` has fixed `height: 360px` to prevent size-jumping. Device lists use `max-height: 150px` with scroll.
6. **Tab navigation styling:** Each `.tab-btn` has its own `border-bottom`, with gaps creating visual separation (no continuous line across all tabs)
7. **Playback error responses:** All playback endpoints return 404 (not 500) with Dutch messages for "no active device" scenarios. Detect error strings: 'no active device', 'device_not_found', 'player command failed'.
8. **Toast notifications only:** Always use `showToast(message, 'error'|'info')` for user feedback - never use browser `alert()`. Toast system is already implemented and styled.
9. **Logout cleanup requirements:** Logout must delete cookies with all Flask config params, clear all .cache-* files, invalidate Spotipy cache, and add Cache-Control headers to prevent browser caching.
10. **Account switching:** `show_dialog=True` in SpotifyOAuth enables easy switching between multiple Spotify accounts after logout by forcing the account selection screen.
11. **Device security:** `is_device_allowed()` helper checks if active Spotify device is in `SPOTIFY_DEVICE_NAME` list. All 8 playback endpoints (`/api/play`, `/api/pause`, `/api/next`, `/api/previous`, `/api/play-track`, `/api/shuffle`, `/api/volume`, `/api/seek`) return 403 with Dutch error message if device not allowed. Frontend shows toast notification on 403 response.
12. **Accent color systeem:** Elke preset heeft `data-accent` attribuut met complementaire kleur. Shuffle knop `.shuffle-on` gebruikt `background: var(--accent-color)`. State: `accentColor` variabele + localStorage key `accentColor`. Functie `applyPreset(theme, primary, secondary, accent)` accepteert 4 parameters.
13. **Artists feature:** Vereist `user-follow-read` scope. Endpoints: `/api/artists` (cursor-based pagination), `/api/artist/<id>/top-tracks` (max 10, country='NL'). State: `currentViewMode` ('playlists'|'artists'), `currentArtistId`. Cache keys: `ARTISTS`, `ARTIST_TRACKS_PREFIX`.
14. **View toggle styling:** Buttons hebben gradient achtergrond, actieve button gebruikt `var(--accent-color)`. Hover effect: `scale(1.05)`. Geen container achtergrond.
15. **Artist playback context:** Artiesten top tracks spelen zonder playlist context (alleen track URI). Queue gedrag verschilt van playlist playback.
16. **mDNS discovery:** Uses `zeroconf` library for `_spotify-connect._tcp.local.` service browsing. SpotifyConnectListener class stores devices in `local_spotify_devices` dict. Devices shown in separate "Lokale apparaten (mDNS)" section in settings modal. Local devices have dashed border and mDNS badge.
17. **Local device transfer:** `/api/transfer-playback-local` endpoint attempts direct `transfer_playback()` with mDNS device_id. If device not registered with Spotify API, returns `needs_activation: true` for ZeroConf addUser flow.
18. **ZeroConf getInfo:** HTTP GET to `http://{ip}:{port}/?action=getInfo` returns device publicKey, deviceId, remoteName. Used for DH key exchange in addUser flow.
19. **ZeroConf addUser crypto:** KRITISCH: gebruik 768-bit DH prime (96 bytes) en eerste 16 bytes van SHA1 voor base_key. Dit is gedocumenteerd in de "ZeroConf addUser Protocol" sectie hierboven.
20. **Session token voor activatie:** `/api/activate-local-device` gebruikt `session.get('token_info')` voor OAuth token, NIET `sp.auth_manager.get_cached_token()` (die bestaat niet op de Spotify client).
21. **Device matching na activatie:** mDNS deviceId ≠ Spotify API device_id. Na ZeroConf activatie, match device op naam via `/api/devices` endpoint met retry logic (3x, 2s interval).

## Testing Considerations

- Requires active Spotify Premium account
- Needs at least one active Spotify device for playback control
- Verify theme persistence across page reloads (LocalStorage)

## Known Issues / Future Improvements

**Accent Color Contrast (TODO):**
- Sommige complementaire accent kleuren zijn te fel op lichte/donkere achtergronden
- SVG shuffle icon niet altijd goed zichtbaar op bepaalde accent kleuren
- Optimalisatie nodig: handmatig accent kleuren aanpassen voor betere leesbaarheid
- Overweeg: donkerdere/lichtere varianten van accent kleuren per theme mode

## Raspberry Pi Deployment

### Deploy Command
```bash
cd ~/spotify && git pull origin main && pip install -r requirements.txt --break-system-packages && systemctl --user restart spotify-player
```

### Spotify Connect Service (librespot)
**BELANGRIJK:** Gebruik de librespot **user service**, NIET raspotify (system service).

```bash
# Correcte service (user)
systemctl --user start librespot
systemctl --user status librespot

# Raspotify moet uitgeschakeld zijn
sudo systemctl stop raspotify
sudo systemctl disable raspotify
```

**Waarom user service:**
- Slaat credentials op in `~/.cache/librespot/credentials.json`
- Nodig voor ZeroConf addUser protocol (device activatie)
- Draait onder user context (toegang tot PulseAudio)

**Service configuratie:** `/home/robin/.config/systemd/user/librespot.service`

### Future Features (not yet implemented)
- Shutdown functionality (UI ready with 3-second press protection)
- Requires `sudo` permissions for shutdown

### Bluetooth Device Management

**Aparte Bluetooth tab** in settings modal (4 tabs: Thema, Apparaten, Bluetooth, Overig).

**Backend (app.py):**
- `BluetoothManager` class in `app.py`
- Gebruikt `bluetoothctl` via subprocess voor basis operaties
- Gebruikt `pexpect` library voor PIN/passkey handling
- Auto-reconnect thread bij app startup

**API Endpoints:**
| Endpoint | Method | Beschrijving |
|----------|--------|--------------|
| `/api/bluetooth/devices` | GET | Lijst van paired + discovered devices |
| `/api/bluetooth/scan` | POST | Start/stop device discovery (30 sec) |
| `/api/bluetooth/pair` | POST | Pair met device, optioneel met PIN |
| `/api/bluetooth/connect` | POST | Verbind met gepaired device |
| `/api/bluetooth/disconnect` | POST | Verbreek verbinding |
| `/api/bluetooth/forget` | DELETE | Vergeet/unpair device |

**Frontend (app.js):**
- `bluetoothState` object voor state management
- Polling elke 3 sec wanneer Bluetooth tab actief
- PIN modal voor devices die PIN vereisen
- Forget confirmation modal

**Auto-reconnect:**
- Laatst gebruikte device opgeslagen in `~/.config/spotify-player/last_bt_device.json`
- Bij app start: achtergrond thread probeert te verbinden met laatst gebruikte device
- Device moet gepaired EN in range zijn

**Belangrijke implementatie details:**
22. **pexpect voor PIN:** Fallback naar simple subprocess als pexpect niet beschikbaar. Meeste audio devices gebruiken geen PIN.
23. **Device states:** `scanning`, `pairing`, `connecting` states voor UI feedback met spinners.
24. **Trust na pair:** `bluetoothctl trust` wordt automatisch uitgevoerd na succesvolle pairing voor auto-reconnect support.
