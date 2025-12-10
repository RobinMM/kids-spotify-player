from flask import Flask, render_template, request, jsonify, redirect, session, make_response
from functools import wraps
import spotipy
from spotipy.oauth2 import SpotifyOAuth
import os
import subprocess
import glob
import json
import re
from dotenv import load_dotenv
from threading import Thread, Lock, Event
import time
import requests

# Bluetooth support
try:
    import pexpect
    PEXPECT_AVAILABLE = True
except ImportError:
    PEXPECT_AVAILABLE = False
    print("Warning: pexpect not available - Bluetooth pairing with PIN disabled")

# mDNS/Zeroconf for local Spotify Connect discovery
from zeroconf import ServiceBrowser, ServiceListener, Zeroconf

# ZeroConf addUser flow for activating local devices
try:
    from spotify_zeroconf import SpotifyZeroConf
    ZEROCONF_ACTIVATION_AVAILABLE = True
except ImportError:
    ZEROCONF_ACTIVATION_AVAILABLE = False
    print("Warning: spotify_zeroconf not available - local device activation disabled")

# Load environment variables
load_dotenv()

app = Flask(__name__)
app.secret_key = os.getenv('FLASK_SECRET_KEY', 'dev-secret-key-change-in-production')

# API error cooldown - voorkomt escalatie bij tijdelijke Spotify problemen
_last_api_error_time = 0
_api_cooldown_seconds = 30
_cached_current_track = None

# ============================================
# TRANSLATIONS (i18n)
# ============================================
TRANSLATIONS = {
    'en': {
        # Error messages
        'error.not_logged_in': 'Not logged in',
        'error.no_device': 'No Spotify device active. Select a device in settings.',
        'error.device_not_allowed': 'Playback not allowed on this device',
        'error.playback_failed': 'Playback failed',
        'error.transfer_failed': 'Transfer failed',
        'error.device_not_found': 'Device not found',
        'error.rate_limit': 'Too many requests. Please wait a moment.',
        'error.server_error': 'Spotify server error. Please try again later.',
        'error.unknown': 'An unexpected error occurred',

        # Bluetooth messages
        'bt.not_available': 'Bluetooth not available on this system',
        'bt.scan_started': 'Bluetooth scan started',
        'bt.scan_stopped': 'Bluetooth scan stopped',
        'bt.scan_failed': 'Failed to start scan',
        'bt.pair_success': 'Device paired successfully',
        'bt.pair_failed': 'Pairing failed',
        'bt.pair_needs_pin': 'PIN required',
        'bt.connect_success': 'Connected',
        'bt.connect_failed': 'Connection failed',
        'bt.disconnect_success': 'Disconnected',
        'bt.disconnect_failed': 'Disconnect failed',
        'bt.forget_success': 'Device forgotten',
        'bt.forget_failed': 'Forget failed',
        'bt.power_on': 'Bluetooth enabled',
        'bt.power_off': 'Bluetooth disabled',
        'bt.power_failed': 'Failed to change Bluetooth power',

        # System messages
        'system.shutdown': 'System is shutting down...',
        'system.reboot': 'System is restarting...',
        'system.shutdown_failed': 'Shutdown failed',
        'system.reboot_failed': 'Restart failed',

        # Update messages
        'update.checking': 'Checking for updates...',
        'update.up_to_date': 'Application is up-to-date',
        'update.available': 'Update available',
        'update.downloading': 'Downloading update...',
        'update.installing': 'Installing update...',
        'update.success': 'Update installed successfully. Restarting...',
        'update.failed': 'Update failed',
        'update.no_releases': 'No releases found',

        # Device activation
        'device.activation_success': 'Device activated',
        'device.activation_failed': 'Device activation failed',
        'device.needs_activation': 'Device needs to be activated first',

        # PIN
        'pin.incorrect': 'Incorrect PIN',

        # Bluetooth address
        'bt.address_required': 'Bluetooth address is required',

        # Audio
        'audio.volume_failed': 'Could not adjust volume',
    },
    'nl': {
        # Error messages
        'error.not_logged_in': 'Niet ingelogd',
        'error.no_device': 'Geen Spotify apparaat actief. Selecteer een apparaat in het instellingen menu.',
        'error.device_not_allowed': 'Afspelen niet toegestaan op dit apparaat',
        'error.playback_failed': 'Afspelen mislukt',
        'error.transfer_failed': 'Overdracht mislukt',
        'error.device_not_found': 'Apparaat niet gevonden',
        'error.rate_limit': 'Te veel verzoeken. Even geduld alsjeblieft.',
        'error.server_error': 'Spotify server fout. Probeer het later opnieuw.',
        'error.unknown': 'Er is een onverwachte fout opgetreden',

        # Bluetooth messages
        'bt.not_available': 'Bluetooth niet beschikbaar op dit systeem',
        'bt.scan_started': 'Bluetooth scan gestart',
        'bt.scan_stopped': 'Bluetooth scan gestopt',
        'bt.scan_failed': 'Scan starten mislukt',
        'bt.pair_success': 'Apparaat gekoppeld',
        'bt.pair_failed': 'Koppelen mislukt',
        'bt.pair_needs_pin': 'PIN vereist',
        'bt.connect_success': 'Verbonden',
        'bt.connect_failed': 'Verbinden mislukt',
        'bt.disconnect_success': 'Losgekoppeld',
        'bt.disconnect_failed': 'Loskoppelen mislukt',
        'bt.forget_success': 'Apparaat vergeten',
        'bt.forget_failed': 'Vergeten mislukt',
        'bt.power_on': 'Bluetooth ingeschakeld',
        'bt.power_off': 'Bluetooth uitgeschakeld',
        'bt.power_failed': 'Kon Bluetooth status niet wijzigen',

        # System messages
        'system.shutdown': 'Systeem wordt uitgeschakeld...',
        'system.reboot': 'Systeem wordt herstart...',
        'system.shutdown_failed': 'Uitschakelen mislukt',
        'system.reboot_failed': 'Herstarten mislukt',

        # Update messages
        'update.checking': 'Controleren op updates...',
        'update.up_to_date': 'Applicatie is up-to-date',
        'update.available': 'Update beschikbaar',
        'update.downloading': 'Update downloaden...',
        'update.installing': 'Update installeren...',
        'update.success': 'Update succesvol geïnstalleerd. Herstarten...',
        'update.failed': 'Update mislukt',
        'update.no_releases': 'Geen releases gevonden',

        # Device activation
        'device.activation_success': 'Apparaat geactiveerd',
        'device.activation_failed': 'Apparaat activeren mislukt',
        'device.needs_activation': 'Apparaat moet eerst geactiveerd worden',

        # PIN
        'pin.incorrect': 'Onjuiste PIN',

        # Bluetooth address
        'bt.address_required': 'Bluetooth adres is verplicht',

        # Audio
        'audio.volume_failed': 'Kon volume niet aanpassen',
    }
}


def get_user_language():
    """Get the current user's language preference from session"""
    return session.get('language', 'en')


def t(key):
    """Get translated string for the given key"""
    lang = get_user_language()
    return TRANSLATIONS.get(lang, {}).get(key) or TRANSLATIONS['en'].get(key) or key


def is_api_in_cooldown():
    """Check if we're in cooldown period after API errors"""
    global _last_api_error_time
    return time.time() - _last_api_error_time < _api_cooldown_seconds


def set_api_error():
    """Mark that an API error occurred"""
    global _last_api_error_time
    _last_api_error_time = time.time()


# Spotify Connect mDNS discovery
_spotify_connect_devices = {}
_spotify_connect_lock = Lock()
_zeroconf_instance = None
_service_browser = None

class SpotifyConnectListener(ServiceListener):
    """Listener for Spotify Connect devices on the local network"""

    def update_service(self, zc: Zeroconf, type_: str, name: str) -> None:
        """Called when a service is updated"""
        self._process_service(zc, type_, name, "updated")

    def remove_service(self, zc: Zeroconf, type_: str, name: str) -> None:
        """Called when a service is removed"""
        with _spotify_connect_lock:
            # Extract device name from service name (format: "DeviceName._spotify-connect._tcp.local.")
            device_name = name.replace("._spotify-connect._tcp.local.", "")
            if device_name in _spotify_connect_devices:
                del _spotify_connect_devices[device_name]
                print(f"[mDNS] Spotify Connect device removed: {device_name}")

    def add_service(self, zc: Zeroconf, type_: str, name: str) -> None:
        """Called when a new service is discovered"""
        self._process_service(zc, type_, name, "discovered")

    def _process_service(self, zc: Zeroconf, type_: str, name: str, action: str) -> None:
        """Process a discovered or updated service"""
        info = zc.get_service_info(type_, name)
        if info:
            # Extract device info
            device_name = name.replace("._spotify-connect._tcp.local.", "")
            addresses = [addr for addr in info.parsed_addresses()]
            port = info.port

            # Get CPath from TXT record (endpoint path for ZeroConf API)
            cpath = "/"
            if info.properties:
                cpath_bytes = info.properties.get(b'CPath', b'/')
                cpath = cpath_bytes.decode('utf-8') if isinstance(cpath_bytes, bytes) else cpath_bytes

            device_info = {
                'name': device_name,
                'addresses': addresses,
                'port': port,
                'cpath': cpath,
                'host': info.server
            }

            with _spotify_connect_lock:
                _spotify_connect_devices[device_name] = device_info

            print(f"[mDNS] Spotify Connect device {action}: {device_name} at {addresses[0] if addresses else 'unknown'}:{port}")

def start_spotify_connect_discovery():
    """Start mDNS discovery for Spotify Connect devices"""
    global _zeroconf_instance, _service_browser

    try:
        _zeroconf_instance = Zeroconf()
        listener = SpotifyConnectListener()
        _service_browser = ServiceBrowser(_zeroconf_instance, "_spotify-connect._tcp.local.", listener)
        print("[mDNS] Spotify Connect discovery started")
    except Exception as e:
        print(f"[mDNS] Failed to start discovery: {e}")

def stop_spotify_connect_discovery():
    """Stop mDNS discovery"""
    global _zeroconf_instance, _service_browser

    if _service_browser:
        _service_browser.cancel()
        _service_browser = None
    if _zeroconf_instance:
        _zeroconf_instance.close()
        _zeroconf_instance = None
    print("[mDNS] Spotify Connect discovery stopped")

