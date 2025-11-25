from flask import Flask, render_template, request, jsonify, redirect, session, make_response
import spotipy
from spotipy.oauth2 import SpotifyOAuth
import os
import platform
import subprocess
import re
import glob
from dotenv import load_dotenv
from threading import Thread, Lock
import time

# WSL detection helper
def is_wsl():
    """Check if running in Windows Subsystem for Linux"""
    if os.environ.get('WSL_DISTRO_NAME'):
        return True
    try:
        with open('/proc/version', 'r') as f:
            return 'microsoft' in f.read().lower()
    except:
        return False

# Import Windows audio library if on Windows or WSL
if platform.system() == 'Windows' or is_wsl():
    try:
        from pycaw.pycaw import AudioUtilities, IAudioEndpointVolume, AudioDeviceState, EDataFlow
        from comtypes import CLSCTX_ALL
        import pythoncom
        PYCAW_AVAILABLE = True
    except ImportError as e:
        PYCAW_AVAILABLE = False
        print(f"Warning: pycaw not available. Error: {e}")
        print("Install with: pip install pycaw comtypes")
else:
    PYCAW_AVAILABLE = False

# Load environment variables
load_dotenv()

app = Flask(__name__)
app.secret_key = os.getenv('FLASK_SECRET_KEY', 'dev-secret-key-change-in-production')

# Audio device cache (no TTL - refresh only on manual button click)
_audio_devices_cache = None
_cache_lock = Lock()

# Spotify OAuth configuration
SPOTIFY_SCOPE = 'user-read-playback-state,user-modify-playback-state,playlist-read-private,user-library-read'

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

def get_spotify_oauth():
    """Create SpotifyOAuth instance"""
    if not check_credentials():
        return None

    return SpotifyOAuth(
        client_id=os.getenv('SPOTIFY_CLIENT_ID'),
        client_secret=os.getenv('SPOTIFY_CLIENT_SECRET'),
        redirect_uri=os.getenv('SPOTIFY_REDIRECT_URI'),
        scope=SPOTIFY_SCOPE,
        cache_path=get_cache_path(session.get('user_id', 'default')),
        show_dialog=True  # Force login screen, allows switching between accounts
    )

def get_spotify_client():
    """Get authenticated Spotify client"""
    token_info = session.get('token_info', None)
    if not token_info:
        return None

    sp_oauth = get_spotify_oauth()

    # Refresh token if expired
    if sp_oauth.is_token_expired(token_info):
        token_info = sp_oauth.refresh_access_token(token_info['refresh_token'])
        session['token_info'] = token_info

    return spotipy.Spotify(auth=token_info['access_token'])

def is_device_allowed():
    """Check if current active device is in allowed list"""
    device_filter = os.getenv('SPOTIFY_DEVICE_NAME', '').strip()
    if not device_filter:
        return True  # Geen filter = alles toegestaan

    # Support meerdere devices (comma-separated)
    allowed_devices = [d.strip().lower() for d in device_filter.split(',')]

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

# Audio Device Helper Functions
def get_audio_devices_linux():
    """Get audio devices on Linux using pactl"""
    try:
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
            devices.append(current_device)

        return devices
    except (subprocess.TimeoutExpired, FileNotFoundError, Exception) as e:
        print(f"Error getting Linux audio devices: {e}")
        return []

def get_audio_devices_windows():
    """Get audio devices on Windows using pycaw"""
    if not PYCAW_AVAILABLE:
        return []

    try:
        # Initialize COM for this thread
        pythoncom.CoInitialize()

        devices = []

        # Get default device ID using AudioUtilities.GetSpeakers()
        default_device = None
        default_id = None
        try:
            default_device = AudioUtilities.GetSpeakers()
            if default_device:
                default_id = default_device.id
        except Exception as e:
            if app.debug:
                print(f"Error getting default device: {e}")

        # Enumerate devices only once - filter for output devices only (eRender)
        audio_devices = AudioUtilities.GetAllDevices(data_flow=EDataFlow.eRender.value)
        for device in audio_devices:
            # Check if device is active using the enum
            if device.state == AudioDeviceState.Active:
                device_id = device.id
                devices.append({
                    'id': device_id,
                    'name': device.FriendlyName,
                    'is_active': (device_id == default_id)
                })

        return devices
    except Exception as e:
        print(f"Error getting Windows audio devices: {e}")
        import traceback
        traceback.print_exc()
        return []
    finally:
        # Always uninitialize COM
        try:
            pythoncom.CoUninitialize()
        except:
            pass

