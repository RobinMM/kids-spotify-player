# Kids-Friendly Spotify Player

Een eenvoudige, kindvriendelijke Spotify-speler gebouwd met Flask en JavaScript. Deze applicatie is ontworpen voor gebruik op een Raspberry Pi met touchscreen, maar kan ook op Windows worden gebruikt voor ontwikkeling.

## Features

### Werkend
- ✅ Spotify OAuth authenticatie
- ✅ Playlists bekijken en selecteren
- ✅ Nummers uit playlists bekijken
- ✅ Muziek afspelen, pauzeren, volgende/vorige nummer
- ✅ Shuffle mode
- ✅ Huidige afspeelende track zien met album art
- ✅ Kindvriendelijke interface met grote knoppen
- ✅ **Nieuw:** Tab-gebaseerde instellingen modal (Audio/Apparaten/Thema/Overig)
- ✅ **Nieuw:** Dark/Light theme systeem met volledig aanpasbare kleuren
- ✅ **Nieuw:** 3 kleurpresets (Paars, Blauw, Roze)
- ✅ **Nieuw:** Aangepaste kleurenpickers (8 primaire + 8 secundaire kleuren)
- ✅ **Nieuw:** Spotify apparaat selectie met filtering
- ✅ **Nieuw:** Live apparaat status met automatische polling (3 seconden)
- ✅ **Nieuw:** Auto-play bij wisselen tussen apparaten
- ✅ **Nieuw:** Playlists handmatig verversen
- ✅ **Nieuw:** Compacte interface met minder tekst (kindvriendelijker)
- ✅ **Nieuw:** Audio output device selectie (Windows/Linux)
- ✅ **Nieuw:** Instant audio device loading met server-side caching
- ✅ **Nieuw:** Manual refresh button voor audio devices
- ✅ **Nieuw:** Microfoon filtering (alleen output devices)
- ✅ **Nieuw:** Uitgebreide logout functionaliteit met volledige session cleanup
- ✅ **Nieuw:** Toast notificaties (vervangen browser alerts voor betere UX)
- ✅ **Nieuw:** Verbeterde error handling (404 voor "geen apparaat" scenarios)

### UI Voorbereid (Nog niet functioneel)
- ⏳ Raspberry Pi uitschakelen - UI klaar met beveiliging (3 sec. indrukken), backend placeholder

## Vereisten

- Python 3.7 of hoger
- Spotify Premium account (vereist voor playback control)
- Spotify Developer credentials (zie Setup hieronder)

## Setup

### 1. Spotify Developer Account Instellen