def get_spotify_connect_devices():
    """Get list of discovered Spotify Connect devices"""
    with _spotify_connect_lock:
        return list(_spotify_connect_devices.values())

def get_device_info_from_zeroconf(device):
    """Fetch device info from the ZeroConf API endpoint"""
    if not device.get('addresses') or not device.get('port'):
        return None

    try:
        ip = device['addresses'][0]
        port = device['port']
        cpath = device.get('cpath', '/')

        # Build URL for getInfo action
        url = f"http://{ip}:{port}{cpath}"
        params = {'action': 'getInfo'}

        response = requests.get(url, params=params, timeout=3)
        if response.status_code == 200:
            return response.json()
    except Exception as e:
        print(f"[mDNS] Failed to get device info for {device.get('name')}: {e}")

    return None

# Spotify OAuth configuration
SPOTIFY_SCOPE = 'user-read-playback-state,user-modify-playback-state,playlist-read-private,user-library-read,user-follow-read'

def check_credentials():
    """Check if Spotify credentials are configured"""
    return bool(
        os.getenv('SPOTIFY_CLIENT_ID') and
        os.getenv('SPOTIFY_CLIENT_SECRET') and
        os.getenv('SPOTIFY_REDIRECT_URI')
    )

def get_cache_path(user_id='default'):
    """Get absolute cache file path"""
    base_dir = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(base_dir, f'.cache-{user_id}')

def get_spotify_oauth(show_dialog=False):
    """Create SpotifyOAuth instance

    Args:
        show_dialog: If True, force Spotify to show account selection screen.
                     Only set to True after explicit logout to allow account switching.
    """
    if not check_credentials():
        return None

    return SpotifyOAuth(
        client_id=os.getenv('SPOTIFY_CLIENT_ID'),
        client_secret=os.getenv('SPOTIFY_CLIENT_SECRET'),
        redirect_uri=os.getenv('SPOTIFY_REDIRECT_URI'),
        scope=SPOTIFY_SCOPE,
        cache_path=get_cache_path(session.get('user_id', 'default')),
        show_dialog=show_dialog
    )

def restore_session_from_cache():
    """Try to restore session from existing cache files.

    This handles the case where Flask session is lost but Spotify tokens
    are still valid in cache files (e.g., after browser restart).

    Returns:
        True if session was restored, False otherwise
    """
    if session.get('token_info'):
        return True  # Session already exists

    base_dir = os.path.dirname(os.path.abspath(__file__))
    cache_pattern = os.path.join(base_dir, '.cache-*')
    cache_files = glob.glob(cache_pattern)

    for cache_file in cache_files:
        try:
            with open(cache_file, 'r') as f:
                token_info = json.load(f)

            if not token_info.get('refresh_token'):
                continue

            # Extract user_id from cache filename
            user_id = os.path.basename(cache_file).replace('.cache-', '')
            if user_id == 'default':
                continue

            # Create OAuth with this user's cache
            sp_oauth = SpotifyOAuth(
                client_id=os.getenv('SPOTIFY_CLIENT_ID'),
                client_secret=os.getenv('SPOTIFY_CLIENT_SECRET'),
                redirect_uri=os.getenv('SPOTIFY_REDIRECT_URI'),
                scope=SPOTIFY_SCOPE,
                cache_path=cache_file
            )

            # Refresh token if expired
            if sp_oauth.is_token_expired(token_info):
                token_info = sp_oauth.refresh_access_token(token_info['refresh_token'])

            # Verify token works by making a test call
            sp = spotipy.Spotify(auth=token_info['access_token'])
            sp.current_user()  # This will raise if token is invalid

            # Token is valid - restore session
            session['token_info'] = token_info
            session['user_id'] = user_id
            print(f"Session restored from cache for user: {user_id}")
            return True

        except Exception as e:
            print(f"Could not restore session from {cache_file}: {e}")
            continue

    return False


def get_spotify_client():
    """Get authenticated Spotify client"""
    token_info = session.get('token_info', None)
    if not token_info:
        # Try to restore from cache first
        if restore_session_from_cache():
            token_info = session.get('token_info')
        else:
            return None

    sp_oauth = get_spotify_oauth()

    # Refresh token if expired
    if sp_oauth.is_token_expired(token_info):
        token_info = sp_oauth.refresh_access_token(token_info['refresh_token'])
        session['token_info'] = token_info

    # Disable spotipy retries - our cooldown system handles errors
    return spotipy.Spotify(
        auth=token_info['access_token'],
        retries=0,
        status_retries=0,
        requests_timeout=10
    )

def find_device_by_name(devices: list, name: str) -> dict:
    """Find a Spotify device by name with case-insensitive + fuzzy matching.

    Args:
        devices: List of device dicts from sp.devices()['devices']
        name: Device name to search for

    Returns:
        Device dict if found, None otherwise
    """
    if not devices or not name:
        return None

    name_lower = name.lower().strip()

    # Exacte match eerst (case-insensitive)
    for d in devices:
        if d.get('name', '').lower().strip() == name_lower:
            return d

    # Fuzzy match (contains)
    for d in devices:
        device_name = d.get('name', '').lower()
        if name_lower in device_name or device_name in name_lower:
            return d

    return None


def is_device_allowed(sp=None):
    """Check if current active device is in allowed list"""
    device_filter = os.getenv('SPOTIFY_DEVICE_NAME', '').strip()
    if not device_filter:
        return True  # Geen filter = alles toegestaan

    # Support meerdere devices (comma-separated)
    allowed_devices = [d.strip().lower() for d in device_filter.split(',')]

    if not sp:
        sp = get_spotify_client()
    if not sp:
        return False

    try:
        playback = sp.current_playback()
        if not playback or not playback.get('device'):
            return True  # Geen actief device = geen blokkade

        active_device_name = playback['device']['name'].lower()
        return any(allowed in active_device_name for allowed in allowed_devices)
    except:
        return True  # Bij error niet blokkeren


def handle_spotify_error(e, activate_cooldown=True):
    """Convert SpotifyException to user-friendly Dutch message and HTTP status code.

    Args:
        e: The exception
        activate_cooldown: Whether to activate API cooldown (default True)

    Returns:
        tuple: (error_message, http_status_code)
    """
    error_str = str(e).lower()

    # Log voor debugging
    print(f"[Spotify Error] {e}")

    # Activeer cooldown bij server errors om escalatie te voorkomen
    if activate_cooldown and ('max retries' in error_str or '500' in error_str or
                               '502' in error_str or '503' in error_str or '504' in error_str):
        set_api_error()
        print(f"[Cooldown] API cooldown geactiveerd voor {_api_cooldown_seconds} seconden")

    if 'max retries' in error_str:
        return 'Spotify reageert niet. Probeer het over een minuut opnieuw.', 503
    elif 'no active device' in error_str or 'device_not_found' in error_str or 'player command failed' in error_str:
        return 'Geen Spotify apparaat actief. Selecteer een apparaat in het instellingen menu.', 404
    elif 'rate limit' in error_str:
        return 'Te veel verzoeken. Even wachten...', 429
    elif '500' in error_str or '502' in error_str or '503' in error_str or '504' in error_str:
        return 'Spotify heeft tijdelijk problemen. Probeer het later opnieuw.', 503
    elif '401' in error_str or 'unauthorized' in error_str:
        return 'Sessie verlopen. Log opnieuw in.', 401
    elif '403' in error_str or 'forbidden' in error_str:
        return 'Geen toegang tot deze actie.', 403
    else:
        return 'Er ging iets mis met Spotify.', 500


def spotify_playback_action(f):
    """Decorator for playback endpoints that handles auth, device check, and error handling"""
    @wraps(f)
    def decorated(*args, **kwargs):
        sp = get_spotify_client()
        if not sp:
            return jsonify({'error': t('error.not_logged_in')}), 401

        if not is_device_allowed(sp):
            return jsonify({'error': t('error.device_not_allowed')}), 403

        try:
            return f(sp, *args, **kwargs)
        except spotipy.exceptions.SpotifyException as e:
            msg, status = handle_spotify_error(e)
            return jsonify({'error': msg}), status
        except Exception as e:
            print(f"[Unexpected Error] {e}")
            return jsonify({'error': t('error.unknown')}), 500
    return decorated

# Audio Device Helper Functions
def get_audio_devices_linux():
    """Get audio devices on Linux using pactl"""
    try:
        # Get default sink name first
        default_result = subprocess.run(['pactl', 'info'],
                                       capture_output=True, text=True, timeout=5)
        default_sink = None
        for line in default_result.stdout.split('\n'):
            if line.strip().startswith('Default Sink:'):
                default_sink = line.split(':', 1)[1].strip()
                break

        result = subprocess.run(['pactl', 'list', 'sinks'],
                              capture_output=True, text=True, timeout=5)

        if result.returncode != 0:
            return []

        devices = []
        current_device = {}

        for line in result.stdout.split('\n'):
            line = line.strip()

            # New sink starts
            if line.startswith('Sink #'):
                if current_device:
                    # Set is_default before appending
                    current_device['is_default'] = (current_device.get('id') == default_sink)
                    devices.append(current_device)
                current_device = {}

            # Extract sink name
            elif line.startswith('Name:'):
                current_device['id'] = line.split(':', 1)[1].strip()

            # Extract description
            elif line.startswith('Description:'):
                current_device['name'] = line.split(':', 1)[1].strip()

            # Check if this is the default/active sink
            elif line.startswith('State:'):
                state = line.split(':', 1)[1].strip()
                current_device['is_active'] = (state == 'RUNNING')

        # Add last device
        if current_device:
            current_device['is_default'] = (current_device.get('id') == default_sink)
            devices.append(current_device)

        return devices
    except (subprocess.TimeoutExpired, FileNotFoundError, Exception) as e:
        print(f"Error getting Linux audio devices: {e}")
        return []

def get_audio_devices():
    """Get audio output devices using pactl"""
    start_time = time.time()
    devices = get_audio_devices_linux()
    elapsed = time.time() - start_time
    print(f"get_audio_devices() took {elapsed:.2f}s, found {len(devices)} devices")
    return devices

def set_audio_device(device_id):
    """Set audio output device using pactl"""
    try:
        result = subprocess.run(['pactl', 'set-default-sink', device_id],
                              capture_output=True, text=True, timeout=5)
        return result.returncode == 0
    except Exception as e:
        print(f"Error setting audio device: {e}")
        return False


# =============================================================================
# Bluetooth Device Manager
# =============================================================================