def get_audio_devices():
    """Get audio devices for current platform"""
    start_time = time.time()

    # Use Windows code path if on Windows or WSL
    if platform.system() == 'Windows' or is_wsl():
        devices = get_audio_devices_windows()
    elif platform.system() == 'Linux':
        devices = get_audio_devices_linux()
    else:
        print(f"Unsupported platform: {platform.system()}")
        devices = []

    elapsed = time.time() - start_time
    print(f"get_audio_devices() took {elapsed:.2f}s, found {len(devices)} devices")
    return devices

def get_audio_devices_cached():
    """Get audio devices with server-side caching (no TTL)"""
    global _audio_devices_cache

    with _cache_lock:
        # Return from cache if available
        if _audio_devices_cache is not None:
            print("Serving audio devices from cache (instant)")
            return _audio_devices_cache

        # Cache miss - enumerate devices
        print("Cache miss - enumerating audio devices...")
        devices = get_audio_devices()
        _audio_devices_cache = devices
        print(f"Audio devices cached ({len(devices)} devices)")
        return devices

def invalidate_audio_devices_cache():
    """Invalidate the audio devices cache"""
    global _audio_devices_cache

    with _cache_lock:
        _audio_devices_cache = None
        print("Audio devices cache invalidated")

def set_audio_device_linux(device_id):
    """Set audio device on Linux using pactl"""
    try:
        result = subprocess.run(['pactl', 'set-default-sink', device_id],
                              capture_output=True, text=True, timeout=5)
        return result.returncode == 0
    except Exception as e:
        print(f"Error setting Linux audio device: {e}")
        return False

def check_audiodevicecmdlets_installed():
    """Check if AudioDeviceCmdlets PowerShell module is available"""
    try:
        result = subprocess.run(
            ['powershell', '-NoProfile', '-Command',
             'Get-Module -ListAvailable -Name AudioDeviceCmdlets | ConvertTo-Json'],
            capture_output=True,
            text=True,
            timeout=5
        )
        return result.returncode == 0 and result.stdout.strip() != ''
    except Exception as e:
        print(f"Error checking AudioDeviceCmdlets: {e}")
        return False

def set_audio_device_windows_powershell(device_id):
    """Set default audio device using PowerShell AudioDeviceCmdlets"""
    try:
        ps_command = f"Import-Module AudioDeviceCmdlets; Set-AudioDevice -ID '{device_id}'"

        result = subprocess.run(
            ['powershell', '-NoProfile', '-Command', ps_command],
            capture_output=True,
            text=True,
            timeout=5
        )

        if result.returncode == 0:
            print(f"Successfully set audio device to: {device_id}")
            return True
        else:
            print(f"PowerShell error: {result.stderr}")
            return False

    except subprocess.TimeoutExpired:
        print("PowerShell command timed out")
        return False
    except Exception as e:
        print(f"Error executing PowerShell: {e}")
        return False

def set_audio_device_windows(device_id):
    """Set audio device on Windows using PowerShell AudioDeviceCmdlets"""
    if not PYCAW_AVAILABLE:
        print("Warning: pycaw not available")
        return False

    # Try PowerShell method
    if set_audio_device_windows_powershell(device_id):
        return True

    # PowerShell failed - provide helpful error message
    print("Failed to switch audio device.")
    print("Please install AudioDeviceCmdlets PowerShell module:")
    print("  Run PowerShell as Administrator:")
    print("  Install-Module -Name AudioDeviceCmdlets -Force")
    return False

def set_audio_device(device_id):
    """Set audio device for current platform"""
    # Use Windows code path if on Windows or WSL
    if platform.system() == 'Windows' or is_wsl():
        return set_audio_device_windows(device_id)
    elif platform.system() == 'Linux':
        return set_audio_device_linux(device_id)
    else:
        return False