1. Ga naar [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Log in met je Spotify account
3. Klik op "Create an App"
4. Vul een app naam in (bijv. "Kids Spotify Player")
5. Vul een beschrijving in
6. Accepteer de terms en klik "Create"
7. Noteer je **Client ID** en **Client Secret**
8. Klik op "Edit Settings"
9. Voeg toe aan "Redirect URIs": `http://localhost:5000/callback`
10. Klik "Save"

### 2. Project Installeren

```bash
# Ga naar de project directory
cd C:\claude\spotify

# Maak een virtual environment (aanbevolen)
python -m venv venv

# Activeer virtual environment
# Op Windows:
venv\Scripts\activate

# Installeer dependencies
pip install -r requirements.txt
```

### 3. Configuratie

```bash
# Kopieer .env.example naar .env
copy .env.example .env

# Open .env in een teksteditor en vul je credentials in:
```

**.env bestand:**
```env
SPOTIFY_CLIENT_ID=jouw_client_id_hier
SPOTIFY_CLIENT_SECRET=jouw_client_secret_hier
SPOTIFY_REDIRECT_URI=http://localhost:5000/callback
FLASK_SECRET_KEY=een_random_string_hier

# Device Filter (Optioneel - laat leeg om alle apparaten te tonen)
SPOTIFY_DEVICE_NAME=
```

Voor `FLASK_SECRET_KEY` kun je een random string gebruiken, bijvoorbeeld:
```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

**SPOTIFY_DEVICE_NAME** (Optioneel):
- Laat leeg om alle Spotify apparaten te tonen
- Vul de naam in van je Raspberry Pi (bijv. "RaspberryPi") om alleen dat apparaat te tonen
- Voor ontwikkeling kun je je computer naam invullen (bijv. "DESKTOP-16R31VC")

### 3a. Extra Setup voor Windows (Audio Device Switching)

**Vereist voor audio device switching op Windows:**

De applicatie kan audio output devices switchen op Windows via PowerShell. Hiervoor moet je eenmalig de AudioDeviceCmdlets module installeren:

```powershell
# Open PowerShell als Administrator (rechtermuisklik → "Als administrator uitvoeren")
# Installeer eerst NuGet provider indien nodig:
Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Force -Scope CurrentUser

# Installeer AudioDeviceCmdlets module:
Install-Module -Name AudioDeviceCmdlets -Force -Scope CurrentUser
```

**Verificatie:**
```powershell
# Controleer of de module beschikbaar is:
Get-Module -ListAvailable -Name AudioDeviceCmdlets
```

**Zonder deze module:**
- Audio devices worden nog steeds getoond in de UI
- Je ziet welk device actief is (groene indicator)
- Maar klikken op een device geeft een error
- De app blijft verder gewoon werken

### 4. Applicatie Starten

```bash
# Zorg dat je virtual environment actief is
python app.py
```

De applicatie start op: **http://localhost:5000**

### 5. Eerste Gebruik

1. Open een browser en ga naar `http://localhost:5000`
2. Je wordt automatisch doorgestuurd naar Spotify login
3. Log in met je Spotify account
4. Autoriseer de applicatie
5. Je wordt teruggestuurd naar de muziekspeler
6. Selecteer een playlist, kies een nummer en enjoy!

## Project Structuur

```
spotify/
├── app.py                      # Flask backend met API endpoints
├── requirements.txt            # Python dependencies
├── .env                        # Configuratie (niet in git)
├── .env.example               # Template voor configuratie
├── .gitignore                 # Git ignore configuratie
├── static/
│   ├── css/
│   │   └── styles.css         # Kindvriendelijke styling
│   └── js/
│       └── app.js             # Frontend JavaScript logic
└── templates/
    └── index.html             # Main UI template
```

## Interface Layout

De interface bestaat uit 3 panelen:

### Links - Playlists
- Toont al je Spotify playlists
- Grote kleurrijke knoppen
- Klik om tracks te laden

### Midden - Nummers
- Toont alle nummers van geselecteerde playlist
- Grote tappable items
- Klik om direct af te spelen

### Rechts - Now Playing & Controls
- Album art en track info
- Afspeelknoppen: Vorige | Play/Pause | Volgende | Shuffle
- Compacte instellingenknop (⚙️)

## Nieuwe Features (Deze Sessie)

### 🎨 Theme Systeem
De applicatie heeft nu een volledig aanpasbaar theme systeem:

- **Dark/Light Mode**: Schakel tussen lichte en donkere modus
- **Kleurpresets**: 3 voorgedefinieerde kleurcombinaties
  - Paars (standaard)
  - Blauw
  - Roze
- **Aangepaste Kleuren**: Kies uit 8 primaire en 8 secundaire kleuren
- **Persistent**: Je keuzes worden automatisch opgeslagen in LocalStorage

**Gebruik:**
1. Klik op de instellingenknop (⚙️)
2. Ga naar het "Thema" tabblad
3. Kies een preset of selecteer handmatig kleuren
4. Schakel tussen light/dark mode

### 📱 Apparaat Beheer
Verbeterd beheer van Spotify afspeelapparaten:

- **Apparaat Filtering**: Toon alleen relevante apparaten via `SPOTIFY_DEVICE_NAME` in .env
- **Live Status**: Groene indicator toont actief apparaat
- **Auto-refresh**: Apparatenlijst wordt automatisch bijgewerkt (iedere 3 seconden)
- **Auto-play**: Muziek speelt automatisch door bij wisselen tussen apparaten

**Gebruik:**
1. Klik op de instellingenknop (⚙️)
2. Ga naar het "Apparaten" tabblad
3. Zie welk apparaat actief is (groene stip)
4. Klik op een apparaat om over te schakelen

### ⚙️ Tab-gebaseerde Instellingen
Instellingen zijn nu georganiseerd in 3 compacte tabs met vaste modal hoogte:

1. **Apparaten**: Gecombineerde tab voor Computer geluid (audio devices) + Spotify afspeelapparaten
2. **Thema**: Pas kleuren en dark/light mode aan
3. **Overig**: Playlists verversen, audio devices verversen en uitschakelen

**UI Optimalisaties:**
- X sluiten knop rechtsboven (bespaart verticale ruimte)
- Vaste modal hoogte (340px) voorkomt size-jumping tussen tabs
- Onderbroken tab navigation lijnen voor betere visuele scheiding
- Compacte thema layout met subtiele hover animaties

### 🔄 Playlists Verversen
- Handmatig playlists verversen zonder de app te herladen
- Handig bij nieuwe playlists of wijzigingen
- Te vinden in: Instellingen → Overig tab

### 🔊 Audio Device Management
Geavanceerd beheer van audio output devices met high-performance caching en device switching:

#### Features
- **Instant Loading**: Audio devices laden instant dankzij server-side cache (0ms)
- **Background Preload**: Devices worden automatisch geladen bij app startup
- **Manual Refresh**: Ververs button om devices opnieuw te detecteren
- **Device Switching**: Klik op een device om de Windows default audio output te wijzigen ✨ NIEUW
- **Active Indicator**: Groene stip toont welk device momenteel actief is
- **Smart Filtering**: Gebruikt Windows Core Audio API classificatie (EDataFlow.eRender) om alleen output devices te tonen - filtert automatisch alle input devices (microfoons, webcams)
- **Platform Support**: Werkt op zowel Windows (pycaw + PowerShell) als Linux (pactl)

#### Performance
- **Voor optimalisatie**: 9 seconden wachttijd
- **Na optimalisatie**:
  - Startup preload: ~4 seconden (background)
  - Normale gebruik: **Instant (0ms)** uit cache
  - Manual refresh: ~4-6 seconden
- **Verbetering**: 100% sneller voor normale gebruik

#### Gebruik
1. Klik op de instellingenknop (⚙️)
2. Ga naar het "Apparaten" tabblad
3. Zie "Computer geluid" sectie bovenaan
4. Devices verschijnen instant uit cache
5. Groene stip toont welk device momenteel actief is
6. Klik op een device om te switchen (Windows default audio output wijzigt)
7. Indicator update automatisch na switch
8. Gebruik refresh button in "Overig" tab om devices opnieuw te detecteren indien nodig

#### Technische Details
**Server-Side Cache:**
- Permanent cache zonder TTL (devices veranderen zelden)
- Thread-safe met Lock
- Invalideert bij manual refresh OF succesvolle device switch
- Background thread vult cache bij startup

**Device Enumeration:**
- Windows: pycaw library met COM interfaces + EDataFlow.eRender filtering
- Linux: pactl command-line tool
- Filtering: `GetAllDevices(data_flow=EDataFlow.eRender.value)` haalt alleen OUTPUT devices op
- Betrouwbaar: gebruikt Windows Core Audio API classificatie ipv keyword matching
- Timing logs voor performance monitoring

**Device Switching:**
- Windows: PowerShell AudioDeviceCmdlets module via subprocess
- Linux: pactl set-default-sink command
- Timeout: 5 seconden
- Cache invalidatie na succesvolle switch voor updated active status
- Error handling met duidelijke messages over ontbrekende dependencies

## Gebruik

### Muziek Afspelen
1. Klik op een playlist in het linker paneel
2. Klik op een nummer in het midden paneel
3. Muziek begint automatisch af te spelen
4. Gebruik de knoppen rechts om te bedienen

### Playback Controls
- **▶ / ⏸**: Play/Pause toggle
- **⏮**: Vorige track
- **⏭**: Volgende track
- **⇄**: Shuffle aan/uit

### Instellingen
- Klik op de **⚙️** knop rechtsonder
- Navigeer tussen 3 tabs (Apparaten/Thema/Overig)
- Wijzigingen worden automatisch opgeslagen (thema's)
- Modal sluiten met X knop rechtsboven

## Recente Verbeteringen

### User Experience Verbeteringen
**Toast Notificaties:**
- Alle browser `alert()` popups vervangen door stijlvolle toast notificaties
- 9 replacements in playback functies (play, pause, next, previous, playTrack)
- Shutdown placeholder gebruikt ook toast
- Consistente, niet-blokkerende feedback
- Nederlands met duidelijke foutmeldingen
- Auto-dismiss na 2 seconden met smooth animatie

### Logout Functionaliteit
**Volledige Session Cleanup:**
- Verwijdert alle `.cache-*` bestanden via glob pattern
- Wist Flask session compleet
- Verwijdert cookies met juiste Flask config parameters (SESSION_COOKIE_NAME, path, domain, samesite, secure, httponly)
- Cache-Control headers voorkomen browser caching (no-store, no-cache, must-revalidate, max-age=0)
- Invalideert Spotipy in-memory cache via cache_handler
- Force account keuze scherm bij volgende login (`show_dialog=True` in SpotifyOAuth)

**Account Switching:**
- Eenvoudig switchen tussen meerdere Spotify accounts
- Logout toont altijd account selectie scherm
- Geen automatische re-login meer

### Error Handling
**Betere Foutafhandeling:**
- Backend returnt nu 404 (niet 500) voor "geen actief apparaat" scenario's
- Duidelijke Nederlandse meldingen: "Geen Spotify apparaat actief. Selecteer een apparaat in het instellingen menu."
- 5 Endpoints verbeterd: `/api/play`, `/api/pause`, `/api/next`, `/api/previous`, `/api/play-track`
- Consistent error detection voor: 'no active device', 'device_not_found', 'player command failed'

## Ontwikkeling

### Voor Raspberry Pi Deployment (Toekomst)

De volgende features moeten nog geïmplementeerd worden voor gebruik op Raspberry Pi:

**Shutdown functionaliteit:**
```python
import subprocess
subprocess.run(['sudo', 'shutdown', '-h', 'now'])
```

**Audio output switching:**
```bash
# Bluetooth
pactl set-default-sink bluez_sink.XX_XX_XX_XX_XX_XX

# Onboard speakers
pactl set-default-sink alsa_output.platform-soc_audio.analog
```

### Systeemvereisten voor Pi
```bash
sudo apt update
sudo apt install python3-flask bluez pulseaudio
```

## Troubleshooting

### "Credentials not found" error
- Controleer of `.env` bestaat en correct ingevuld is
- Controleer of je de juiste Client ID en Secret hebt gebruikt

### "No active device found" error
- Open Spotify op je computer/telefoon
- Start muziek afspelen
- Probeer opnieuw via de web interface

### Playback werkt niet
- Controleer of je Spotify Premium hebt (Free werkt niet voor playback control)
- Zorg dat je minstens één actief device hebt (Spotify app open)

### Playlists laden niet
- Controleer je internetverbinding
- Controleer of je correcte Spotify credentials hebt
- Check de browser console voor errors (F12)

## Beveiliging

- `.env` wordt automatisch uitgesloten van git via `.gitignore`
- Deel nooit je Client Secret publiekelijk
- De shutdown functie heeft extra beveiliging (3 sec. indrukken + bevestiging)

## Kindveiligheid

- Geen zoekbalk (alleen curated playlists)
- Grote, duidelijke knoppen
- Geen complexe menu's
- Bescherming tegen onbedoeld uitschakelen
- Kleurrijk en aantrekkelijk design

## Technische Details

### Theme Systeem Implementatie
Het theme systeem gebruikt CSS Custom Properties (variabelen):

```css
:root {
    --primary-color: #667eea;
    --secondary-color: #764ba2;
    --bg-gradient-start: var(--primary-color);
    --bg-gradient-end: var(--secondary-color);
    --panel-bg: white;
    --text-primary: #333;
    /* ... meer variabelen */
}
```

Dark mode overschrijft specifieke variabelen:
```css
body[data-theme="dark"] {
    --panel-bg: #1e1e1e;
    --text-primary: #e0e0e0;
    /* ... meer variabelen */
}
```

Thema's worden opgeslagen in LocalStorage:
```javascript
localStorage.setItem('spotify-theme', currentTheme);
localStorage.setItem('spotify-primary-color', primaryColor);
localStorage.setItem('spotify-secondary-color', secondaryColor);
```

### Device Polling
Wanneer de "Apparaten" tab actief is, wordt de apparatenlijst automatisch ververst:
- **Interval**: 3 seconden
- **Start**: Bij openen Apparaten tab
- **Stop**: Bij wisselen naar andere tab of sluiten modal
- **Doel**: Live status updates detecteren (bijv. wisselen vanaf telefoon)

## Toekomstige Verbeteringen

- [ ] Raspberry Pi shutdown integratie
- [ ] Volume controle
- [ ] Offline playback ondersteuning
- [ ] RFID kaarten voor playlist shortcuts
- [ ] Profielen voor meerdere kinderen
- [ ] Animaties en visuele feedback
- [ ] Voice feedback
- [x] ~~Dark/Light theme systeem~~ ✅ Voltooid
- [x] ~~Apparaat selectie en beheer~~ ✅ Voltooid
- [x] ~~Live apparaat status updates~~ ✅ Voltooid
- [x] ~~Audio output device selectie~~ ✅ Voltooid
- [x] ~~Audio device caching voor instant loading~~ ✅ Voltooid

## Changelog - Recente Sessies

### Sessie 7: Logout, Error Handling & Notifications (Nov 2025)
Deze sessie heeft de logout functionaliteit gerepareerd en gebruikerservaring verbeterd:

#### 🔐 Logout Functionaliteit Fix
**Comprehensive Cleanup:**
- **Cache files deletion**: Verwijdert alle `.cache-*` bestanden via glob pattern
- **Spotipy cache invalidation**: Roept `cache_handler.save_token_to_cache(None)` aan
- **Cookie deletion**: Gebruikt Flask config params (SESSION_COOKIE_NAME, path, domain, samesite, secure, httponly)
- **Cache-Control headers**: Voegt `no-store, no-cache, must-revalidate, max-age=0` toe aan responses

**Account Switching:**
- `show_dialog=True` in SpotifyOAuth forceert account selectie scherm
- Maakt switchen tussen meerdere Spotify accounts mogelijk
- Geen automatische re-login meer na logout

**No-Cache Headers:**
- Ook toegevoegd aan index route voor consistente logout ervaring
- Voorkomt browser caching van gevoelige sessie data

#### 🛠️ Error Handling Verbetering
**404 Instead of 500:**
- Playback endpoints returnen nu 404 voor "no active device" scenarios
- Voorheen: 500 Internal Server Error (verwarrend)
- Nu: 404 Not Found met duidelijke Nederlandse melding

**Dutch Error Messages:**
- Gebruiksvriendelijke foutmeldingen: "Geen Spotify apparaat actief. Selecteer een apparaat in het instellingen menu."
- Consistente error detection: 'no active device', 'device_not_found', 'player command failed'

**5 Endpoints Updated:**
- `/api/play` (line 526-540)
- `/api/pause` (line 542-556)
- `/api/next` (line 558-572)
- `/api/previous` (line 574-588)
- `/api/play-track` (line 590-617)

#### 🔔 Frontend Notifications
**Toast Notifications:**
- Alle browser `alert()` calls vervangen door `showToast()`
- 9 replacements in playback functies: playTrack(), togglePlayPause(), previousTrack(), nextTrack()
- Shutdown placeholder ook geconverteerd naar toast

**Betere UX:**
- Niet-blokkerende notificaties (geen modal popup)
- Consistente stijl met app theme
- Auto-dismiss na 2 seconden
- Nederlandse berichten
- Smooth slide-up animatie

#### 📊 Impact
- ✅ Logout werkt nu volledig (geen stuck sessions meer)
- ✅ Account switching mogelijk via logout
- ✅ Duidelijkere foutmeldingen voor gebruikers
- ✅ Betere HTTP status codes (404 i.p.v. 500)
- ✅ Professionelere gebruikerservaring met toast notificaties
- ✅ Geen browser alerts meer (13 total toast uses in app)

#### 📝 Bestanden Aangepast
**app.py:**
- Logout route (lines 357-410): Cookie deletion, cache-control headers, Spotipy invalidation
- Index route (lines 313-319): Cache-control headers
- SpotifyOAuth init (line 75): `show_dialog=True` parameter
- 5 playback endpoints: 404 responses met Nederlandse messages

**app.js:**
- 9 playback functies: `alert()` → `showToast()` conversie
- Shutdown placeholder: `alert()` → `showToast()`
- Consistent error handling pattern met response.ok checks

### Sessie 6: Settings Modal UI Optimization (Nov 2025)
Deze sessie heeft de settings modal geoptimaliseerd voor een compactere, stabielere interface:

#### 🎨 Modal Layout Optimalisatie
- **X Sluiten Knop**: Verplaatst van onderaan naar rechtsboven in header
- **Verticale Ruimte**: Bespaart ~60px door knop verplaatsing
- **Vaste Hoogte**: Modal heeft nu vaste 340px hoogte (voorkomt size-jumping)
- **Tab Navigatie**: Onderbroken lijnen tussen tabs voor betere visuele scheiding

#### 📱 Tabs Samengevoegd (4→3)
- **Apparaten Tab**: Combineert "Computer geluid" + "Spotify afspelen op" in één tab
- **Logische Groepering**: Alle device selectie op één plek
- **Verticaal Layout**: Beide device lists onder elkaar met eigen labels
- **Scrollable Lists**: Max-height 150px met scroll indien nodig

#### 🎨 Thema Tab Optimalisatie
- **Compactere Layout**: Sections width 200px → 160px
- **Kleinere Color Buttons**: ~96px → ~77px (nog steeds touch-friendly)
- **Padding voor Clipping**: 6px padding voorkomt border/hover clipping
- **Subtielere Hover**: Scale 1.1 → 1.08 voor betere fit
- **Gaps**: Tab gap 12px, color grid gap 8px voor goede spacing

#### 🔧 JavaScript Fixes
- **Audio Devices Loading**: Fix voor loadAudioDevices() in gecombineerde tab
- **Tab Switching**: Update naar 'devices' i.p.v. oude 'audio' tab
- **Modal Opening**: Opent nu correct op eerste tab ('devices')

#### 📊 Gebruikerservaring
- ✅ Geen size-jumping meer tussen tabs
- ✅ Compactere, efficiëntere interface
- ✅ Betere visuele scheiding in tab navigation
- ✅ Alle content past binnen vaste modal hoogte
- ✅ Simpelere navigatie (3 tabs i.p.v. 4)

#### 📝 Bestanden Aangepast
- `templates/index.html`: Modal header met X knop, tabs samengevoegd (4→3)
- `static/css/styles.css`: Vaste modal hoogte, compacte thema layout, onderbroken tab lijnen
- `static/js/app.js`: Tab switching fix voor gecombineerde devices tab

### Sessie 5: Audio Device Switching Implementation (Nov 2025)
Deze sessie heeft daadwerkelijke audio device switching geïmplementeerd via PowerShell:

#### 🔊 Device Switching Functionaliteit
- **PowerShell Implementatie**: Gebruikt AudioDeviceCmdlets module voor betrouwbare device switching
- **Actieve Device Detectie**: Fixed bug in active device detection (`.GetId()` → `.id`)
- **Cache Invalidatie**: Cache wordt automatisch ververst na succesvolle device switch
- **Bi-directioneel**: Switchen werkt in beide richtingen tussen alle beschikbare devices
- **Error Handling**: Duidelijke error messages als PowerShell module niet geïnstalleerd is

#### 🔧 Backend Implementatie
- **Module Check**: `check_audiodevicecmdlets_installed()` functie controleert of module beschikbaar is
- **PowerShell Subprocess**: `set_audio_device_windows_powershell()` roept `Set-AudioDevice` aan met 5s timeout
- **Stub Verwijderd**: `set_audio_device_windows()` werkt nu echt (was placeholder)
- **API Update**: `/api/audio/output` endpoint invalideert cache na succesvolle switch
- **Platform Support**: Windows (PowerShell) en Linux (pactl) beide ondersteund

#### 🎯 Gebruikerservaring
- **Klikbare Devices**: Klik op een device in Audio Uitgang tab om te switchen
- **Groene Indicator**: Toont actieve device en update automatisch na switch
- **Instant Feedback**: API returnt success/error direct
- **Windows Integration**: Wijzigt daadwerkelijk de Windows default audio output

#### 📊 Test Resultaten
- ✅ Switch tussen EPOS headset en Realtek speakers succesvol
- ✅ Active indicator update correct na switch
- ✅ PowerShell bevestigt device wijzigingen
- ✅ Cache invalidatie werkt (nieuwe status zichtbaar)
- ✅ Error handling bij ontbrekende module

#### 📦 Vereisten
- **Windows**: AudioDeviceCmdlets PowerShell module (`Install-Module -Name AudioDeviceCmdlets -Force`)
- **Linux**: pactl command-line tool (standaard aanwezig)
- **Zonder module**: App werkt nog steeds, maar device switching niet mogelijk

#### 📝 Bestanden Aangepast
- `app.py`: PowerShell functies, bug fix active device detection, cache invalidatie
- `README.md`: Setup instructies voor AudioDeviceCmdlets, uitgebreide documentatie
- `CLAUDE.md`: Technische details over PowerShell implementatie

### Sessie 4: EDataFlow Filtering Improvement (Nov 2025)
Deze sessie heeft de device filtering verbeterd met Windows Core Audio API classificatie:

#### 🎯 EDataFlow.eRender Implementatie
- **API-based Filtering**: Gebruikt `GetAllDevices(data_flow=EDataFlow.eRender.value)` voor betrouwbare filtering
- **Webcam Fix**: Logitech Brio 505 en andere webcams worden nu correct uitgefilterd
- **Universeel**: Werkt ongeacht device naam of taal (geen keyword lists meer nodig)
- **Toekomstbestendig**: Alle nieuwe input devices worden automatisch gefilterd

#### 🧹 Code Cleanup
- Verwijderde keyword filtering logic (9 regels code minder)
- Eenvoudigere implementatie: vertrouwt op Windows classificatie
- Geen onderhoud van keyword lists meer nodig
- Duidelijkere code met betere comments

#### 📊 Betrouwbaarheid
- **Voor**: Keyword matching kon devices missen ("Telefoon met luidspreker")
- **Na**: Windows bepaalt of device INPUT of OUTPUT is
- **Resultaat**: 100% betrouwbare classificatie via OS

#### 📝 Bestanden Aangepast
- `app.py`: EDataFlow import, GetAllDevices parameter, verwijderde keyword filtering
- `README.md`: Updated documentatie met nieuwe filtering methode

### Sessie 3: Audio Device Performance Optimization (Nov 2025)
Deze sessie heeft high-performance audio device management toegevoegd:

#### 🔊 Audio Device Caching System
- **Server-side cache**: Permanent cache zonder TTL voor instant loading
- **Background preload**: Devices worden automatisch geladen bij app startup (4s)
- **Instant loading**: 0ms laadtijd uit cache (was 9s)
- **Thread-safe**: Lock-based cache management voor multi-threaded Flask
- **Performance monitoring**: Timing logs voor elke enumeration

#### 🔄 Manual Refresh Functionaliteit
- Refresh button in Audio Uitgang tab (SVG icon)
- Invalideert beide caches (frontend + backend)
- POST endpoint: `/api/audio/devices/refresh`
- Loading state tijdens refresh
- Cache wordt automatisch bijgewerkt na refresh

#### 🎯 Smart Device Filtering
- EDataFlow.eRender filtering: alleen OUTPUT devices ophalen
- Windows Core Audio API classificatie (betrouwbaarder dan keyword matching)
- Filtert automatisch alle input devices (microfoons, webcams, etc.)
- Alleen DEVICE_STATE_ACTIVE devices
- Platform-specifiek: Windows (pycaw) + Linux (pactl)

#### 📊 Performance Verbetering
- **Voor**: 9 seconden wachttijd bij elke tab open
- **Na**: Instant (0ms) voor normale gebruik
- **Verbetering**: 100% sneller
- **Startup**: 4s background preload (onzichtbaar voor gebruiker)
- **Manual refresh**: 4-6s (alleen bij button klik)

#### 🔧 Technische Details
- COM initialization optimalisatie (Windows)
- Removed duplicate device enumeration
- Frontend cache (60s TTL) + Backend cache (permanent)
- Debug logging voor troubleshooting
- Cache invalidation via manual refresh only

#### 📝 Bestanden Aangepast
- `app.py`: Cache system, timing logs, optimized enumeration
- `static/js/app.js`: Frontend cache, refresh handler
- `templates/index.html`: Refresh button met SVG icon
- `README.md`: Performance documentatie

### Sessie 2: Theme System & UI Polish (Nov 2025)

#### Belangrijkste Toevoegingen

#### 🎨 Volledige Theme Customization
- Dark/Light mode switch
- 3 kleurpresets (Paars, Blauw, Roze)
- 8 primaire kleuren + 8 secundaire kleuren
- CSS Custom Properties voor dynamische styling
- LocalStorage persistentie

#### 📱 Geavanceerd Apparaat Beheer
- Apparaat filtering via environment variable (`SPOTIFY_DEVICE_NAME`)
- Groene stip indicator voor actief apparaat
- Automatische polling (3 sec) voor live status updates
- Auto-play bij wisselen tussen apparaten (`force_play=True`)

#### ⚙️ UI/UX Verbeteringen
- Tab-gebaseerde instellingen modal (4 tabs)
- Compacte instellingenknop zonder tekst
- Verwijderde overbodige tekst labels ("Besturing")
- Playlists handmatig verversen via Overig tab
- Quicksand font overal toegepast
- Border-radius fix voor playlist buttons

#### 🔧 Technische Verbeteringen
- Smart polling: alleen actief wanneer Apparaten tab open is
- Scoped CSS selectors om style bleeding te voorkomen
- Horizontale layout voor Theme tab (past op 720p scherm)
- Verbeterde error handling en debug logging

### Bestanden Aangepast
- `templates/index.html`: Tab navigatie, theme controls, compact buttons
- `static/css/styles.css`: CSS variabelen, theme styling, device indicators
- `static/js/app.js`: Theme management, tab switching, device polling
- `app.py`: Device filtering, force_play update
- `.env`: SPOTIFY_DEVICE_NAME toegevoegd

## Licentie

Dit is een persoonlijk project voor educatieve doeleinden.

## Support

Voor vragen of problemen, check de Spotify Web API documentatie:
- [Spotify Web API Docs](https://developer.spotify.com/documentation/web-api)
- [Spotipy Library Docs](https://spotipy.readthedocs.io/)