class BluetoothManager:
    """Manager for Bluetooth device pairing and connection via bluetoothctl"""

    def __init__(self):
        self._scanning = False
        self._scan_thread = None
        self._scan_stop_event = Event()
        self._discovered_devices = {}
        self._lock = Lock()
        self._last_device_file = os.path.expanduser('~/.config/spotify-player/last_bt_device.json')

    def _run_bluetoothctl(self, commands, timeout=10):
        """Execute bluetoothctl commands via subprocess"""
        try:
            input_str = '\n'.join(commands) + '\nexit\n'
            result = subprocess.run(
                ['bluetoothctl'],
                input=input_str,
                capture_output=True,
                text=True,
                timeout=timeout
            )
            return result.stdout, result.stderr, result.returncode
        except subprocess.TimeoutExpired:
            return None, "Timeout", -1
        except FileNotFoundError:
            return None, "bluetoothctl niet gevonden", -1
        except Exception as e:
            return None, str(e), -1

    def _parse_devices(self, output):
        """Parse 'Device AA:BB:CC:DD:EE:FF Name' format from bluetoothctl"""
        devices = {}
        if not output:
            return devices
        for line in output.strip().split('\n'):
            match = re.match(r'Device ([0-9A-Fa-f:]{17})\s+(.+)', line.strip())
            if match:
                addr, name = match.groups()
                devices[addr.upper()] = name.strip()
        return devices

    def _get_device_info(self, address):
        """Get detailed info for a specific device"""
        stdout, _, _ = self._run_bluetoothctl([f'info {address}'], timeout=5)
        info = {'address': address}
        if stdout:
            for line in stdout.split('\n'):
                line = line.strip()
                if line.startswith('Name:'):
                    info['name'] = line.split(':', 1)[1].strip()
                elif line.startswith('Connected:'):
                    info['connected'] = 'yes' in line.lower()
                elif line.startswith('Paired:'):
                    info['paired'] = 'yes' in line.lower()
                elif line.startswith('Trusted:'):
                    info['trusted'] = 'yes' in line.lower()
                elif line.startswith('Icon:'):
                    info['icon'] = line.split(':', 1)[1].strip()
        return info

    def get_bluetooth_codec(self, address):
        """Get the active Bluetooth audio codec for a connected device."""
        try:
            result = subprocess.run(
                ['pactl', 'list', 'sinks'],
                capture_output=True, text=True, timeout=5
            )
            if result.returncode != 0:
                return None

            # Format address for matching (00:16:94:1D:C0:98 -> 00_16_94_1D_C0_98)
            address_formatted = address.replace(':', '_')

            # Parse pactl output to find the codec for this device
            current_sink_matches = False
            for line in result.stdout.split('\n'):
                line = line.strip()
                # Check if this sink belongs to our device
                if f'bluez_output.{address_formatted}' in line or f'api.bluez5.address = "{address}"' in line:
                    current_sink_matches = True
                elif line.startswith('Name:') and 'bluez' not in line:
                    current_sink_matches = False

                # If we're in the right sink section, look for codec
                if current_sink_matches and 'api.bluez5.codec' in line:
                    # Extract codec: api.bluez5.codec = "aptx"
                    codec = line.split('=')[1].strip().strip('"')
                    return codec.upper()

            return None
        except Exception as e:
            print(f"[BT] Error getting codec: {e}")
            return None

    def get_paired_devices(self):
        """Get list of paired Bluetooth devices"""
        stdout, stderr, rc = self._run_bluetoothctl(['devices Paired'], timeout=5)
        if rc != 0 or not stdout:
            print(f"[BT] Error getting paired devices: {stderr}")
            return []

        paired_addrs = self._parse_devices(stdout)
        devices = []

        for addr, name in paired_addrs.items():
            info = self._get_device_info(addr)
            is_connected = info.get('connected', False)

            device_data = {
                'address': addr,
                'name': info.get('name', name),
                'connected': is_connected,
                'paired': True,
                'trusted': info.get('trusted', False),
                'icon': info.get('icon', '')
            }

            # Get codec for connected devices
            if is_connected:
                codec = self.get_bluetooth_codec(addr)
                if codec:
                    device_data['codec'] = codec

            devices.append(device_data)

        return devices

    def get_discovered_devices(self):
        """Get list of discovered (not paired) devices"""
        stdout, _, _ = self._run_bluetoothctl(['devices'], timeout=5)
        all_addrs = self._parse_devices(stdout) if stdout else {}

        # Get paired addresses to exclude
        paired = {d['address'] for d in self.get_paired_devices()}

        devices = []
        for addr, name in all_addrs.items():
            if addr not in paired:
                # Filter devices zonder echte naam (lege naam of naam = MAC-adres)
                # MAC kan met : of - separators zijn (bv. AA:BB:CC of AA-BB-CC)
                name_normalized = name.upper().replace('-', ':')
                if not name or name.strip() == '' or name_normalized == addr.upper():
                    continue

                devices.append({
                    'address': addr,
                    'name': name,
                    'connected': False,
                    'paired': False
                })

        return devices

    def get_all_devices(self):
        """Get both paired and discovered devices"""
        paired = self.get_paired_devices()
        discovered = self.get_discovered_devices()
        return {
            'paired': paired,
            'discovered': discovered,
            'scanning': self._scanning
        }

    def start_scan(self, duration=30):
        """Start Bluetooth device discovery"""
        if self._scanning:
            return False, "Scan al actief"

        self._scanning = True
        self._scan_stop_event.clear()

        def scan_thread():
            try:
                print(f"[BT] Starting scan for {duration} seconds...")
                # Use --timeout flag to keep scan running
                # This runs bluetoothctl in foreground with timeout
                subprocess.run(
                    ['bluetoothctl', '--timeout', str(duration), 'scan', 'on'],
                    capture_output=True,
                    text=True,
                    timeout=duration + 5
                )
                print("[BT] Scan completed")
            except subprocess.TimeoutExpired:
                print("[BT] Scan timeout (expected)")
            except Exception as e:
                print(f"[BT] Scan error: {e}")
            finally:
                self._scanning = False
                # Ensure scan is stopped
                subprocess.run(['bluetoothctl', 'scan', 'off'], capture_output=True, timeout=3)

        self._scan_thread = Thread(target=scan_thread, daemon=True)
        self._scan_thread.start()
        return True, "Scan gestart"

    def stop_scan(self):
        """Stop Bluetooth device discovery"""
        if not self._scanning:
            return False, "Geen actieve scan"

        self._scan_stop_event.set()
        self._run_bluetoothctl(['scan off'], timeout=3)
        self._scanning = False
        return True, "Scan gestopt"

    def pair_device(self, address, pin=None):
        """Pair with a Bluetooth device, optionally with PIN"""
        if not PEXPECT_AVAILABLE:
            # Fallback: simple subprocess pairing (no PIN support)
            return self._pair_device_simple(address)

        return self._pair_device_pexpect(address, pin)

    def _pair_device_simple(self, address):
        """Simple pairing without PIN support"""
        # First, ensure device is available by running a quick scan
        # This is needed because discovered devices disappear after scan ends
        print(f"[BT] Starting discovery for pairing with {address}...")

        # Start scan in background
        scan_proc = subprocess.Popen(
            ['bluetoothctl', '--timeout', '15', 'scan', 'on'],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL
        )

        try:
            # Wait a bit for device to be discovered
            time.sleep(3)

            # Now try to pair
            stdout, stderr, rc = self._run_bluetoothctl([f'pair {address}'], timeout=30)

            if stdout and 'Pairing successful' in stdout:
                # Auto-trust for reconnection
                self._run_bluetoothctl([f'trust {address}'], timeout=5)
                return True, None

            error_msg = stderr or stdout or 'Pairing mislukt'
            if 'PIN' in error_msg or 'passkey' in error_msg.lower():
                return False, {'needs_pin': True, 'type': 'numeric'}
            if 'not available' in error_msg:
                return False, 'Apparaat niet gevonden. Probeer opnieuw te scannen.'

            return False, error_msg
        finally:
            # Stop the scan
            scan_proc.terminate()
            subprocess.run(['bluetoothctl', 'scan', 'off'], capture_output=True, timeout=3)

    def _pair_device_pexpect(self, address, pin=None):
        """Pairing with pexpect for PIN handling"""
        # First, ensure device is available by running a quick scan
        print(f"[BT] Starting discovery for pairing with {address}...")
        scan_proc = subprocess.Popen(
            ['bluetoothctl', '--timeout', '15', 'scan', 'on'],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL
        )

        try:
            # Wait a bit for device to be discovered
            time.sleep(3)

            child = pexpect.spawn('bluetoothctl', timeout=30, encoding='utf-8')
            # bluetoothctl prompt can be [bluetoothctl]> or [bluetooth]# with ANSI codes
            child.expect(r'\[.*\][>#]')
            child.sendline(f'pair {address}')

            index = child.expect([
                'Pairing successful',
                'Enter PIN code:',
                'Enter passkey',
                'Confirm passkey',
                'Failed to pair',
                'not available',
                pexpect.TIMEOUT
            ], timeout=30)

            if index == 0:  # Success
                child.sendline('exit')
                # Auto-trust for reconnection
                self._run_bluetoothctl([f'trust {address}'], timeout=5)
                return True, None

            elif index == 1 or index == 2:  # PIN needed
                if pin:
                    child.sendline(pin)
                    result_index = child.expect([
                        'Pairing successful',
                        'Failed',
                        pexpect.TIMEOUT
                    ], timeout=15)
                    child.sendline('exit')

                    if result_index == 0:
                        self._run_bluetoothctl([f'trust {address}'], timeout=5)
                        return True, None
                    else:
                        return False, 'Verkeerde PIN code'
                else:
                    child.sendline('exit')
                    return False, {'needs_pin': True, 'type': 'numeric'}

            elif index == 3:  # Confirm passkey (displayed on device)
                child.sendline('yes')
                result_index = child.expect([
                    'Pairing successful',
                    'Failed',
                    pexpect.TIMEOUT
                ], timeout=15)
                child.sendline('exit')

                if result_index == 0:
                    self._run_bluetoothctl([f'trust {address}'], timeout=5)
                    return True, None
                else:
                    return False, 'Bevestiging mislukt'

            elif index == 4 or index == 5:  # Failed
                child.sendline('exit')
                return False, 'Pairing geweigerd door apparaat'

            else:  # Timeout
                child.sendline('exit')
                return False, 'Timeout bij pairing'

        except Exception as e:
            print(f"[BT] Pexpect error: {e}")
            return False, str(e)
        finally:
            # Stop the scan
            scan_proc.terminate()
            subprocess.run(['bluetoothctl', 'scan', 'off'], capture_output=True, timeout=3)

    def connect_device(self, address):
        """Connect to a paired Bluetooth device"""
        try:
            # Use direct command execution instead of stdin pipe
            # This waits for the connection to complete
            result = subprocess.run(
                ['bluetoothctl', 'connect', address],
                capture_output=True,
                text=True,
                timeout=15
            )
            stdout = result.stdout + result.stderr

            if 'Connection successful' in stdout or 'Already connected' in stdout:
                self._save_last_device(address)
                # Audio devices will refresh automatically
                return True, None

            # Give it a moment and verify by checking actual status
            time.sleep(1)
            info = self._get_device_info(address)
            if info.get('connected'):
                self._save_last_device(address)
                # Audio devices will refresh automatically
                return True, None

            return False, 'Verbinden mislukt'
        except subprocess.TimeoutExpired:
            return False, 'Timeout bij verbinden'
        except Exception as e:
            print(f"[BT] Connect error: {e}")
            return False, str(e)

    def disconnect_device(self, address):
        """Disconnect from a Bluetooth device"""
        stdout, stderr, rc = self._run_bluetoothctl([f'disconnect {address}'], timeout=10)

        if rc == 0 or (stdout and 'Successful' in stdout):
            # Audio devices will refresh automatically
            return True, None

        return False, stderr or 'Loskoppelen mislukt'

    def forget_device(self, address):
        """Remove/unpair a Bluetooth device"""
        stdout, stderr, rc = self._run_bluetoothctl([f'remove {address}'], timeout=10)

        if rc == 0 or (stdout and 'removed' in stdout.lower()):
            # Audio devices will refresh automatically
            return True, None

        return False, stderr or 'Vergeten mislukt'

    def _save_last_device(self, address):
        """Save last connected device for auto-reconnect"""
        try:
            # Get device name
            info = self._get_device_info(address)
            name = info.get('name', 'Unknown')

            # Ensure directory exists
            os.makedirs(os.path.dirname(self._last_device_file), exist_ok=True)

            with open(self._last_device_file, 'w') as f:
                json.dump({'address': address, 'name': name}, f)

            print(f"[BT] Saved last device: {name} ({address})")
        except Exception as e:
            print(f"[BT] Error saving last device: {e}")

    def get_last_device(self):
        """Get last connected device for auto-reconnect"""
        try:
            if os.path.exists(self._last_device_file):
                with open(self._last_device_file, 'r') as f:
                    return json.load(f)
        except Exception as e:
            print(f"[BT] Error loading last device: {e}")
        return None

    def auto_reconnect(self):
        """Try to reconnect to last used Bluetooth device"""
        last = self.get_last_device()
        if not last:
            print("[BT] No last device to reconnect")
            return False

        address = last.get('address')
        name = last.get('name', 'Unknown')

        # Check if device is paired
        paired = self.get_paired_devices()
        paired_addresses = {d['address'] for d in paired}

        if address not in paired_addresses:
            print(f"[BT] Last device {name} not paired anymore")
            return False

        # Check if already connected
        for device in paired:
            if device['address'] == address and device.get('connected'):
                print(f"[BT] {name} already connected")
                return True

        # Try to connect
        print(f"[BT] Auto-reconnecting to {name}...")
        success, error = self.connect_device(address)

        if success:
            print(f"[BT] Auto-reconnected to {name}")
        else:
            print(f"[BT] Auto-reconnect failed: {error}")

        return success

    def get_power_state(self):
        """Check if Bluetooth adapter is powered on"""
        try:
            stdout, _, rc = self._run_bluetoothctl(['show'], timeout=5)
            if stdout:
                for line in stdout.split('\n'):
                    if 'Powered:' in line:
                        return 'yes' in line.lower()
            return False
        except Exception as e:
            print(f"[BT] Error getting power state: {e}")
            return False

    def set_power_state(self, state):
        """Turn Bluetooth adapter on or off"""
        try:
            cmd = 'power on' if state else 'power off'
            stdout, stderr, rc = self._run_bluetoothctl([cmd], timeout=10)
            # Verify the change
            return self.get_power_state() == state
        except Exception as e:
            print(f"[BT] Error setting power state: {e}")
            return False