# Routes
@app.route('/')
def index():
    """Serve the main page"""
    if not check_credentials():
        return render_template('setup.html')

    if not session.get('token_info'):
        return redirect('/login')

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

    sp_oauth = get_spotify_oauth()
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

    # Create redirect response
    response = redirect('/')

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

        # Store last results for debug logging
        playlists = results

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
    sp = get_spotify_client()
    if not sp:
        return jsonify({'error': 'Not authenticated'}), 401

    try:
        current = sp.current_playback()
        if not current or not current.get('item'):
            return jsonify({'playing': False})

        track = current['item']
        device = current.get('device', {})
        return jsonify({
            'playing': current['is_playing'],
            'shuffle': current.get('shuffle_state', False),
            'volume_percent': device.get('volume_percent', 0),
            'track': {
                'name': track['name'],
                'artist': ', '.join([artist['name'] for artist in track['artists']]),
                'album': track['album']['name'],
                'image': track['album']['images'][0]['url'] if track['album']['images'] else None,
                'duration_ms': track['duration_ms'],
                'progress_ms': current['progress_ms']
            }
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/play', methods=['POST'])
def play():
    """Resume playback"""
    sp = get_spotify_client()
    if not sp:
        return jsonify({'error': 'Not authenticated'}), 401

    if not is_device_allowed():
        return jsonify({'error': 'Bediening niet toegestaan op dit apparaat.'}), 403

    try:
        sp.start_playback()
        return jsonify({'success': True})
    except Exception as e:
        error_str = str(e).lower()
        if 'no active device' in error_str or 'device_not_found' in error_str or 'player command failed' in error_str:
            return jsonify({'error': 'Geen Spotify apparaat actief. Selecteer een apparaat in het instellingen menu.'}), 404
        return jsonify({'error': str(e)}), 500

@app.route('/api/pause', methods=['POST'])
def pause():
    """Pause playback"""
    sp = get_spotify_client()
    if not sp:
        return jsonify({'error': 'Not authenticated'}), 401

    if not is_device_allowed():
        return jsonify({'error': 'Bediening niet toegestaan op dit apparaat.'}), 403

    try:
        sp.pause_playback()
        return jsonify({'success': True})
    except Exception as e:
        error_str = str(e).lower()
        if 'no active device' in error_str or 'device_not_found' in error_str or 'player command failed' in error_str:
            return jsonify({'error': 'Geen Spotify apparaat actief. Selecteer een apparaat in het instellingen menu.'}), 404
        return jsonify({'error': str(e)}), 500

@app.route('/api/next', methods=['POST'])
def next_track():
    """Skip to next track"""
    sp = get_spotify_client()
    if not sp:
        return jsonify({'error': 'Not authenticated'}), 401

    if not is_device_allowed():
        return jsonify({'error': 'Bediening niet toegestaan op dit apparaat.'}), 403

    try:
        sp.next_track()
        return jsonify({'success': True})
    except Exception as e:
        error_str = str(e).lower()
        if 'no active device' in error_str or 'device_not_found' in error_str or 'player command failed' in error_str:
            return jsonify({'error': 'Geen Spotify apparaat actief. Selecteer een apparaat in het instellingen menu.'}), 404
        return jsonify({'error': str(e)}), 500

@app.route('/api/previous', methods=['POST'])
def previous_track():
    """Skip to previous track"""
    sp = get_spotify_client()
    if not sp:
        return jsonify({'error': 'Not authenticated'}), 401

    if not is_device_allowed():
        return jsonify({'error': 'Bediening niet toegestaan op dit apparaat.'}), 403

    try:
        sp.previous_track()
        return jsonify({'success': True})
    except Exception as e:
        error_str = str(e).lower()
        if 'no active device' in error_str or 'device_not_found' in error_str or 'player command failed' in error_str:
            return jsonify({'error': 'Geen Spotify apparaat actief. Selecteer een apparaat in het instellingen menu.'}), 404
        return jsonify({'error': str(e)}), 500

@app.route('/api/play-track', methods=['POST'])
def play_track():
    """Play a specific track"""
    sp = get_spotify_client()
    if not sp:
        return jsonify({'error': 'Not authenticated'}), 401

    if not is_device_allowed():
        return jsonify({'error': 'Bediening niet toegestaan op dit apparaat.'}), 403

    data = request.get_json()
    track_uri = data.get('uri')
    playlist_id = data.get('playlist_id')

    if not track_uri:
        return jsonify({'error': 'No track URI provided'}), 400

    try:
        if playlist_id:
            # Play from playlist context with offset to specific track
            context_uri = f'spotify:playlist:{playlist_id}'
            sp.start_playback(context_uri=context_uri, offset={'uri': track_uri})
        else:
            # Fallback: play only this track (backwards compatible)
            sp.start_playback(uris=[track_uri])
        return jsonify({'success': True})
    except Exception as e:
        error_str = str(e).lower()
        if 'no active device' in error_str or 'device_not_found' in error_str or 'player command failed' in error_str:
            return jsonify({'error': 'Geen Spotify apparaat actief. Selecteer een apparaat in het instellingen menu.'}), 404
        return jsonify({'error': str(e)}), 500

@app.route('/api/shuffle', methods=['POST'])
def toggle_shuffle():
    """Toggle shuffle mode"""
    sp = get_spotify_client()
    if not sp:
        return jsonify({'error': 'Not authenticated'}), 401

    if not is_device_allowed():
        return jsonify({'error': 'Bediening niet toegestaan op dit apparaat.'}), 403

    data = request.get_json()
    shuffle_state = data.get('state', False)

    try:
        sp.shuffle(shuffle_state)
        return jsonify({'success': True, 'shuffle': shuffle_state})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/volume', methods=['POST'])
def set_volume():
    """Set playback volume"""
    sp = get_spotify_client()
    if not sp:
        return jsonify({'error': 'Not authenticated'}), 401

    if not is_device_allowed():
        return jsonify({'error': 'Bediening niet toegestaan op dit apparaat.'}), 403

    data = request.get_json()
    volume_percent = data.get('volume_percent')

    if volume_percent is None:
        return jsonify({'error': 'No volume_percent provided'}), 400

    try:
        # Ensure volume is between 0 and 100
        volume_percent = max(0, min(100, int(volume_percent)))
        sp.volume(volume_percent)
        return jsonify({'success': True, 'volume_percent': volume_percent})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/seek', methods=['POST'])
def seek_track():
    """Seek to position in current track"""
    sp = get_spotify_client()
    if not sp:
        return jsonify({'error': 'Not authenticated'}), 401

    if not is_device_allowed():
        return jsonify({'error': 'Bediening niet toegestaan op dit apparaat.'}), 403

    data = request.get_json()
    position_ms = data.get('position_ms')

    if position_ms is None:
        return jsonify({'error': 'No position_ms provided'}), 400

    try:
        position_ms = max(0, int(position_ms))
        sp.seek_track(position_ms)
        return jsonify({'success': True, 'position_ms': position_ms})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/devices')
def get_devices():
    """Get available Spotify devices"""
    sp = get_spotify_client()
    if not sp:
        return jsonify({'error': 'Not authenticated'}), 401

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
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/transfer-playback', methods=['POST'])
def transfer_playback():
    """Transfer playback to a device"""
    sp = get_spotify_client()
    if not sp:
        return jsonify({'error': 'Not authenticated'}), 401

    data = request.get_json()
    device_id = data.get('device_id')

    if not device_id:
        return jsonify({'error': 'No device ID provided'}), 400

    try:
        sp.transfer_playback(device_id, force_play=True)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# Raspberry Pi placeholder endpoints (for future implementation)
@app.route('/api/shutdown', methods=['POST'])
def shutdown():
    """Shutdown Raspberry Pi (placeholder)"""
    # TODO: Implement actual shutdown when running on Pi
    # subprocess.run(['sudo', 'shutdown', '-h', 'now'])
    print("Shutdown requested (placeholder - not executing)")
    return jsonify({'success': True, 'message': 'Shutdown placeholder (not on Pi)'})

@app.route('/api/audio/devices')
def get_audio_devices_endpoint():
    """Get available audio output devices (cached)"""
    try:
        devices = get_audio_devices_cached()
        return jsonify({'devices': devices})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/audio/devices/refresh', methods=['POST'])
def refresh_audio_devices_endpoint():
    """Manually refresh audio devices cache"""
    try:
        invalidate_audio_devices_cache()
        devices = get_audio_devices_cached()
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
            # Invalidate cache so frontend gets updated active device status
            invalidate_audio_devices_cache()

            # Wait for Windows to update the default device (150ms)
            time.sleep(0.15)

            return jsonify({'success': True, 'device_id': device_id})
        else:
            return jsonify({'error': 'Failed to set audio device. Is AudioDeviceCmdlets installed?'}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500

def preload_audio_devices_background():
    """Preload audio devices cache in background on startup"""
    time.sleep(2)  # Wait for Flask to start
    print("\n=== Preloading audio devices cache ===")
    try:
        get_audio_devices_cached()
        print("=== Audio devices cache ready ===\n")
    except Exception as e:
        print(f"=== Cache preload failed (non-critical): {e} ===\n")

if __name__ == '__main__':
    # Check if credentials are set
    if not os.getenv('SPOTIFY_CLIENT_ID') or not os.getenv('SPOTIFY_CLIENT_SECRET'):
        print("WARNING: Spotify credentials not found!")
        print("Please copy .env.example to .env and add your credentials")
        print("Get credentials from: https://developer.spotify.com/dashboard")

    # Start background thread to preload audio devices
    preload_thread = Thread(target=preload_audio_devices_background, daemon=True)
    preload_thread.start()
    print("Background audio device cache preload started...")

    app.run(host='0.0.0.0', port=5000, debug=True)