# Global Bluetooth manager instance
bluetooth_manager = BluetoothManager()


def auto_reconnect_bluetooth_background():
    """Background thread to auto-reconnect Bluetooth on startup"""
    time.sleep(5)  # Wait for app startup
    print("[BT] Starting auto-reconnect check...")
    bluetooth_manager.auto_reconnect()


# Routes
@app.route('/')
def index():
    """Serve the main page"""
    if not check_credentials():
        return render_template('setup.html')

    # Try to restore session from cache if needed
    if not session.get('token_info'):
        if not restore_session_from_cache():
            # Show friendly login page instead of redirecting to external Spotify
            return render_template('login_required.html')

    # Create response with no-cache headers to prevent browser caching
    response = make_response(render_template('index.html'))
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'

    return response

@app.route('/login')
def login():
    """Initiate Spotify OAuth flow"""
    if not check_credentials():
        return redirect('/')

    # Only show account selection dialog after explicit logout
    show_dialog = request.args.get('show_dialog', 'false') == 'true'
    sp_oauth = get_spotify_oauth(show_dialog=show_dialog)
    auth_url = sp_oauth.get_authorize_url()
    return redirect(auth_url)

@app.route('/callback')
def callback():
    """Handle Spotify OAuth callback"""
    sp_oauth = get_spotify_oauth()
    code = request.args.get('code')

    if code:
        token_info = sp_oauth.get_access_token(code)
        session['token_info'] = token_info

        # Get user ID for cache
        sp = spotipy.Spotify(auth=token_info['access_token'])
        user_info = sp.current_user()
        user_id = user_info['id']
        session['user_id'] = user_id

        # Move cache from default to user-specific file
        default_cache = get_cache_path('default')
        user_cache = get_cache_path(user_id)
        if os.path.exists(default_cache) and default_cache != user_cache:
            try:
                # Rename/move the cache file
                if os.path.exists(user_cache):
                    os.remove(user_cache)  # Remove old user cache if exists
                os.rename(default_cache, user_cache)
                print(f"Moved cache from {default_cache} to {user_cache}")
            except Exception as e:
                print(f"Error moving cache file: {e}")

        return redirect('/')

    return "Error: No code provided", 400

@app.route('/logout')
def logout():
    """Clear session and delete ALL cache files"""
    # Find and delete ALL .cache-* files
    base_dir = os.path.dirname(os.path.abspath(__file__))
    cache_pattern = os.path.join(base_dir, '.cache-*')
    cache_files = glob.glob(cache_pattern)

    for cache_file in cache_files:
        try:
            os.remove(cache_file)
            print(f"Deleted cache file: {cache_file}")
        except Exception as e:
            print(f"Error deleting cache file {cache_file}: {e}")

    # Optional: invalidate Spotipy in-memory cache
    try:
        sp_oauth = get_spotify_oauth()
        if sp_oauth and hasattr(sp_oauth, 'cache_handler') and sp_oauth.cache_handler:
            sp_oauth.cache_handler.save_token_to_cache(None)
            print("Invalidated Spotipy in-memory cache")
    except Exception as e:
        print(f"Error invalidating Spotipy cache: {e}")

    # Clear Flask session
    session.clear()

    # Redirect to login with show_dialog=true to allow account switching
    response = redirect('/login?show_dialog=true')

    # Explicitly delete the session cookie using Flask config
    response.delete_cookie(
        app.config.get('SESSION_COOKIE_NAME', 'session'),
        path=app.config.get('SESSION_COOKIE_PATH', '/'),
        domain=app.config.get('SESSION_COOKIE_DOMAIN'),
        samesite=app.config.get('SESSION_COOKIE_SAMESITE', 'Lax'),
        secure=app.config.get('SESSION_COOKIE_SECURE', False),
        httponly=app.config.get('SESSION_COOKIE_HTTPONLY', True)
    )

    # Add no-cache headers to prevent caching
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'

    return response


@app.route('/api/health')
def health_check():
    """Health check endpoint for startup detection.

    Used by loader.html to detect when Flask is ready.
    Returns 200 OK with status when server is responsive.
    CORS headers allow file:// origin for local loader page.
    """
    response = jsonify({'status': 'ok', 'timestamp': time.time()})
    response.headers['Access-Control-Allow-Origin'] = '*'
    return response


# API Endpoints
@app.route('/api/playlists')
def get_playlists():
    """Get user's playlists"""
    sp = get_spotify_client()
    if not sp:
        return jsonify({'error': 'Not authenticated'}), 401

    try:
        # Fetch ALL playlists with pagination
        all_playlists = []
        results = sp.current_user_playlists(limit=50)
        all_playlists.extend(results['items'])

        # Keep fetching next pages until there are no more
        while results['next']:
            results = sp.next(results)
            all_playlists.extend(results['items'])

        # Map to response format
        items = [
            {
                'id': p['id'],
                'name': p['name'],
                'image': p['images'][0]['url'] if p['images'] else None,
                'tracks_total': p['tracks']['total']
            }
            for p in all_playlists
        ]

        # Debug logging (with error handling)
        try:
            print(f"\n=== PLAYLISTS DEBUG ===")
            print(f"Total playlists fetched: {len(items)}")
            print(f"Spotify API reported total: {results.get('total', 'unknown')}")
            print(f"Has more pages: {results.get('next') is not None}")
            print(f"\nPlaylist names:")
            for i, item in enumerate(items, 1):
                try:
                    print(f"  {i}. {item['name']}")
                except Exception as e:
                    print(f"  {i}. [Error printing name: {e}]")
            print(f"======================\n")
        except Exception as e:
            print(f"Debug logging error: {e}")

        return jsonify(items)
    except Exception as e:
        import traceback
        error_details = traceback.format_exc()
        print(f"\n!!! ERROR in get_playlists !!!")
        print(error_details)
        print(f"!!! END ERROR !!!\n")
        return jsonify({'error': str(e)}), 500

@app.route('/api/artists')
def get_artists():
    """Get user's followed artists"""
    sp = get_spotify_client()
    if not sp:
        return jsonify({'error': 'Not authenticated'}), 401

    try:
        # Fetch ALL followed artists with cursor-based pagination
        all_artists = []
        results = sp.current_user_followed_artists(limit=50)
        all_artists.extend(results['artists']['items'])

        # Keep fetching next pages until there are no more
        while results['artists']['cursors'] and results['artists']['cursors'].get('after'):
            results = sp.current_user_followed_artists(
                limit=50,
                after=results['artists']['cursors']['after']
            )
            all_artists.extend(results['artists']['items'])

        # Map to response format
        items = [
            {
                'id': a['id'],
                'name': a['name'],
                'image': a['images'][0]['url'] if a['images'] else None
            }
            for a in all_artists
        ]

        print(f"Fetched {len(items)} followed artists")
        return jsonify(items)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/artist/<artist_id>/top-tracks')
def get_artist_top_tracks(artist_id):
    """Get top tracks for a specific artist (max 10)"""
    sp = get_spotify_client()
    if not sp:
        return jsonify({'error': 'Not authenticated'}), 401

    try:
        # Get top tracks (Spotify returns max 10)
        results = sp.artist_top_tracks(artist_id, country='NL')

        tracks = [
            {
                'id': track['id'],
                'uri': track['uri'],
                'name': track['name'],
                'artist': ', '.join([artist['name'] for artist in track['artists']]),
                'album': track['album']['name'],
                'duration_ms': track['duration_ms'],
                'image': track['album']['images'][0]['url'] if track['album']['images'] else None
            }
            for track in results['tracks']
        ]
        return jsonify(tracks)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/artist/<artist_id>/albums')
def get_artist_albums(artist_id):
    """Get albums from a specific artist (only full albums, no singles)"""
    sp = get_spotify_client()
    if not sp:
        return jsonify({'error': 'Not authenticated'}), 401

    try:
        # Get only full albums (no singles/EPs)
        results = sp.artist_albums(artist_id, album_type='album', country='NL', limit=50)

        albums = [
            {
                'id': album['id'],
                'uri': album['uri'],
                'name': album['name'],
                'image': album['images'][0]['url'] if album['images'] else None,
                'release_date': album['release_date'],
                'total_tracks': album['total_tracks']
            }
            for album in results['items']
        ]

        print(f"Fetched {len(albums)} albums for artist {artist_id}")
        return jsonify(albums)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/album/<album_id>/tracks')
def get_album_tracks(album_id):
    """Get tracks from a specific album"""
    sp = get_spotify_client()
    if not sp:
        return jsonify({'error': 'Not authenticated'}), 401

    try:
        # Get album info for artwork
        album_info = sp.album(album_id)
        album_image = album_info['images'][0]['url'] if album_info['images'] else None
        album_uri = album_info['uri']

        # Get album tracks
        results = sp.album_tracks(album_id)

        tracks = [
            {
                'id': track['id'],
                'uri': track['uri'],
                'name': track['name'],
                'artist': ', '.join([artist['name'] for artist in track['artists']]),
                'album': album_info['name'],
                'album_uri': album_uri,
                'duration_ms': track['duration_ms'],
                'image': album_image,
                'track_number': track['track_number'],
                'release_date': album_info.get('release_date', '')
            }
            for track in results['items']
        ]

        return jsonify(tracks)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/playlist/<playlist_id>')
def get_playlist_tracks(playlist_id):
    """Get tracks from a specific playlist"""
    sp = get_spotify_client()
    if not sp:
        return jsonify({'error': 'Not authenticated'}), 401

    try:
        results = sp.playlist_items(playlist_id)
        tracks = [
            {
                'id': item['track']['id'],
                'uri': item['track']['uri'],
                'name': item['track']['name'],
                'artist': ', '.join([artist['name'] for artist in item['track']['artists']]),
                'album': item['track']['album']['name'],
                'duration_ms': item['track']['duration_ms'],
                'image': item['track']['album']['images'][0]['url'] if item['track']['album']['images'] else None
            }
            for item in results['items']
            if item['track']  # Skip None tracks
        ]
        return jsonify(tracks)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/current')
def get_current_track():
    """Get currently playing track"""
    global _cached_current_track

    # Bij cooldown: return cached data om API niet te overbelasten
    if is_api_in_cooldown() and _cached_current_track is not None:
        return jsonify(_cached_current_track)

    sp = get_spotify_client()
    if not sp:
        return jsonify({'error': 'Not authenticated'}), 401

    try:
        current = sp.current_playback()
        if not current or not current.get('item'):
            response_data = {'playing': False}
            _cached_current_track = response_data
            return jsonify(response_data)

        track = current['item']
        device = current.get('device', {})

        # Sanitize progress_ms - kan negatief zijn bij sync problemen
        duration_ms = track.get('duration_ms', 0)
        progress_ms = current.get('progress_ms', 0)
        if progress_ms is None or progress_ms < 0:
            progress_ms = 0
        if duration_ms > 0 and progress_ms > duration_ms:
            progress_ms = duration_ms

        response_data = {
            'playing': current['is_playing'],
            'shuffle': current.get('shuffle_state', False),
            'volume_percent': device.get('volume_percent', 0),
            'track': {
                'id': track['id'],
                'name': track['name'],
                'artist': ', '.join([artist['name'] for artist in track['artists']]),
                'album': track['album']['name'],
                'image': track['album']['images'][0]['url'] if track['album']['images'] else None,
                'duration_ms': duration_ms,
                'progress_ms': progress_ms
            }
        }
        _cached_current_track = response_data
        return jsonify(response_data)
    except spotipy.exceptions.SpotifyException as e:
        msg, status = handle_spotify_error(e)
        # Bij error: return cached data als beschikbaar
        if _cached_current_track is not None:
            return jsonify(_cached_current_track)
        return jsonify({'error': msg}), status
    except Exception as e:
        print(f"[Unexpected Error] /api/current: {e}")
        if _cached_current_track is not None:
            return jsonify(_cached_current_track)
        return jsonify({'error': t('error.unknown')}), 500

@app.route('/api/play', methods=['POST'])
@spotify_playback_action
def play(sp):
    """Resume playback"""
    sp.start_playback()
    return jsonify({'success': True})

@app.route('/api/pause', methods=['POST'])
@spotify_playback_action
def pause(sp):
    """Pause playback"""
    sp.pause_playback()
    return jsonify({'success': True})

@app.route('/api/next', methods=['POST'])
@spotify_playback_action
def next_track(sp):
    """Skip to next track"""
    sp.next_track()
    return jsonify({'success': True})

@app.route('/api/previous', methods=['POST'])
@spotify_playback_action
def previous_track(sp):
    """Skip to previous track"""
    sp.previous_track()
    return jsonify({'success': True})

@app.route('/api/play-track', methods=['POST'])
@spotify_playback_action
def play_track(sp):
    """Play a specific track"""
    data = request.get_json()
    track_uri = data.get('uri')
    playlist_id = data.get('playlist_id')
    album_id = data.get('album_id')

    if not track_uri:
        return jsonify({'error': 'No track URI provided'}), 400

    if playlist_id:
        # Play from playlist context with offset to specific track
        context_uri = f'spotify:playlist:{playlist_id}'
        sp.start_playback(context_uri=context_uri, offset={'uri': track_uri})
    elif album_id:
        # Play from album context with offset to specific track
        context_uri = f'spotify:album:{album_id}'
        sp.start_playback(context_uri=context_uri, offset={'uri': track_uri})
    else:
        # Check for track URIs list (e.g., artist top tracks)
        track_uris = data.get('track_uris')
        if track_uris:
            sp.start_playback(uris=track_uris)
        else:
            # Fallback: play only this track (backwards compatible)
            sp.start_playback(uris=[track_uri])
    return jsonify({'success': True})

@app.route('/api/shuffle', methods=['POST'])
@spotify_playback_action
def toggle_shuffle(sp):
    """Toggle shuffle mode"""
    data = request.get_json()
    shuffle_state = data.get('state', False)
    sp.shuffle(shuffle_state)
    return jsonify({'success': True, 'shuffle': shuffle_state})

@app.route('/api/volume', methods=['POST'])
@spotify_playback_action
def set_volume(sp):
    """Set playback volume"""
    data = request.get_json()
    volume_percent = data.get('volume_percent')

    if volume_percent is None:
        return jsonify({'error': 'No volume_percent provided'}), 400

    # Ensure volume is between 0 and 100
    volume_percent = max(0, min(100, int(volume_percent)))
    sp.volume(volume_percent)
    return jsonify({'success': True, 'volume_percent': volume_percent})

@app.route('/api/seek', methods=['POST'])
@spotify_playback_action
def seek_track(sp):
    """Seek to position in current track"""
    data = request.get_json()
    position_ms = data.get('position_ms')

    if position_ms is None:
        return jsonify({'error': 'No position_ms provided'}), 400

    position_ms = max(0, int(position_ms))
    sp.seek_track(position_ms)
    return jsonify({'success': True, 'position_ms': position_ms})

@app.route('/api/devices')
def get_devices():
    """Get available Spotify devices"""
    sp = get_spotify_client()
    if not sp:
        return jsonify({'error': t('error.not_logged_in')}), 401

    try:
        devices_response = sp.devices()

        # Filter devices based on SPOTIFY_DEVICE_NAME if set
        device_name_filter = os.getenv('SPOTIFY_DEVICE_NAME', '').strip()
        if device_name_filter:
            filtered_devices = [
                d for d in devices_response.get('devices', [])
                if device_name_filter.lower() in d['name'].lower()
            ]
            devices_response['devices'] = filtered_devices

        return jsonify(devices_response)
    except spotipy.exceptions.SpotifyException as e:
        msg, status = handle_spotify_error(e)
        return jsonify({'error': msg}), status
    except Exception as e:
        print(f"[Unexpected Error] /api/devices: {e}")
        return jsonify({'error': t('error.unknown')}), 500

@app.route('/api/transfer-playback', methods=['POST'])
def transfer_playback():
    """Transfer playback to a device"""
    sp = get_spotify_client()
    if not sp:
        return jsonify({'error': t('error.not_logged_in')}), 401

    data = request.get_json()
    device_id = data.get('device_id')

    if not device_id:
        return jsonify({'error': t('error.device_not_found')}), 400

    try:
        sp.transfer_playback(device_id, force_play=True)
        return jsonify({'success': True})
    except spotipy.exceptions.SpotifyException as e:
        msg, status = handle_spotify_error(e)
        return jsonify({'error': msg}), status
    except Exception as e:
        print(f"[Unexpected Error] /api/transfer-playback: {e}")
        return jsonify({'error': t('error.unknown')}), 500

@app.route('/api/transfer-playback-local', methods=['POST'])
def transfer_playback_local():
    """Transfer playback to a locally discovered mDNS device.

    This attempts to transfer playback using the device_id obtained from
    the ZeroConf getInfo endpoint, even if the device is not (yet) visible
    in the Spotify Web API.
    """
    sp = get_spotify_client()
    if not sp:
        return jsonify({'error': 'Not authenticated'}), 401

    data = request.get_json()
    device_id = data.get('device_id')

    if not device_id:
        return jsonify({'error': 'No device ID provided'}), 400

    try:
        # Try direct transfer with the mDNS device_id
        sp.transfer_playback(device_id, force_play=True)
        return jsonify({'success': True, 'method': 'direct_transfer'})
    except spotipy.exceptions.SpotifyException as e:
        error_str = str(e).lower()
        if 'device not found' in error_str or 'not found' in error_str:
            # Device not recognized by Spotify - needs ZeroConf activation
            return jsonify({
                'success': False,
                'error': 'Device niet gevonden. ZeroConf activatie nodig.',
                'needs_activation': True
            }), 404
        return jsonify({'error': str(e)}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/devices/local/activate', methods=['POST'])
def activate_local_device():
    """Activate a local Spotify Connect device via ZeroConf addUser flow.

    Improved flow:
    1. Check Spotify API voor device (op naam)
       - Gevonden + actief → Direct return (geen actie nodig)
       - Gevonden + inactief → Direct transfer (geen activatie nodig)
       - Niet gevonden → Stap 2
    2. ZeroConf activatie
    3. Poll API (5x met 1s interval)
    4. Transfer playback met Spotify device_id
    """
    sp = get_spotify_client()
    if not sp:
        return jsonify({'error': 'Niet ingelogd bij Spotify'}), 401

    data = request.get_json()
    ip = data.get('ip')
    port = data.get('port')
    device_name = data.get('device_name')  # Voor matching

    if not ip or not port:
        return jsonify({'error': 'IP en poort zijn verplicht'}), 400

    if not device_name:
        return jsonify({'error': 'device_name is verplicht'}), 400

    try:
        # STAP 1: Check of device al in Spotify API staat
        print(f"[ZeroConf] Step 1: Checking if '{device_name}' already in Spotify API...")
        devices_response = sp.devices()
        existing_device = find_device_by_name(devices_response.get('devices', []), device_name)

        if existing_device:
            spotify_device_id = existing_device.get('id')
            is_active = existing_device.get('is_active', False)

            if is_active:
                # Device gevonden en al actief - geen actie nodig
                print(f"[ZeroConf] Device '{device_name}' already active, nothing to do")
                return jsonify({
                    'success': True,
                    'message': f'{device_name} is al actief',
                    'spotify_device_id': spotify_device_id,
                    'skipped_activation': True
                })
            else:
                # Device gevonden maar inactief - direct transfer (skip activatie)
                print(f"[ZeroConf] Device '{device_name}' found but inactive, transferring...")
                try:
                    sp.transfer_playback(spotify_device_id, force_play=True)
                    print(f"[ZeroConf] Transfer successful to {device_name}")
                    return jsonify({
                        'success': True,
                        'message': f'Playback overgedragen naar {device_name}',
                        'spotify_device_id': spotify_device_id,
                        'skipped_activation': True
                    })
                except Exception as e:
                    print(f"[ZeroConf] Transfer failed, will try activation: {e}")
                    # Ga door naar activatie als transfer faalt

        # STAP 2: ZeroConf activatie nodig
        if not ZEROCONF_ACTIVATION_AVAILABLE:
            return jsonify({
                'error': 'ZeroConf activatie niet beschikbaar (cryptography niet geinstalleerd)'
            }), 500

        credentials_path = os.path.expanduser("~/.cache/librespot/credentials.json")
        if not os.path.exists(credentials_path):
            return jsonify({
                'error': 'Geen librespot credentials gevonden. Start librespot eerst handmatig.'
            }), 400

        print(f"[ZeroConf] Step 2: Activating device via ZeroConf...")
        client = SpotifyZeroConf(credentials_path=credentials_path)
        result = client.activate_device(ip, int(port))

        if result.get('status') != 101:
            return jsonify({
                'success': False,
                'error': f"Activatie mislukt: {result.get('statusString')}"
            }), 400

        print(f"[ZeroConf] Activation successful (status 101)")

        # STAP 3: Poll API (3x met 2s interval, cooldown aware)
        print(f"[ZeroConf] Step 3: Polling Spotify API for device...")
        spotify_device_id = None

        for attempt in range(3):
            time.sleep(2)

            # Skip API call als we in cooldown zitten
            if is_api_in_cooldown():
                print(f"[ZeroConf] API in cooldown, skipping poll {attempt + 1}/3")
                continue

            print(f"[ZeroConf] Poll attempt {attempt + 1}/3...")

            try:
                devices_response = sp.devices()
                found_device = find_device_by_name(devices_response.get('devices', []), device_name)

                if found_device:
                    spotify_device_id = found_device.get('id')
                    print(f"[ZeroConf] Found device: {device_name} -> {spotify_device_id}")
                    break
            except Exception as e:
                print(f"[ZeroConf] Error fetching devices: {e}")

        # STAP 4: Transfer playback
        if spotify_device_id:
            try:
                sp.transfer_playback(spotify_device_id, force_play=True)
                print(f"[ZeroConf] Step 4: Transfer successful to {device_name}")
                return jsonify({
                    'success': True,
                    'message': f'Device geactiveerd en playback overgedragen naar {device_name}',
                    'spotify_device_id': spotify_device_id
                })
            except Exception as e:
                print(f"[ZeroConf] Transfer failed: {e}")
                return jsonify({
                    'success': True,
                    'message': 'Device geactiveerd, maar transfer mislukt',
                    'error': str(e),
                    'spotify_device_id': spotify_device_id
                })
        else:
            return jsonify({
                'success': True,
                'message': 'Device geactiveerd, maar niet gevonden in Spotify na 3 pogingen',
                'warning': 'Probeer handmatig te transferen'
            })

    except ValueError as e:
        return jsonify({'success': False, 'error': str(e)}), 400
    except Exception as e:
        print(f"[ZeroConf] Activation error: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


# System control endpoints
@app.route('/api/system/shutdown', methods=['POST'])
def system_shutdown():
    """Shutdown the Raspberry Pi"""
    try:
        subprocess.Popen(['sudo', 'poweroff'])
        return jsonify({'success': True, 'message': t('system.shutdown')})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/system/reboot', methods=['POST'])
def system_reboot():
    """Reboot the Raspberry Pi"""
    try:
        subprocess.Popen(['sudo', 'reboot'])
        return jsonify({'success': True, 'message': t('system.reboot')})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/audio/devices')
def get_audio_devices_endpoint():
    """Get available audio output devices (cached)"""
    try:
        devices = get_audio_devices()
        return jsonify({'devices': devices})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/audio/devices/refresh', methods=['POST'])
def refresh_audio_devices_endpoint():
    """Manually refresh audio devices cache"""
    try:
        # Audio devices will refresh automatically
        devices = get_audio_devices()
        return jsonify({'devices': devices, 'refreshed': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/audio/output', methods=['POST'])
def set_audio_output():
    """Switch audio output"""
    data = request.get_json()
    device_id = data.get('device_id')

    if not device_id:
        return jsonify({'error': 'No device_id provided'}), 400

    try:
        success = set_audio_device(device_id)

        if success:
            # Wait for system to update the default device
            time.sleep(0.15)

            # Reset volume to safe default when switching devices
            safe_volume = get_default_volume_setting()
            set_system_volume(safe_volume)
            print(f"[Audio] Switched to {device_id}, volume reset to {safe_volume}%")

            return jsonify({'success': True, 'device_id': device_id, 'volume': safe_volume})
        else:
            return jsonify({'error': 'Failed to set audio device. Is AudioDeviceCmdlets installed?'}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ============ System Audio Volume ============

def get_volume_settings():
    """Get the configured volume settings from settings file."""
    config_file = os.path.expanduser('~/.config/spotify-player/settings.json')
    defaults = {'default_volume': 50, 'max_volume': 80}
    try:
        if os.path.exists(config_file):
            with open(config_file, 'r') as f:
                settings = json.load(f)
                return {
                    'default_volume': settings.get('default_volume', 50),
                    'max_volume': settings.get('max_volume', 80)
                }
    except Exception as e:
        print(f"[Audio] Error reading settings: {e}")
    return defaults


def get_default_volume_setting():
    """Get the configured default/safe volume from settings file."""
    return get_volume_settings()['default_volume']


def get_max_volume_setting():
    """Get the configured max volume from settings file."""
    return get_volume_settings()['max_volume']


def set_system_volume(volume_percent):
    """Set system audio volume for default sink."""
    try:
        volume = max(0, min(100, int(volume_percent)))
        subprocess.run(['pactl', 'set-sink-volume', '@DEFAULT_SINK@', f'{volume}%'],
                      capture_output=True, timeout=5)
        return True
    except Exception as e:
        print(f"[Audio] Error setting volume: {e}")
        return False


def get_system_volume():
    """Get current system audio volume for default sink."""
    try:
        result = subprocess.run(['pactl', 'get-sink-volume', '@DEFAULT_SINK@'],
                               capture_output=True, text=True, timeout=5)
        # Parse "Volume: front-left: 32768 /  50% / ..."
        match = re.search(r'(\d+)%', result.stdout)
        if match:
            return int(match.group(1))
    except Exception as e:
        print(f"[Audio] Error getting volume: {e}")
    return 50  # Default fallback


@app.route('/api/audio/volume', methods=['GET', 'POST'])
def audio_volume():
    """Get or set system audio volume for default sink.

    Volume is scaled: slider shows 0-100%, but actual volume is 0-max_volume.
    This way the user doesn't see the limit - slider at 100% = max_volume.
    """
    max_vol = get_max_volume_setting()

    if request.method == 'GET':
        actual_volume = get_system_volume()
        # Scale actual volume to slider value (0-100)
        slider_value = int((actual_volume / max_vol) * 100) if max_vol > 0 else 0
        slider_value = min(100, slider_value)  # Cap at 100
        return jsonify({'volume': slider_value})

    # POST: Set volume - scale slider value (0-100) to actual volume (0-max_vol)
    data = request.get_json()
    slider_value = max(0, min(100, int(data.get('volume', 50))))
    actual_volume = int((slider_value / 100) * max_vol)

    if set_system_volume(actual_volume):
        return jsonify({'success': True, 'volume': slider_value})
    else:
        return jsonify({'error': t('audio.volume_failed')}), 500


@app.route('/api/settings/volume', methods=['GET', 'POST'])
def volume_settings():
    """Get or set volume settings (default and max)."""
    config_dir = os.path.expanduser('~/.config/spotify-player')
    config_file = os.path.join(config_dir, 'settings.json')

    if request.method == 'GET':
        settings = get_volume_settings()
        return jsonify(settings)

    # POST: Save volume settings
    data = request.get_json()

    try:
        # Ensure config directory exists
        os.makedirs(config_dir, exist_ok=True)

        # Read existing settings or create new
        settings = {}
        if os.path.exists(config_file):
            with open(config_file, 'r') as f:
                settings = json.load(f)

        # Update default_volume if provided
        if 'default_volume' in data:
            settings['default_volume'] = max(10, min(80, int(data['default_volume'])))

        # Update max_volume if provided
        if 'max_volume' in data:
            settings['max_volume'] = max(30, min(100, int(data['max_volume'])))

        # Ensure default doesn't exceed max
        if settings.get('default_volume', 50) > settings.get('max_volume', 80):
            settings['default_volume'] = settings['max_volume']

        with open(config_file, 'w') as f:
            json.dump(settings, f)

        return jsonify({
            'success': True,
            'default_volume': settings.get('default_volume', 50),
            'max_volume': settings.get('max_volume', 80)
        })
    except Exception as e:
        print(f"[Audio] Error saving volume settings: {e}")
        return jsonify({'error': str(e)}), 500


# Keep old endpoint for backwards compatibility
@app.route('/api/settings/default-volume', methods=['GET', 'POST'])
def default_volume_setting():
    """Legacy endpoint - redirects to volume_settings."""
    return volume_settings()


@app.route('/api/settings/language', methods=['GET', 'POST'])
def language_settings():
    """Get or set user language preference (en/nl)."""
    if request.method == 'GET':
        return jsonify({'language': get_user_language()})

    # POST: Set language
    data = request.get_json()
    lang = data.get('language', 'en')

    # Validate language
    if lang not in ['en', 'nl']:
        lang = 'en'

    session['language'] = lang
    return jsonify({'language': lang, 'success': True})


@app.route('/api/spotify-connect/local')
def get_local_spotify_devices():
    """Get Spotify Connect devices discovered via mDNS on local network"""
    try:
        devices = get_spotify_connect_devices()

        # Enrich with device info from ZeroConf API if available
        enriched_devices = []
        for device in devices:
            device_data = {
                'name': device['name'],
                'ip': device['addresses'][0] if device.get('addresses') else None,
                'port': device.get('port'),
                'type': 'local',  # Mark as locally discovered
                'is_active': False  # Local devices need activation
            }

            # Try to get additional info from device's ZeroConf endpoint
            zc_info = get_device_info_from_zeroconf(device)
            if zc_info:
                device_data['device_id'] = zc_info.get('deviceID')
                device_data['remote_name'] = zc_info.get('remoteName', device['name'])
                device_data['device_type'] = zc_info.get('deviceType')
                device_data['brand'] = zc_info.get('brandDisplayName')
                device_data['model'] = zc_info.get('modelDisplayName')

            enriched_devices.append(device_data)

        return jsonify({'devices': enriched_devices})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# =============================================================================
# PIN Verification
# =============================================================================

@app.route('/api/verify-pin', methods=['POST'])
def verify_pin():
    """Verify PIN for protected settings tabs"""
    data = request.get_json()
    pin = data.get('pin', '')
    correct_pin = os.getenv('SETTINGS_PIN', '123456')

    if pin == correct_pin:
        return jsonify({'success': True})
    return jsonify({'success': False, 'error': t('pin.incorrect')}), 401


# =============================================================================
# Bluetooth API Endpoints
# =============================================================================

@app.route('/api/bluetooth/devices')
def get_bluetooth_devices_endpoint():
    """Get all Bluetooth devices (paired + discovered)"""
    if not bluetooth_manager:
        return jsonify({'error': t('bt.not_available')}), 503

    try:
        data = bluetooth_manager.get_all_devices()
        return jsonify(data)
    except Exception as e:
        print(f"[BT] Error getting devices: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/bluetooth/scan', methods=['POST'])
def bluetooth_scan_endpoint():
    """Start or stop Bluetooth device scanning"""
    if not bluetooth_manager:
        return jsonify({'error': t('bt.not_available')}), 503

    data = request.get_json() or {}
    action = data.get('action', 'start')
    duration = data.get('duration', 30)

    try:
        if action == 'start':
            success, message = bluetooth_manager.start_scan(duration)
        else:
            success, message = bluetooth_manager.stop_scan()

        return jsonify({
            'success': success,
            'message': message,
            'scanning': bluetooth_manager._scanning
        })
    except Exception as e:
        print(f"[BT] Scan error: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/bluetooth/pair', methods=['POST'])
def bluetooth_pair_endpoint():
    """Pair with a Bluetooth device"""
    if not bluetooth_manager:
        return jsonify({'error': t('bt.not_available')}), 503

    data = request.get_json()
    if not data or 'address' not in data:
        return jsonify({'error': t('bt.address_required')}), 400

    address = data['address']
    pin = data.get('pin')

    try:
        success, result = bluetooth_manager.pair_device(address, pin)

        if success:
            return jsonify({
                'success': True,
                'message': t('bt.pair_success')
            })
        elif isinstance(result, dict) and result.get('needs_pin'):
            return jsonify({
                'success': False,
                'needs_pin': True,
                'pin_type': result.get('type', 'numeric')
            }), 202
        else:
            return jsonify({
                'success': False,
                'error': result or t('bt.pair_failed')
            }), 400
    except Exception as e:
        print(f"[BT] Pair error: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/bluetooth/connect', methods=['POST'])
def bluetooth_connect_endpoint():
    """Connect to a paired Bluetooth device"""
    if not bluetooth_manager:
        return jsonify({'error': t('bt.not_available')}), 503

    data = request.get_json()
    if not data or 'address' not in data:
        return jsonify({'error': t('bt.address_required')}), 400

    address = data['address']

    try:
        success, error = bluetooth_manager.connect_device(address)

        if success:
            return jsonify({
                'success': True,
                'message': t('bt.connect_success')
            })
        else:
            return jsonify({
                'success': False,
                'error': error or t('bt.connect_failed')
            }), 400
    except Exception as e:
        print(f"[BT] Connect error: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/bluetooth/disconnect', methods=['POST'])
def bluetooth_disconnect_endpoint():
    """Disconnect from a Bluetooth device"""
    if not bluetooth_manager:
        return jsonify({'error': t('bt.not_available')}), 503

    data = request.get_json()
    if not data or 'address' not in data:
        return jsonify({'error': t('bt.address_required')}), 400

    address = data['address']

    try:
        success, error = bluetooth_manager.disconnect_device(address)

        if success:
            return jsonify({
                'success': True,
                'message': t('bt.disconnect_success')
            })
        else:
            return jsonify({
                'success': False,
                'error': error or t('bt.disconnect_failed')
            }), 400
    except Exception as e:
        print(f"[BT] Disconnect error: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/bluetooth/forget', methods=['DELETE'])
def bluetooth_forget_endpoint():
    """Remove/unpair a Bluetooth device"""
    if not bluetooth_manager:
        return jsonify({'error': t('bt.not_available')}), 503

    data = request.get_json()
    if not data or 'address' not in data:
        return jsonify({'error': t('bt.address_required')}), 400

    address = data['address']

    try:
        success, error = bluetooth_manager.forget_device(address)

        if success:
            return jsonify({
                'success': True,
                'message': t('bt.forget_success')
            })
        else:
            return jsonify({
                'success': False,
                'error': error or t('bt.forget_failed')
            }), 400
    except Exception as e:
        print(f"[BT] Forget error: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/bluetooth/power', methods=['GET', 'POST'])
def bluetooth_power_endpoint():
    """Get or set Bluetooth adapter power state"""
    if not bluetooth_manager:
        return jsonify({'error': t('bt.not_available')}), 503

    if request.method == 'GET':
        try:
            powered = bluetooth_manager.get_power_state()
            return jsonify({'powered': powered})
        except Exception as e:
            print(f"[BT] Power state error: {e}")
            return jsonify({'error': str(e)}), 500

    # POST - set power state
    data = request.get_json()
    if not data or 'powered' not in data:
        return jsonify({'error': 'powered parameter required'}), 400

    try:
        state = bool(data['powered'])
        success = bluetooth_manager.set_power_state(state)

        if success:
            return jsonify({
                'success': True,
                'powered': state,
                'message': t('bt.power_on') if state else t('bt.power_off')
            })
        else:
            return jsonify({
                'success': False,
                'error': t('bt.power_failed')
            }), 400
    except Exception as e:
        print(f"[BT] Power set error: {e}")
        return jsonify({'error': str(e)}), 500


# =============================================================================
# System Update Endpoints
# =============================================================================

def get_github_repo_info():
    """Extract owner and repo from git remote URL"""
    try:
        result = subprocess.run(
            ['git', 'remote', 'get-url', 'origin'],
            capture_output=True, text=True, timeout=10,
            cwd=os.path.dirname(os.path.abspath(__file__))
        )
        if result.returncode == 0:
            url = result.stdout.strip()
            # Parse https://github.com/owner/repo.git or git@github.com:owner/repo.git
            if 'github.com' in url:
                if url.startswith('git@'):
                    # git@github.com:owner/repo.git
                    match = re.search(r'github\.com[:/]([^/]+)/([^/]+?)(?:\.git)?$', url)
                else:
                    # https://github.com/owner/repo.git
                    match = re.search(r'github\.com/([^/]+)/([^/]+?)(?:\.git)?$', url)
                if match:
                    return match.group(1), match.group(2)
    except Exception as e:
        print(f"[Update] Error getting repo info: {e}")
    return None, None


def get_current_version():
    """Get current version from git tag or version file"""
    app_dir = os.path.dirname(os.path.abspath(__file__))
    version_file = os.path.expanduser('~/.config/spotify-player/version.txt')

    # Try version file first
    if os.path.exists(version_file):
        try:
            with open(version_file, 'r') as f:
                return f.read().strip()
        except:
            pass

    # Fallback to git describe
    try:
        result = subprocess.run(
            ['git', 'describe', '--tags', '--abbrev=0'],
            capture_output=True, text=True, timeout=10, cwd=app_dir
        )
        if result.returncode == 0:
            return result.stdout.strip()
    except:
        pass

    # Fallback to commit hash
    try:
        result = subprocess.run(
            ['git', 'rev-parse', '--short', 'HEAD'],
            capture_output=True, text=True, timeout=10, cwd=app_dir
        )
        if result.returncode == 0:
            return result.stdout.strip()
    except:
        pass

    return 'onbekend'


def save_version(version):
    """Save version to file"""
    config_dir = os.path.expanduser('~/.config/spotify-player')
    os.makedirs(config_dir, exist_ok=True)
    version_file = os.path.join(config_dir, 'version.txt')
    with open(version_file, 'w') as f:
        f.write(version)


@app.route('/api/system/check-update', methods=['GET'])
def check_update():
    """Check if a newer version is available on GitHub"""
    owner, repo = get_github_repo_info()
    if not owner or not repo:
        return jsonify({
            'error': 'Kan repository informatie niet ophalen'
        }), 500

    current_version = get_current_version()

    try:
        # Fetch latest release from GitHub API
        response = requests.get(
            f'https://api.github.com/repos/{owner}/{repo}/releases/latest',
            headers={'Accept': 'application/vnd.github.v3+json'},
            timeout=10
        )

        if response.status_code == 404:
            # No releases yet, fall back to commit comparison
            return check_update_by_commits(current_version)

        response.raise_for_status()
        release_data = response.json()

        latest_version = release_data.get('tag_name', 'onbekend')
        release_notes = release_data.get('body', '')
        release_name = release_data.get('name', latest_version)

        # Compare versions
        available = latest_version != current_version and latest_version != 'onbekend'

        return jsonify({
            'available': available,
            'current_version': current_version,
            'latest_version': latest_version,
            'release_name': release_name,
            'release_notes': release_notes
        })

    except requests.RequestException as e:
        print(f"[Update] GitHub API error: {e}")
        # Fallback to commit comparison
        return check_update_by_commits(current_version)


def check_update_by_commits(current_version):
    """Fallback: check for updates by comparing git commits"""
    app_dir = os.path.dirname(os.path.abspath(__file__))

    try:
        # Fetch latest from origin
        subprocess.run(
            ['git', 'fetch', 'origin', 'main'],
            capture_output=True, timeout=30, cwd=app_dir
        )

        # Get local HEAD
        local_result = subprocess.run(
            ['git', 'rev-parse', 'HEAD'],
            capture_output=True, text=True, timeout=10, cwd=app_dir
        )
        local_hash = local_result.stdout.strip() if local_result.returncode == 0 else ''

        # Get origin/main HEAD
        remote_result = subprocess.run(
            ['git', 'rev-parse', 'origin/main'],
            capture_output=True, text=True, timeout=10, cwd=app_dir
        )
        remote_hash = remote_result.stdout.strip() if remote_result.returncode == 0 else ''

        available = local_hash != remote_hash and local_hash and remote_hash

        return jsonify({
            'available': available,
            'current_version': current_version,
            'latest_version': remote_hash[:7] if available else current_version,
            'release_name': 'Nieuwe versie beschikbaar' if available else '',
            'release_notes': ''
        })

    except Exception as e:
        print(f"[Update] Git comparison error: {e}")
        return jsonify({
            'available': False,
            'current_version': current_version,
            'latest_version': current_version,
            'release_name': '',
            'release_notes': '',
            'error': 'Kon niet controleren op updates'
        })


@app.route('/api/system/update', methods=['POST'])
def system_update():
    """Perform system update: git pull, pip install, restart service"""
    app_dir = os.path.dirname(os.path.abspath(__file__))

    # Get target version from request (optional)
    data = request.get_json() or {}
    target_version = data.get('version')

    try:
        # Save current commit for rollback
        current_commit_result = subprocess.run(
            ['git', 'rev-parse', 'HEAD'],
            capture_output=True, text=True, timeout=10, cwd=app_dir
        )
        if current_commit_result.returncode != 0:
            return jsonify({'error': 'Kon huidige versie niet bepalen'}), 500

        rollback_commit = current_commit_result.stdout.strip()

        # Fetch all tags and updates
        fetch_result = subprocess.run(
            ['git', 'fetch', '--tags', 'origin', 'main'],
            capture_output=True, text=True, timeout=60, cwd=app_dir
        )
        if fetch_result.returncode != 0:
            return jsonify({
                'error': 'Git fetch mislukt',
                'details': fetch_result.stderr
            }), 500

        # Checkout specific version or pull latest
        if target_version and target_version.startswith('v'):
            # Checkout specific tag
            checkout_result = subprocess.run(
                ['git', 'checkout', target_version],
                capture_output=True, text=True, timeout=30, cwd=app_dir
            )
            if checkout_result.returncode != 0:
                return jsonify({
                    'error': f'Git checkout naar {target_version} mislukt',
                    'details': checkout_result.stderr
                }), 500
        else:
            # Reset to origin/main
            reset_result = subprocess.run(
                ['git', 'reset', '--hard', 'origin/main'],
                capture_output=True, text=True, timeout=30, cwd=app_dir
            )
            if reset_result.returncode != 0:
                return jsonify({
                    'error': 'Git reset mislukt',
                    'details': reset_result.stderr
                }), 500

        # Install Python dependencies
        pip_result = subprocess.run(
            ['pip', 'install', '-r', 'requirements.txt', '--break-system-packages'],
            capture_output=True, text=True, timeout=300, cwd=app_dir
        )
        if pip_result.returncode != 0:
            # Rollback on pip failure
            print(f"[Update] Pip install failed, rolling back to {rollback_commit}")
            subprocess.run(
                ['git', 'reset', '--hard', rollback_commit],
                capture_output=True, timeout=30, cwd=app_dir
            )
            return jsonify({
                'error': 'Pip install mislukt - wijzigingen teruggedraaid',
                'details': pip_result.stderr
            }), 500

        # Get version from git after checkout (ignore cached version.txt)
        if target_version:
            new_version = target_version
        else:
            result = subprocess.run(
                ['git', 'describe', '--tags', '--abbrev=0'],
                capture_output=True, text=True, timeout=10, cwd=app_dir
            )
            new_version = result.stdout.strip() if result.returncode == 0 else 'unknown'
        save_version(new_version)

        # Schedule service restart (give time for response to be sent)
        def restart_service():
            time.sleep(1)
            subprocess.run(['systemctl', '--user', 'restart', 'spotify-player'])

        restart_thread = Thread(target=restart_service, daemon=True)
        restart_thread.start()

        return jsonify({
            'success': True,
            'message': 'Update geïnstalleerd, app wordt herstart...',
            'version': new_version
        })

    except subprocess.TimeoutExpired:
        return jsonify({'error': 'Update timeout - probeer opnieuw'}), 500
    except Exception as e:
        print(f"[Update] Error: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/system/power-saving', methods=['GET'])
def get_power_saving():
    """Check if power saving is enabled (arm_freq=1800)"""
    try:
        with open('/boot/firmware/config.txt', 'r') as f:
            content = f.read()
            enabled = 'arm_freq=1800' in content
        return jsonify({'enabled': enabled})
    except:
        return jsonify({'enabled': False, 'error': 'Cannot read config'})


@app.route('/api/system/power-saving', methods=['POST'])
def set_power_saving():
    """Enable/disable power saving (requires reboot)"""
    data = request.get_json() or {}
    enable = data.get('enabled', True)

    try:
        if enable:
            # Add arm_freq=1800 if not present
            result = subprocess.run(
                ['sudo', 'bash', '-c',
                 'grep -q "^arm_freq=" /boot/firmware/config.txt || echo "arm_freq=1800" >> /boot/firmware/config.txt'],
                capture_output=True, text=True, timeout=10
            )
        else:
            # Remove arm_freq line
            result = subprocess.run(
                ['sudo', 'sed', '-i', '/^arm_freq=/d', '/boot/firmware/config.txt'],
                capture_output=True, text=True, timeout=10
            )

        if result.returncode != 0:
            return jsonify({'error': result.stderr or 'Command failed'}), 500

        return jsonify({'success': True, 'reboot_required': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/system/network-status')
def get_network_status():
    """Get local IP address and internet connectivity status"""
    import socket

    local_ip = None
    internet = False

    # Get local IP by connecting to external server (gets correct interface IP)
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(2)
        s.connect(('8.8.8.8', 80))
        local_ip = s.getsockname()[0]
        s.close()
    except:
        # Fallback: try to get hostname IP
        try:
            local_ip = socket.gethostbyname(socket.gethostname())
        except:
            pass

    # Check internet connectivity
    try:
        socket.create_connection(('8.8.8.8', 53), timeout=3)
        internet = True
    except:
        pass

    return jsonify({
        'ip': local_ip,
        'internet': internet
    })


if __name__ == '__main__':
    # Check if credentials are set
    if not os.getenv('SPOTIFY_CLIENT_ID') or not os.getenv('SPOTIFY_CLIENT_SECRET'):
        print("WARNING: Spotify credentials not found!")
        print("Please copy .env.example to .env and add your credentials")
        print("Get credentials from: https://developer.spotify.com/dashboard")

    # Start Bluetooth auto-reconnect thread (Linux only)
    if bluetooth_manager:
        bt_thread = Thread(target=auto_reconnect_bluetooth_background, daemon=True)
        bt_thread.start()
        print("Bluetooth auto-reconnect check scheduled...")

    # Set safe default volume on startup
    default_volume = get_default_volume_setting()
    if set_system_volume(default_volume):
        print(f"[Audio] Set startup volume to {default_volume}%")
    else:
        print("[Audio] Warning: Could not set startup volume")

    # Start Spotify Connect mDNS discovery
    start_spotify_connect_discovery()

    try:
        app.run(host='0.0.0.0', port=5000, debug=True)
    finally:
        # Clean up mDNS discovery on shutdown
        stop_spotify_connect_discovery()
