// ============================================
// DRAG SCROLL HANDLER
// Enables touch scrolling by using mouse events
// (Wayland/Chromium converts touch to mouse events)
// ============================================

function enableDragScroll() {
  let scrollableParent = null;
  let lastY = 0;
  let startY = 0;
  let velocityY = 0;
  let lastTime = 0;
  let isDragging = false;
  let hasDragged = false;
  let animationFrame = null;
  const DRAG_THRESHOLD = 10;

  function findScrollable(el) {
    while (el && el !== document.body) {
      const style = window.getComputedStyle(el);
      if ((style.overflowY === 'auto' || style.overflowY === 'scroll') &&
          el.scrollHeight > el.clientHeight) {
        return el;
      }
      el = el.parentElement;
    }
    return null;
  }

  // Click handler in capture phase to block clicks after drag
  document.addEventListener('click', (e) => {
    if (hasDragged) {
      // Block all clicks after drag to prevent accidental selection
      e.stopPropagation();
      e.preventDefault();
      hasDragged = false;
    }
  }, true);

  document.addEventListener('mousedown', (e) => {
    if (animationFrame) cancelAnimationFrame(animationFrame);
    scrollableParent = findScrollable(e.target);
    if (scrollableParent) {
      isDragging = true;
      lastY = e.clientY;
      startY = e.clientY;
      hasDragged = false;
      lastTime = Date.now();
      velocityY = 0;
      e.preventDefault();
    }
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging || !scrollableParent) return;

    const deltaY = lastY - e.clientY;
    const now = Date.now();
    const dt = now - lastTime;

    // Check if we've moved past the drag threshold
    if (Math.abs(e.clientY - startY) > DRAG_THRESHOLD) {
      hasDragged = true;
    }

    if (Math.abs(deltaY) > 2) {
      scrollableParent.scrollTop += deltaY * 1.5;
      if (dt > 0) velocityY = (deltaY / dt) * 20;
    }

    lastY = e.clientY;
    lastTime = now;
    e.preventDefault();
  });

  document.addEventListener('mouseup', () => {
    if (!isDragging) return;
    isDragging = false;

    if (Math.abs(velocityY) > 1 && scrollableParent) {
      const el = scrollableParent;
      const momentum = () => {
        if (Math.abs(velocityY) < 0.5) return;
        el.scrollTop += velocityY;
        velocityY *= 0.92;
        animationFrame = requestAnimationFrame(momentum);
      };
      animationFrame = requestAnimationFrame(momentum);
    }
  });

  document.addEventListener('mouseleave', () => {
    isDragging = false;
  });
}

// Initialize drag scroll
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', enableDragScroll);
} else {
  enableDragScroll();
}

// ============================================
// MAIN APPLICATION
// ============================================

// State management
let isPlaying = false;
let currentPlaylistId = null;
let currentArtistId = null;
let currentAlbumId = null;
let currentViewMode = 'playlists'; // 'playlists' or 'artists'
let currentArtistSubView = 'tracks'; // 'tracks' or 'albums' (only used in artists view)
let isShuffleOn = false;
let currentTrackId = null;
let devicePollingInterval = null;

// Bluetooth state
let bluetoothState = {
    scanning: false,
    pairedDevices: [],
    discoveredDevices: [],
    connectingDevice: null,
    pairingDevice: null,
    pendingPinDevice: null
};
let bluetoothPollingInterval = null;

// Theme state
let currentTheme = 'light';
let primaryColor = '#667eea';
let secondaryColor = '#764ba2';
let accentColor = '#eacd66';

// Settings PIN state
let settingsUnlocked = false;
let currentPinInput = '';
let pendingProtectedTab = null;

// Audio device cache
let cachedAudioDevices = null;
let cachedAudioDevicesTimestamp = null;
const CACHE_DURATION = 60000; // 60 seconds

// Playlist/tracks cache configuration
const CACHE_KEYS = {
    PLAYLISTS: 'spotify-playlists-cache',
    TRACKS_PREFIX: 'spotify-tracks-',
    ARTISTS: 'spotify-artists-cache',
    ARTIST_TRACKS_PREFIX: 'spotify-artist-tracks-',
    ARTIST_ALBUMS_PREFIX: 'spotify-artist-albums-',
    ALBUM_TRACKS_PREFIX: 'spotify-album-tracks-'
};
const PLAYLIST_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// Cache helper functions
function getCache(key) {
    try {
        const cached = localStorage.getItem(key);
        if (!cached) return null;
        const { data, timestamp } = JSON.parse(cached);
        if (Date.now() - timestamp > PLAYLIST_CACHE_TTL) {
            localStorage.removeItem(key);
            return null;
        }
        return data;
    } catch (e) {
        return null;
    }
}

function setCache(key, data) {
    try {
        localStorage.setItem(key, JSON.stringify({
            data,
            timestamp: Date.now()
        }));
    } catch (e) {
        console.warn('Cache write failed:', e);
    }
}

function clearPlaylistCache() {
    localStorage.removeItem(CACHE_KEYS.PLAYLISTS);
    Object.keys(localStorage)
        .filter(k => k.startsWith(CACHE_KEYS.TRACKS_PREFIX))
        .forEach(k => localStorage.removeItem(k));
}

function clearArtistCache() {
    localStorage.removeItem(CACHE_KEYS.ARTISTS);
    Object.keys(localStorage)
        .filter(k => k.startsWith(CACHE_KEYS.ARTIST_TRACKS_PREFIX))
        .forEach(k => localStorage.removeItem(k));
    // Also clear album cache for artists
    Object.keys(localStorage)
        .filter(k => k.startsWith(CACHE_KEYS.ARTIST_ALBUMS_PREFIX) || k.startsWith(CACHE_KEYS.ALBUM_TRACKS_PREFIX))
        .forEach(k => localStorage.removeItem(k));
}

// URL State Persistence
function updateURL() {
    const params = new URLSearchParams();
    params.set('view', currentViewMode);

    if (currentViewMode === 'playlists' && currentPlaylistId) {
        params.set('playlist', currentPlaylistId);
    } else if (currentViewMode === 'artists') {
        if (currentArtistId) params.set('artist', currentArtistId);
        if (currentAlbumId) {
            params.set('album', currentAlbumId);
        } else if (currentArtistSubView === 'albums') {
            params.set('subview', 'albums');
        }
    }

    const newURL = params.toString() ? '?' + params.toString() : window.location.pathname;
    history.replaceState(null, '', newURL);
}

async function restoreFromURL() {
    const params = new URLSearchParams(window.location.search);
    const view = params.get('view');
    const playlistId = params.get('playlist');
    const artistId = params.get('artist');
    const albumId = params.get('album');
    const subview = params.get('subview');

    // No URL params - use defaults
    if (!view) {
        loadPlaylists();
        return;
    }

    if (view === 'playlists') {
        currentViewMode = 'playlists';
        await loadPlaylists();

        if (playlistId) {
            currentPlaylistId = playlistId;
            await loadTracksById(playlistId);
            // Highlight the playlist item after content loads
            highlightPlaylistItem(playlistId);
        }
    } else if (view === 'artists') {
        currentViewMode = 'artists';

        // Update UI for artists mode
        document.querySelectorAll('.view-toggle-btn').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-view') === 'artists');
        });

        const artistSubToggle = document.getElementById('artist-sub-toggle');
        if (artistSubToggle) artistSubToggle.style.display = 'grid';

        await loadArtists();

        if (artistId) {
            currentArtistId = artistId;
            // Highlight the artist item
            highlightArtistItem(artistId);

            if (albumId) {
                // Load album tracks
                currentAlbumId = albumId;
                await loadAlbumTracksById(albumId);
            } else if (subview === 'albums') {
                currentArtistSubView = 'albums';
                document.querySelectorAll('.sub-toggle-btn').forEach(btn => {
                    btn.classList.toggle('active', btn.getAttribute('data-subview') === 'albums');
                });
                const tracksPanelTitle = document.getElementById('tracks-panel-title');
                if (tracksPanelTitle) {
                    tracksPanelTitle.style.display = 'block';
                    tracksPanelTitle.textContent = 'Albums';
                }
                await loadArtistAlbums(artistId);
            } else {
                // Default: load top tracks
                await loadArtistTracksById(artistId);
            }
        }
    }
}

// Helper to highlight playlist item by ID
function highlightPlaylistItem(playlistId) {
    // Get cached playlists to find the index
    const cached = getCache(CACHE_KEYS.PLAYLISTS);
    if (!cached) return;

    const index = cached.findIndex(p => p.id === playlistId);
    if (index === -1) return;

    const playlistItems = document.querySelectorAll('.playlist-item');
    playlistItems.forEach((btn, i) => {
        btn.classList.toggle('active', i === index);
    });
}

// Helper to highlight artist item by ID
function highlightArtistItem(artistId) {
    // Get cached artists to find the index
    const cached = getCache(CACHE_KEYS.ARTISTS);
    if (!cached) return;

    const index = cached.findIndex(a => a.id === artistId);
    if (index === -1) return;

    const artistItems = document.querySelectorAll('.artist-item');
    artistItems.forEach((btn, i) => {
        btn.classList.toggle('active', i === index);
    });
}

// Helper to load tracks by ID (without button reference)
async function loadTracksById(playlistId) {
    currentPlaylistId = playlistId;
    currentArtistId = null;

    const cacheKey = CACHE_KEYS.TRACKS_PREFIX + playlistId;
    const cached = getCache(cacheKey);
    if (cached) {
        renderTracks(cached);
        return;
    }

    tracksContainer.innerHTML = '<div class="loading">Nummers laden...</div>';

    try {
        const response = await fetch(`/api/playlist/${playlistId}`);
        const tracks = await response.json();
        setCache(cacheKey, tracks);
        renderTracks(tracks);
    } catch (error) {
        console.error('Error loading tracks:', error);
        tracksContainer.innerHTML = '<div class="empty-state">Fout bij laden van nummers</div>';
    }
}

// Helper to load artist tracks by ID (without button reference)
async function loadArtistTracksById(artistId) {
    currentArtistId = artistId;
    currentPlaylistId = null;
    currentAlbumId = null;
    currentArtistSubView = 'tracks';

    resetArtistSubToggle();

    const tracksPanelTitle = document.getElementById('tracks-panel-title');
    if (tracksPanelTitle) {
        tracksPanelTitle.style.display = 'block';
        tracksPanelTitle.textContent = 'Top Nummers';
    }

    const cacheKey = CACHE_KEYS.ARTIST_TRACKS_PREFIX + artistId;
    const cached = getCache(cacheKey);
    if (cached) {
        renderTracks(cached);
        return;
    }

    tracksContainer.innerHTML = '<div class="loading">Top nummers laden...</div>';

    try {
        const response = await fetch(`/api/artist/${artistId}/top-tracks`);
        const tracks = await response.json();
        setCache(cacheKey, tracks);
        renderTracks(tracks);
    } catch (error) {
        console.error('Error loading artist tracks:', error);
        tracksContainer.innerHTML = '<div class="empty-state">Fout bij laden van nummers</div>';
    }
}

// Helper to load album tracks by ID (without album name)
async function loadAlbumTracksById(albumId) {
    currentAlbumId = albumId;

    // Hide panel title (album header shows title now)
    const tracksPanelTitle = document.getElementById('tracks-panel-title');
    if (tracksPanelTitle) tracksPanelTitle.style.display = 'none';

    // Show back button, hide sub-toggle
    const albumBackBtn = document.getElementById('album-back-btn');
    if (albumBackBtn) albumBackBtn.style.display = 'flex';
    const artistSubToggle = document.getElementById('artist-sub-toggle');
    if (artistSubToggle) artistSubToggle.style.display = 'none';

    const cacheKey = CACHE_KEYS.ALBUM_TRACKS_PREFIX + albumId;
    const cached = getCache(cacheKey);

    if (cached) {
        renderAlbumTracks(cached);
        return;
    }

    tracksContainer.innerHTML = '<div class="loading">Nummers laden...</div>';

    try {
        const response = await fetch(`/api/album/${albumId}/tracks`);
        const tracks = await response.json();
        setCache(cacheKey, tracks);
        renderAlbumTracks(tracks);
    } catch (error) {
        console.error('Error loading album tracks:', error);
        tracksContainer.innerHTML = '<div class="empty-state">Fout bij laden van nummers</div>';
    }
}

// Audio device switching state
let isAudioSwitching = false;
let lastSwitchTime = 0;
const COOLDOWN_MS = 2000; // 2 seconds cooldown after successful switch

// DOM Elements
const playlistsContainer = document.getElementById('playlists-container');
const tracksContainer = document.getElementById('tracks-container');
const albumArt = document.getElementById('album-art');
const noTrack = document.getElementById('no-track');
const trackInfo = document.getElementById('track-info');
const trackName = document.getElementById('track-name');
const trackArtist = document.getElementById('track-artist');
const playPauseBtn = document.getElementById('btn-play-pause');
const playPauseIcon = document.getElementById('play-pause-icon');
const previousBtn = document.getElementById('btn-previous');
const nextBtn = document.getElementById('btn-next');
const shuffleBtn = document.getElementById('btn-shuffle');
const refreshPlaylistsBtn = document.getElementById('btn-refresh-playlists');
const shutdownBtn = document.getElementById('btn-shutdown');
const rebootBtn = document.getElementById('btn-reboot');
const logoutBtn = document.getElementById('btn-logout');
const shutdownModal = document.getElementById('shutdown-modal');
const confirmShutdownBtn = document.getElementById('btn-confirm-shutdown');
const cancelShutdownBtn = document.getElementById('btn-cancel-shutdown');
const rebootModal = document.getElementById('reboot-modal');
const confirmRebootBtn = document.getElementById('btn-confirm-reboot');
const cancelRebootBtn = document.getElementById('btn-cancel-reboot');
const openSettingsBtn = document.getElementById('btn-open-settings');
const settingsModal = document.getElementById('settings-modal');
const volumeSlider = document.getElementById('volume-slider');
const volumeIconPath = document.getElementById('volume-icon-path');
const progressBar = document.getElementById('progress-bar');
const progressFill = document.getElementById('progress-fill');
const currentTimeEl = document.getElementById('current-time');
const totalTimeEl = document.getElementById('total-time');
const albumBackBtn = document.getElementById('album-back-btn');

// Progress tracking state
let trackDuration = 0;
let trackProgress = 0;
let lastProgressUpdate = Date.now();
let progressInterpolationInterval = null;

// Volume slider state
let isVolumeAdjusting = false;
let volumeDebounceTimer = null;

// Default volume setting elements
const defaultVolumeSlider = document.getElementById('default-volume-slider');
const defaultVolumeValue = document.getElementById('default-volume-value');
const maxVolumeSlider = document.getElementById('max-volume-slider');
const maxVolumeValueEl = document.getElementById('max-volume-value');

// Current max volume (updated from settings)
let currentMaxVolume = 80;

// Long-press helper for buttons with hold-to-activate behavior
function setupLongPress(button, duration, onComplete) {
    if (!button) return;
    let holdDuration = 0;
    let holdInterval = null;

    const start = (e) => {
        if (e.type === 'touchstart') e.preventDefault();
        holdDuration = 0;
        button.classList.add('holding');
        holdInterval = setInterval(() => {
            holdDuration += 100;
            if (holdDuration >= duration) {
                clearInterval(holdInterval);
                button.classList.remove('holding');
                onComplete();
            }
        }, 100);
    };

    const cancel = (e) => {
        if (e.type === 'touchend') e.preventDefault();
        clearInterval(holdInterval);
        button.classList.remove('holding');
    };

    button.addEventListener('mousedown', start);
    button.addEventListener('touchstart', start);
    button.addEventListener('mouseup', cancel);
    button.addEventListener('mouseleave', cancel);
    button.addEventListener('touchend', cancel);
}

// Render audio devices list helper
function renderAudioDevices(container, data, errorMessage = 'Fout bij laden van audio apparaten') {
    if (data.error) {
        container.innerHTML = `<div class="empty-state">${errorMessage}</div>`;
        return;
    }

    if (!data.devices || data.devices.length === 0) {
        container.innerHTML = '<div class="empty-state">Geen audio apparaten gevonden</div>';
        return;
    }

    container.innerHTML = '';
    data.devices.forEach(device => {
        const deviceDiv = createAudioDeviceElement(device);
        container.appendChild(deviceDiv);
    });
}

// Perform logout with cleanup
function performLogout() {
    // Stop all polling intervals
    if (progressInterpolationInterval) {
        clearInterval(progressInterpolationInterval);
    }
    stopDevicePolling();

    // Clear all browser storage
    localStorage.clear();
    sessionStorage.clear();

    // Hard redirect to prevent back-button issues
    window.location.replace('/logout');
}

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    loadSavedTheme();
    restoreFromURL(); // Restore state from URL or load defaults
    preloadAudioDevices(); // Preload audio devices in background
    loadSystemVolume(); // Sync volume slider with system audio
    startCurrentTrackPolling();
    startProgressInterpolation();
    setupEventListeners();
    setupThemeListeners();
    setupBluetoothEventListeners();

    // Reopen settings modal if coming back from refresh
    const reopenTab = localStorage.getItem('reopenSettingsTab');
    if (reopenTab) {
        localStorage.removeItem('reopenSettingsTab');
        settingsUnlocked = true; // Was already unlocked before refresh
        showSettingsModal();
        switchTab(reopenTab);
    }
});

// Setup event listeners
function setupEventListeners() {
    playPauseBtn.addEventListener('click', togglePlayPause);
    previousBtn.addEventListener('click', previousTrack);
    nextBtn.addEventListener('click', nextTrack);
    shuffleBtn.addEventListener('click', toggleShuffle);

    // Refresh playlists button
    refreshPlaylistsBtn.addEventListener('click', refreshPlaylists);

    // Volume slider
    volumeSlider.addEventListener('input', handleVolumeChange);
    volumeSlider.addEventListener('mousedown', () => { isVolumeAdjusting = true; });
    volumeSlider.addEventListener('touchstart', () => { isVolumeAdjusting = true; });
    volumeSlider.addEventListener('mouseup', () => { isVolumeAdjusting = false; });
    volumeSlider.addEventListener('touchend', () => { isVolumeAdjusting = false; });
    volumeSlider.addEventListener('mouseleave', () => { isVolumeAdjusting = false; });

    // Progress bar seeking
    progressBar.addEventListener('click', handleProgressBarClick);
    progressBar.addEventListener('mousedown', startProgressDrag);
    progressBar.addEventListener('touchstart', startProgressDrag, { passive: false });

    // System buttons (direct click - PIN already provides protection)
    shutdownBtn.addEventListener('click', showShutdownModal);
    rebootBtn.addEventListener('click', showRebootModal);
    logoutBtn.addEventListener('click', performLogout);

    // Refresh interface button - preserves modal state across reload
    const refreshInterfaceBtn = document.getElementById('btn-refresh-interface');
    if (refreshInterfaceBtn) {
        refreshInterfaceBtn.addEventListener('click', () => {
            localStorage.setItem('reopenSettingsTab', 'other');
            location.reload();
        });
    }

    // Default volume slider in settings
    setupDefaultVolumeSlider();

    confirmShutdownBtn.addEventListener('click', confirmShutdown);
    cancelShutdownBtn.addEventListener('click', hideShutdownModal);
    confirmRebootBtn.addEventListener('click', confirmReboot);
    cancelRebootBtn.addEventListener('click', hideRebootModal);

    // Settings modal event listeners
    openSettingsBtn.addEventListener('click', showSettingsModal);

    // Close modal when clicking outside
    settingsModal.addEventListener('click', (e) => {
        if (e.target === settingsModal) {
            hideSettingsModal();
        }
    });

    // Tab switching event listeners
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tabName = btn.getAttribute('data-tab');
            switchTab(tabName);
        });
    });

    // View toggle (Playlists / Artists) event listeners
    document.querySelectorAll('.view-toggle-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const view = btn.getAttribute('data-view');
            switchViewMode(view);
        });
    });

    // Artist sub-toggle (Top Nummers / Albums) event listeners
    document.querySelectorAll('.sub-toggle-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const subview = btn.getAttribute('data-subview');
            switchArtistSubView(subview);
        });
    });

    // Album back button event listener
    if (albumBackBtn) {
        albumBackBtn.addEventListener('click', goBackToAlbums);
    }
}

// Load playlists
async function loadPlaylists() {
    // Check cache first
    const cached = getCache(CACHE_KEYS.PLAYLISTS);
    if (cached) {
        renderPlaylists(cached);
        return;
    }

    try {
        const response = await fetch('/api/playlists');
        const playlists = await response.json();

        // Cache the result
        setCache(CACHE_KEYS.PLAYLISTS, playlists);
        renderPlaylists(playlists);
    } catch (error) {
        console.error('Error loading playlists:', error);
        playlistsContainer.innerHTML = '<div class="empty-state">Fout bij laden van playlists</div>';
    }
}

// Render playlists to DOM
function renderPlaylists(playlists) {
    playlistsContainer.innerHTML = '';

    if (playlists.length === 0) {
        playlistsContainer.innerHTML = '<div class="empty-state">Geen playlists gevonden</div>';
        return;
    }

    playlists.forEach(playlist => {
        const btn = document.createElement('button');
        btn.className = 'playlist-item';

        // Always create image element with fallback to prevent layout shift
        const img = document.createElement('img');
        img.src = playlist.image || '/static/img/placeholder.svg';
        img.alt = playlist.name;
        img.className = 'playlist-image';
        btn.appendChild(img);

        // Create text element
        const nameSpan = document.createElement('span');
        nameSpan.className = 'playlist-name';
        nameSpan.textContent = playlist.name;
        btn.appendChild(nameSpan);

        btn.onclick = () => loadTracks(playlist.id, btn);
        playlistsContainer.appendChild(btn);
    });

    // Automatically load first playlist
    if (playlists.length > 0) {
        const firstBtn = playlistsContainer.querySelector('.playlist-item');
        if (firstBtn) {
            loadTracks(playlists[0].id, firstBtn);
        }
    }
}

// Switch between playlists and artists view
function switchViewMode(mode) {
    if (mode === currentViewMode) return;

    currentViewMode = mode;

    // Update toggle buttons
    document.querySelectorAll('.view-toggle-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-view') === mode);
    });

    // Update middle panel title
    const tracksPanelTitle = document.getElementById('tracks-panel-title');
    if (tracksPanelTitle) {
        tracksPanelTitle.style.display = 'block';
        tracksPanelTitle.textContent = mode === 'playlists' ? 'Nummers' : 'Top Nummers';
    }

    // Show/hide artist sub-toggle
    const artistSubToggle = document.getElementById('artist-sub-toggle');
    if (artistSubToggle) {
        artistSubToggle.style.display = mode === 'artists' ? 'flex' : 'none';
    }

    // Reset artist sub-view to tracks when switching modes
    if (mode === 'playlists') {
        currentArtistSubView = 'tracks';
        resetArtistSubToggle();
    }

    // Animate content switch
    playlistsContainer.classList.add('switching');

    setTimeout(() => {
        // Clear tracks panel when switching modes
        tracksContainer.innerHTML = '<div class="empty-state">Selecteer een ' +
            (mode === 'playlists' ? 'playlist' : 'artiest') + '</div>';

        // Load appropriate content
        if (mode === 'playlists') {
            currentArtistId = null;
            currentAlbumId = null;
            loadPlaylists();
        } else {
            currentPlaylistId = null;
            currentAlbumId = null;
            loadArtists();
        }

        playlistsContainer.classList.remove('switching');
        updateURL();
    }, 150);
}

// Reset artist sub-toggle to default state (tracks)
function resetArtistSubToggle() {
    document.querySelectorAll('.sub-toggle-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-subview') === 'tracks');
    });
}

// Switch between top tracks and albums in artist view
function switchArtistSubView(subview) {
    if (subview === currentArtistSubView) return;
    if (!currentArtistId) return; // No artist selected

    currentArtistSubView = subview;
    currentAlbumId = null; // Reset album selection

    // Update sub-toggle buttons
    document.querySelectorAll('.sub-toggle-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-subview') === subview);
    });

    // Update panel title
    const tracksPanelTitle = document.getElementById('tracks-panel-title');
    if (tracksPanelTitle) {
        tracksPanelTitle.style.display = 'block';
        tracksPanelTitle.textContent = subview === 'tracks' ? 'Top Nummers' : 'Albums';
    }

    // Load appropriate content
    if (subview === 'tracks') {
        loadArtistTracks(currentArtistId, document.querySelector('.artist-item.active'));
    } else {
        loadArtistAlbums(currentArtistId);
    }
}

// Load artists
async function loadArtists() {
    // Check cache first
    const cached = getCache(CACHE_KEYS.ARTISTS);
    if (cached) {
        renderArtists(cached);
        return;
    }

    playlistsContainer.innerHTML = '<div class="loading">Artiesten laden...</div>';

    try {
        const response = await fetch('/api/artists');
        const artists = await response.json();

        // Cache the result
        setCache(CACHE_KEYS.ARTISTS, artists);
        renderArtists(artists);
    } catch (error) {
        console.error('Error loading artists:', error);
        playlistsContainer.innerHTML = '<div class="empty-state">Fout bij laden van artiesten</div>';
    }
}

// Render artists to DOM
function renderArtists(artists) {
    playlistsContainer.innerHTML = '';

    if (artists.length === 0) {
        playlistsContainer.innerHTML = '<div class="empty-state">Geen artiesten gevonden</div>';
        return;
    }

    artists.forEach(artist => {
        const btn = document.createElement('button');
        btn.className = 'artist-item';

        // Create circular image
        const img = document.createElement('img');
        img.src = artist.image || '/static/img/placeholder.svg';
        img.alt = artist.name;
        img.className = 'artist-image';
        btn.appendChild(img);

        // Create name element
        const nameSpan = document.createElement('span');
        nameSpan.className = 'artist-name';
        nameSpan.textContent = artist.name;
        btn.appendChild(nameSpan);

        btn.onclick = () => loadArtistTracks(artist.id, btn);
        playlistsContainer.appendChild(btn);
    });

    // Automatically load first artist
    if (artists.length > 0) {
        const firstBtn = playlistsContainer.querySelector('.artist-item');
        if (firstBtn) {
            loadArtistTracks(artists[0].id, firstBtn);
        }
    }
}

// Load top tracks from artist
async function loadArtistTracks(artistId, artistBtn) {
    // Store current artist ID (no playlist context for artist tracks)
    currentArtistId = artistId;
    currentPlaylistId = null; // Clear playlist context
    currentAlbumId = null; // Clear album context

    // Update active state
    document.querySelectorAll('.artist-item').forEach(btn => {
        btn.classList.remove('active');
    });
    if (artistBtn) artistBtn.classList.add('active');

    // Reset sub-toggle to tracks when selecting a new artist
    currentArtistSubView = 'tracks';
    resetArtistSubToggle();

    // Update panel title
    const tracksPanelTitle = document.getElementById('tracks-panel-title');
    if (tracksPanelTitle) {
        tracksPanelTitle.style.display = 'block';
        tracksPanelTitle.textContent = 'Top Nummers';
    }

    const cacheKey = CACHE_KEYS.ARTIST_TRACKS_PREFIX + artistId;

    // Check cache first
    const cached = getCache(cacheKey);
    if (cached) {
        renderTracks(cached);
        updateURL();
        return;
    }

    tracksContainer.innerHTML = '<div class="loading">Top nummers laden...</div>';

    try {
        const response = await fetch(`/api/artist/${artistId}/top-tracks`);
        const tracks = await response.json();

        // Cache the result
        setCache(cacheKey, tracks);
        renderTracks(tracks);
        updateURL();
    } catch (error) {
        console.error('Error loading artist tracks:', error);
        tracksContainer.innerHTML = '<div class="empty-state">Fout bij laden van nummers</div>';
    }
}

// Load albums from artist
async function loadArtistAlbums(artistId) {
    const cacheKey = CACHE_KEYS.ARTIST_ALBUMS_PREFIX + artistId;

    // Check cache first
    const cached = getCache(cacheKey);
    if (cached) {
        renderAlbums(cached);
        updateURL();
        return;
    }

    tracksContainer.innerHTML = '<div class="loading">Albums laden...</div>';

    try {
        const response = await fetch(`/api/artist/${artistId}/albums`);
        const albums = await response.json();

        // Cache the result
        setCache(cacheKey, albums);
        renderAlbums(albums);
        updateURL();
    } catch (error) {
        console.error('Error loading artist albums:', error);
        tracksContainer.innerHTML = '<div class="empty-state">Fout bij laden van albums</div>';
    }
}

// Render albums to DOM
function renderAlbums(albums) {
    tracksContainer.innerHTML = '';

    if (albums.length === 0) {
        tracksContainer.innerHTML = '<div class="empty-state">Geen albums gevonden</div>';
        return;
    }

    albums.forEach(album => {
        const albumDiv = document.createElement('div');
        albumDiv.className = 'album-item';

        // Album image
        const img = document.createElement('img');
        img.src = album.image || '/static/img/placeholder.svg';
        img.alt = album.name;
        img.className = 'album-image';
        albumDiv.appendChild(img);

        // Album info
        const textDiv = document.createElement('div');
        textDiv.className = 'album-info-text';

        // Extract year from release_date (can be YYYY, YYYY-MM, or YYYY-MM-DD)
        const year = album.release_date ? album.release_date.split('-')[0] : '';

        textDiv.innerHTML = `
            <div class="album-name">${escapeHtml(album.name)}</div>
            <div class="album-year">${year}</div>
        `;
        albumDiv.appendChild(textDiv);

        albumDiv.onclick = () => loadAlbumTracks(album.id, album.name);
        tracksContainer.appendChild(albumDiv);
    });
}

// Load tracks from album
async function loadAlbumTracks(albumId, albumName) {
    currentAlbumId = albumId;

    // Hide panel title (album header shows title now)
    const tracksPanelTitle = document.getElementById('tracks-panel-title');
    if (tracksPanelTitle) tracksPanelTitle.style.display = 'none';

    // Show back button, hide sub-toggle
    if (albumBackBtn) albumBackBtn.style.display = 'flex';
    const artistSubToggle = document.getElementById('artist-sub-toggle');
    if (artistSubToggle) artistSubToggle.style.display = 'none';

    const cacheKey = CACHE_KEYS.ALBUM_TRACKS_PREFIX + albumId;

    // Check cache first
    const cached = getCache(cacheKey);
    if (cached) {
        renderAlbumTracks(cached);
        updateURL();
        return;
    }

    tracksContainer.innerHTML = '<div class="loading">Nummers laden...</div>';

    try {
        const response = await fetch(`/api/album/${albumId}/tracks`);
        const tracks = await response.json();

        // Cache the result
        setCache(cacheKey, tracks);
        renderAlbumTracks(tracks);
        updateURL();
    } catch (error) {
        console.error('Error loading album tracks:', error);
        tracksContainer.innerHTML = '<div class="empty-state">Fout bij laden van nummers</div>';
    }
}

// Go back from album tracks to albums list
function goBackToAlbums() {
    currentAlbumId = null;

    // Hide back button, show sub-toggle
    if (albumBackBtn) albumBackBtn.style.display = 'none';
    const artistSubToggle = document.getElementById('artist-sub-toggle');
    if (artistSubToggle) artistSubToggle.style.display = 'grid';

    // Show and update panel title
    const tracksPanelTitle = document.getElementById('tracks-panel-title');
    if (tracksPanelTitle) {
        tracksPanelTitle.style.display = 'block';
        tracksPanelTitle.textContent = 'Albums';
    }

    // Load albums again
    if (currentArtistId) {
        loadArtistAlbums(currentArtistId);
    }
    updateURL();
}

// Render album tracks as list view with header
function renderAlbumTracks(tracks) {
    tracksContainer.innerHTML = '';

    if (tracks.length === 0) {
        tracksContainer.innerHTML = '<div class="empty-state">Geen nummers gevonden</div>';
        return;
    }

    // Album header
    const albumImage = tracks[0]?.image || '/static/img/placeholder.svg';
    const albumName = tracks[0]?.album || '';
    const artistName = tracks[0]?.artist || '';
    const releaseYear = tracks[0]?.release_date?.split('-')[0] || '';
    const totalTracks = tracks.length;
    const totalDuration = formatTotalDuration(
        tracks.reduce((sum, t) => sum + (t.duration_ms || 0), 0)
    );

    // Build metadata string (handle missing year gracefully)
    const metaParts = [];
    if (releaseYear) metaParts.push(releaseYear);
    metaParts.push(`${totalTracks} nummers`);
    metaParts.push(totalDuration);
    const metaString = metaParts.join(' • ');

    const header = document.createElement('div');
    header.className = 'album-header';

    // Image container with play button overlay
    const imageContainer = document.createElement('div');
    imageContainer.className = 'album-header-image-container';

    const img = document.createElement('img');
    img.className = 'album-header-image';
    img.src = albumImage;
    img.alt = escapeHtml(albumName);
    imageContainer.appendChild(img);

    // Play button overlay
    const playBtn = document.createElement('button');
    playBtn.className = 'album-play-btn';
    playBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>`;
    playBtn.onclick = (e) => {
        e.stopPropagation();
        playTrack(tracks[0].uri);
    };
    imageContainer.appendChild(playBtn);

    header.appendChild(imageContainer);

    // Info section
    const infoDiv = document.createElement('div');
    infoDiv.className = 'album-header-info';
    infoDiv.innerHTML = `
        <div class="album-header-title">${escapeHtml(albumName)}</div>
        <div class="album-header-artist">${escapeHtml(artistName)}</div>
        <div class="album-header-meta">${metaString}</div>
    `;
    header.appendChild(infoDiv);

    tracksContainer.appendChild(header);

    // Track list
    const listContainer = document.createElement('div');
    listContainer.className = 'album-tracks-list';

    tracks.forEach(track => {
        const trackDiv = document.createElement('div');
        trackDiv.className = 'album-track-item';
        trackDiv.setAttribute('data-track-id', track.id);

        // Track number
        const numberSpan = document.createElement('span');
        numberSpan.className = 'track-number';
        numberSpan.textContent = track.track_number || '';
        trackDiv.appendChild(numberSpan);

        // Track title
        const titleSpan = document.createElement('span');
        titleSpan.className = 'track-title';
        titleSpan.textContent = track.name;
        trackDiv.appendChild(titleSpan);

        // Duration
        const durationSpan = document.createElement('span');
        durationSpan.className = 'track-duration';
        durationSpan.textContent = formatDuration(track.duration_ms);
        trackDiv.appendChild(durationSpan);

        trackDiv.onclick = () => playTrack(track.uri);
        listContainer.appendChild(trackDiv);
    });

    tracksContainer.appendChild(listContainer);

    // Highlight currently playing track if any
    highlightCurrentTrack();
}

// Format duration from milliseconds to mm:ss
function formatDuration(ms) {
    if (!ms) return '';
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

// Format total duration for album header
function formatTotalDuration(ms) {
    const minutes = Math.floor(ms / 60000);
    if (minutes >= 60) {
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return `${hours} uur ${mins} min`;
    }
    return `${minutes} min`;
}

// Load tracks from playlist
async function loadTracks(playlistId, playlistBtn) {
    // Store current playlist ID for playback context
    currentPlaylistId = playlistId;
    currentArtistId = null; // Clear artist context

    // Update active state
    document.querySelectorAll('.playlist-item').forEach(btn => {
        btn.classList.remove('active');
    });
    playlistBtn.classList.add('active');

    const cacheKey = CACHE_KEYS.TRACKS_PREFIX + playlistId;

    // Check cache first
    const cached = getCache(cacheKey);
    if (cached) {
        renderTracks(cached);
        updateURL();
        return;
    }

    tracksContainer.innerHTML = '<div class="loading">Nummers laden...</div>';

    try {
        const response = await fetch(`/api/playlist/${playlistId}`);
        const tracks = await response.json();

        // Cache the result
        setCache(cacheKey, tracks);
        renderTracks(tracks);
        updateURL();
    } catch (error) {
        console.error('Error loading tracks:', error);
        tracksContainer.innerHTML = '<div class="empty-state">Fout bij laden van nummers</div>';
    }
}

// Render tracks to DOM
function renderTracks(tracks) {
    tracksContainer.innerHTML = '';

    if (tracks.length === 0) {
        tracksContainer.innerHTML = '<div class="empty-state">Geen nummers gevonden</div>';
        return;
    }

    tracks.forEach(track => {
        const trackDiv = document.createElement('div');
        trackDiv.className = 'track-item';
        trackDiv.setAttribute('data-track-id', track.id);

        // Always create image element with fallback to prevent layout shift
        const img = document.createElement('img');
        img.src = track.image || '/static/img/placeholder.svg';
        img.alt = track.name;
        img.className = 'track-image';
        trackDiv.appendChild(img);

        // Create text container
        const textDiv = document.createElement('div');
        textDiv.className = 'track-info-text';
        textDiv.innerHTML = `
            <div class="track-name">${escapeHtml(track.name)}</div>
            <div class="track-artist">${escapeHtml(track.artist)}</div>
        `;
        trackDiv.appendChild(textDiv);

        trackDiv.onclick = () => playTrack(track.uri);
        tracksContainer.appendChild(trackDiv);
    });

    // Highlight currently playing track if any
    highlightCurrentTrack();
}

// Play specific track
async function playTrack(uri) {
    try {
        const response = await fetch('/api/play-track', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                uri: uri,
                playlist_id: currentPlaylistId,
                album_id: currentAlbumId
            })
        });

        if (!response.ok) {
            const data = await response.json();
            showToast(data.error || 'Er ging iets mis bij het afspelen', 'error');
            return;
        }

        isPlaying = true;
        updatePlayPauseButton();
        // Update current track after a short delay
        setTimeout(updateCurrentTrack, 500);
    } catch (error) {
        console.error('Error playing track:', error);
        showToast('Er ging iets mis bij het afspelen', 'error');
    }
}

// Toggle play/pause
async function togglePlayPause() {
    try {
        const endpoint = isPlaying ? '/api/pause' : '/api/play';
        const response = await fetch(endpoint, { method: 'POST' });

        if (!response.ok) {
            const data = await response.json();
            showToast(data.error || 'Er ging iets mis bij het afspelen', 'error');
            return;
        }

        isPlaying = !isPlaying;
        updatePlayPauseButton();
    } catch (error) {
        console.error('Error toggling playback:', error);
        showToast('Er ging iets mis bij het afspelen', 'error');
    }
}

// Previous track
async function previousTrack() {
    try {
        const response = await fetch('/api/previous', { method: 'POST' });
        if (!response.ok) {
            const data = await response.json();
            showToast(data.error || 'Er ging iets mis bij het vorige nummer', 'error');
            return;
        }
        setTimeout(updateCurrentTrack, 500);
    } catch (error) {
        console.error('Error skipping to previous track:', error);
        showToast('Er ging iets mis bij het vorige nummer', 'error');
    }
}

// Next track
async function nextTrack() {
    try {
        const response = await fetch('/api/next', { method: 'POST' });
        if (!response.ok) {
            const data = await response.json();
            showToast(data.error || 'Er ging iets mis bij het volgende nummer', 'error');
            return;
        }
        setTimeout(updateCurrentTrack, 500);
    } catch (error) {
        console.error('Error skipping to next track:', error);
        showToast('Er ging iets mis bij het volgende nummer', 'error');
    }
}

// Toggle shuffle
async function toggleShuffle() {
    try {
        const response = await fetch('/api/shuffle', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ state: !isShuffleOn })
        });

        if (response.ok) {
            isShuffleOn = !isShuffleOn;
            updateShuffleButton();
        }
    } catch (error) {
        console.error('Error toggling shuffle:', error);
    }
}

// Update shuffle button
function updateShuffleButton() {
    shuffleBtn.classList.toggle('shuffle-on', isShuffleOn);
}

// Handle volume change - controls system audio volume (not Spotify)
function handleVolumeChange() {
    const volume = volumeSlider.value;
    updateVolumeIcon(volume);

    // Debounce API calls - short delay for responsive feel
    clearTimeout(volumeDebounceTimer);
    volumeDebounceTimer = setTimeout(async () => {
        try {
            const response = await fetch('/api/audio/volume', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ volume: parseInt(volume) })
            });
            if (!response.ok) {
                const data = await response.json();
                showToast(data.error || 'Fout bij volume aanpassen', 'error');
            }
        } catch (error) {
            console.error('Error setting volume:', error);
        }
    }, 50);
}

// Load current system volume and sync slider
async function loadSystemVolume() {
    try {
        const response = await fetch('/api/audio/volume');
        const data = await response.json();
        if (data.volume !== undefined) {
            volumeSlider.value = data.volume;
            updateVolumeIcon(data.volume);
        }
        // Note: volumeSlider.max stays at 100 - backend handles scaling to actual max_volume
    } catch (error) {
        console.error('Error loading system volume:', error);
    }
}

// Load volume settings (default and max) and sync sliders
async function loadVolumeSettings() {
    try {
        const response = await fetch('/api/settings/volume');
        const data = await response.json();

        // Update default volume slider
        if (data.default_volume !== undefined && defaultVolumeSlider && defaultVolumeValue) {
            defaultVolumeSlider.value = data.default_volume;
            defaultVolumeValue.textContent = data.default_volume + '%';
        }

        // Update max volume slider
        if (data.max_volume !== undefined && maxVolumeSlider && maxVolumeValueEl) {
            maxVolumeSlider.value = data.max_volume;
            maxVolumeValueEl.textContent = data.max_volume + '%';
            currentMaxVolume = data.max_volume;

            // Update default slider max to not exceed max volume
            if (defaultVolumeSlider) {
                defaultVolumeSlider.max = data.max_volume;
            }
        }
    } catch (error) {
        console.error('Error loading volume settings:', error);
    }
}

// Alias for backwards compatibility
async function loadDefaultVolumeSetting() {
    return loadVolumeSettings();
}

// Save volume setting (default or max)
async function saveVolumeSetting(key, value) {
    try {
        const body = {};
        body[key] = parseInt(value);

        const response = await fetch('/api/settings/volume', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        const data = await response.json();

        if (!response.ok) {
            showToast(data.error || 'Fout bij opslaan', 'error');
        } else {
            // Update currentMaxVolume for reference and default slider
            if (data.max_volume !== undefined) {
                currentMaxVolume = data.max_volume;

                // Update default slider max (setting slider max is OK - it's in protected settings)
                if (defaultVolumeSlider) {
                    defaultVolumeSlider.max = data.max_volume;
                    // Ensure default doesn't exceed max
                    if (parseInt(defaultVolumeSlider.value) > data.max_volume) {
                        defaultVolumeSlider.value = data.max_volume;
                        defaultVolumeValue.textContent = data.max_volume + '%';
                    }
                }

                // Reload volume to rescale slider to new max
                // (e.g., if max was 80 and is now 60, slider at 50% means different actual volume)
                loadSystemVolume();
            }
        }
    } catch (error) {
        console.error('Error saving volume setting:', error);
    }
}

// Setup volume settings sliders event listeners
function setupVolumeSettingsSliders() {
    let saveTimer = null;

    // Default volume slider
    if (defaultVolumeSlider && defaultVolumeValue) {
        defaultVolumeSlider.addEventListener('input', () => {
            const value = defaultVolumeSlider.value;
            defaultVolumeValue.textContent = value + '%';

            clearTimeout(saveTimer);
            saveTimer = setTimeout(() => {
                saveVolumeSetting('default_volume', value);
            }, 300);
        });
    }

    // Max volume slider
    if (maxVolumeSlider && maxVolumeValueEl) {
        maxVolumeSlider.addEventListener('input', () => {
            const value = maxVolumeSlider.value;
            maxVolumeValueEl.textContent = value + '%';

            clearTimeout(saveTimer);
            saveTimer = setTimeout(() => {
                saveVolumeSetting('max_volume', value);
            }, 300);
        });
    }
}

// Alias for backwards compatibility
function setupDefaultVolumeSlider() {
    setupVolumeSettingsSliders();
}

// Update volume icon based on volume level
function updateVolumeIcon(volume) {
    if (volume == 0) {
        // Muted icon
        volumeIconPath.setAttribute('d', 'M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z');
    } else if (volume < 30) {
        // Low volume icon
        volumeIconPath.setAttribute('d', 'M7 9v6h4l5 5V4l-5 5H7z');
    } else if (volume < 70) {
        // Medium volume icon
        volumeIconPath.setAttribute('d', 'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z');
    } else {
        // High volume icon
        volumeIconPath.setAttribute('d', 'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z');
    }
}

// Start progress interpolation interval
function startProgressInterpolation() {
    if (progressInterpolationInterval) {
        clearInterval(progressInterpolationInterval);
    }
    progressInterpolationInterval = setInterval(() => {
        if (isPlaying && trackDuration > 0) {
            const elapsed = Date.now() - lastProgressUpdate;
            trackProgress = Math.min(trackProgress + elapsed, trackDuration);
            lastProgressUpdate = Date.now();
            updateProgressDisplay();
        }
    }, 1000);
}

// Update progress display
function updateProgressDisplay() {
    if (trackDuration > 0) {
        const progressPercent = (trackProgress / trackDuration) * 100;
        progressFill.style.width = `${progressPercent}%`;
        currentTimeEl.textContent = formatTime(trackProgress);
        totalTimeEl.textContent = formatTime(trackDuration);
    }
}

// Format time in milliseconds to mm:ss
function formatTime(ms) {
    // Validatie: negatief of ongeldig = toon placeholder
    if (ms === null || ms === undefined || ms < 0 || !isFinite(ms)) {
        return '—:——';
    }
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

// Helper for mouse and touch coordinates
function getClientX(e) {
    if (e.touches && e.touches.length > 0) {
        return e.touches[0].clientX;
    }
    if (e.changedTouches && e.changedTouches.length > 0) {
        return e.changedTouches[0].clientX;
    }
    return e.clientX;
}

// Handle progress bar click/tap
function handleProgressBarClick(e) {
    if (trackDuration === 0) return;

    const rect = progressBar.getBoundingClientRect();
    const clickX = getClientX(e) - rect.left;
    const percent = Math.max(0, Math.min(1, clickX / rect.width));
    const newPosition = Math.floor(percent * trackDuration);

    seekToPosition(newPosition);
}

// Start progress drag (mouse and touch)
function startProgressDrag(e) {
    if (trackDuration === 0) return;

    e.preventDefault();
    const isTouch = e.type === 'touchstart';

    const handleDrag = (e) => {
        if (isTouch) e.preventDefault();
        const rect = progressBar.getBoundingClientRect();
        const dragX = Math.max(0, Math.min(getClientX(e) - rect.left, rect.width));
        const percent = dragX / rect.width;
        const newProgress = Math.floor(percent * trackDuration);

        // Update display immediately for smooth feedback
        trackProgress = newProgress;
        updateProgressDisplay();
    };

    const stopDrag = (e) => {
        document.removeEventListener('mousemove', handleDrag);
        document.removeEventListener('mouseup', stopDrag);
        document.removeEventListener('touchmove', handleDrag);
        document.removeEventListener('touchend', stopDrag);

        // Seek to final position
        const rect = progressBar.getBoundingClientRect();
        const dragX = Math.max(0, Math.min(getClientX(e) - rect.left, rect.width));
        const percent = dragX / rect.width;
        const newPosition = Math.floor(percent * trackDuration);

        seekToPosition(newPosition);
    };

    document.addEventListener('mousemove', handleDrag);
    document.addEventListener('mouseup', stopDrag);
    document.addEventListener('touchmove', handleDrag, { passive: false });
    document.addEventListener('touchend', stopDrag);
}

// Seek to position
async function seekToPosition(position_ms) {
    try {
        const response = await fetch('/api/seek', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ position_ms: position_ms })
        });

        if (!response.ok) {
            const data = await response.json();
            showToast(data.error || 'Fout bij positie aanpassen', 'error');
            return;
        }

        // Update local state
        trackProgress = position_ms;
        lastProgressUpdate = Date.now();
        updateProgressDisplay();
    } catch (error) {
        console.error('Error seeking:', error);
    }
}

// Update current track display
async function updateCurrentTrack() {
    try {
        const response = await fetch('/api/current');
        const data = await response.json();

        if (data.playing !== undefined) {
            isPlaying = data.playing;
            updatePlayPauseButton();
        }

        if (data.shuffle !== undefined) {
            isShuffleOn = data.shuffle;
            updateShuffleButton();
        }

        // Volume is now controlled via system audio, not Spotify
        // Volume slider is synced via loadSystemVolume() on page load

        if (data.track) {
            // Track playing - show real data
            albumArt.src = data.track.image || '/static/img/placeholder.svg';
            albumArt.classList.remove('hidden');
            noTrack.style.display = 'none';
            trackName.textContent = data.track.name;
            trackArtist.textContent = data.track.artist;

            // Store current track ID and highlight in list
            currentTrackId = data.track.id;
            highlightCurrentTrack();

            // Update progress (met validatie voor ongeldige waarden)
            trackDuration = data.track.duration_ms || 0;
            trackProgress = data.track.progress_ms || 0;
            // Extra validatie voor edge cases
            if (trackProgress < 0) trackProgress = 0;
            if (trackDuration > 0 && trackProgress > trackDuration) trackProgress = trackDuration;
            lastProgressUpdate = Date.now();
            updateProgressDisplay();
        } else {
            // No track playing - show placeholders (keep elements visible)
            albumArt.classList.add('hidden');
            noTrack.style.display = 'block';
            trackName.textContent = '-';
            trackArtist.textContent = '-';

            // Clear current track ID and remove highlights
            currentTrackId = null;
            highlightCurrentTrack();

            // Reset progress to 0:00
            trackDuration = 0;
            trackProgress = 0;
            updateProgressDisplay();
        }
    } catch (error) {
        console.error('Error updating current track:', error);
    }
}

// Highlight currently playing track in the track list
function highlightCurrentTrack() {
    // Remove existing playing class from all tracks
    document.querySelectorAll('.album-track-item.playing, .track-item.playing').forEach(el => {
        el.classList.remove('playing');
    });

    // If no track is playing, we're done
    if (!currentTrackId) return;

    // Find and highlight the matching track
    document.querySelectorAll('.album-track-item[data-track-id], .track-item[data-track-id]').forEach(el => {
        if (el.getAttribute('data-track-id') === currentTrackId) {
            el.classList.add('playing');
        }
    });
}

// Update play/pause button
function updatePlayPauseButton() {
    if (isPlaying) {
        // Pause icon
        playPauseIcon.innerHTML = '<path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>';
        playPauseBtn.classList.add('playing');
    } else {
        // Play icon
        playPauseIcon.innerHTML = '<path d="M8 5v14l11-7z"/>';
        playPauseBtn.classList.remove('playing');
    }
}

// Settings modal
function showSettingsModal() {
    settingsModal.classList.remove('hidden');
    // Reset to first tab (theme) when opening
    switchTab('theme');
}

function hideSettingsModal() {
    settingsModal.classList.add('hidden');
    stopDevicePolling(); // Stop polling when modal closes
    settingsUnlocked = false; // Reset PIN unlock state
}

// Refresh content (playlists or artists based on current view)
function refreshPlaylists() {
    if (currentViewMode === 'playlists') {
        clearPlaylistCache();
        loadPlaylists();
    } else {
        clearArtistCache();
        loadArtists();
    }
    hideSettingsModal();
}

// Tab switching
function switchTab(tabName) {
    // Check if protected tab requires PIN
    const protectedTabs = ['bluetooth', 'other'];
    if (protectedTabs.includes(tabName) && !settingsUnlocked) {
        showSettingsPinModal(tabName);
        return;
    }

    // Remove active class from all tabs and panels
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelectorAll('.tab-panel').forEach(panel => {
        panel.classList.remove('active');
    });

    // Add active class to selected tab and panel
    document.querySelector(`.tab-btn[data-tab="${tabName}"]`).classList.add('active');
    document.getElementById(`tab-${tabName}`).classList.add('active');

    // Stop any existing polling
    stopDevicePolling();
    stopBluetoothPolling();

    // Load devices and audio devices when switching to devices tab
    if (tabName === 'devices') {
        loadDevices();
        loadAudioDevices();
        startDevicePolling();
    }

    // Load Bluetooth devices when switching to bluetooth tab
    if (tabName === 'bluetooth') {
        loadBluetoothDevices();
        startBluetoothPolling();
    }

    // Load default volume setting when switching to other tab
    if (tabName === 'other') {
        loadDefaultVolumeSetting();
    }
}

// Start device polling (every 3 seconds)
function startDevicePolling() {
    stopDevicePolling(); // Clear any existing interval
    devicePollingInterval = setInterval(loadDevices, 3000);
}

// Stop device polling
function stopDevicePolling() {
    if (devicePollingInterval) {
        clearInterval(devicePollingInterval);
        devicePollingInterval = null;
    }
}

// Load Spotify devices
async function loadDevices() {
    try {
        const response = await fetch('/api/devices');
        const data = await response.json();

        const devicesList = document.getElementById('devices-list');
        devicesList.innerHTML = '';

        const devices = data.devices || [];

        if (devices.length === 0) {
            devicesList.innerHTML = '<div class="empty-state">Geen apparaten gevonden</div>';
            return;
        }

        devices.forEach(device => {
            const deviceDiv = createDeviceElement(device);
            devicesList.appendChild(deviceDiv);
        });
    } catch (error) {
        console.error('Error loading devices:', error);
        document.getElementById('devices-list').innerHTML = '<div class="empty-state">Fout bij laden van apparaten</div>';
    }
}

function createDeviceElement(device) {
    const div = document.createElement('div');
    div.className = 'device-item';
    if (device.is_active) div.classList.add('active');

    const icon = getDeviceIcon(device.type);
    const activeDot = device.is_active ? '<span class="active-dot"></span>' : '';

    div.innerHTML = `
        <span class="device-icon">${icon}</span>
        <div class="device-info">
            <div class="device-name">${escapeHtml(device.name)}</div>
            <div class="device-type">${escapeHtml(device.type)}</div>
        </div>
        ${activeDot}
    `;

    div.onclick = () => selectDevice(device.id);
    return div;
}

function createLocalDeviceElement(device) {
    const div = document.createElement('div');
    div.className = 'device-item local-device';

    // Use Speaker icon for local Spotify Connect devices
    const icon = '<svg class="icon" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>';

    const displayName = device.remote_name || device.name;
    const deviceInfo = device.ip ? `${device.ip}:${device.port}` : 'Lokaal netwerk';

    div.innerHTML = `
        <span class="device-icon">${icon}</span>
        <div class="device-info">
            <div class="device-name">${escapeHtml(displayName)}</div>
            <div class="device-type">${escapeHtml(deviceInfo)}</div>
        </div>
        <span class="local-badge">mDNS</span>
    `;

    // Click to activate/transfer to local device
    div.onclick = () => selectLocalDevice(device);

    return div;
}

async function selectLocalDevice(device) {
    const deviceId = device.device_id;
    const displayName = device.remote_name || device.name;

    if (!deviceId) {
        showToast('Device ID niet beschikbaar', 'error');
        return;
    }

    try {
        // First try direct transfer with the mDNS device_id
        const response = await fetch('/api/transfer-playback-local', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ device_id: deviceId })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            showToast(`Afspelen op ${displayName}`, 'info');
            loadDevices(); // Refresh device list
        } else if (data.needs_activation) {
            // Device needs ZeroConf activation
            showToast('Device moet eerst geactiveerd worden...', 'info');
            await activateLocalDevice(device);
        } else {
            showToast(data.error || 'Fout bij selecteren device', 'error');
        }
    } catch (error) {
        console.error('Error selecting local device:', error);
        showToast('Fout bij verbinden met device', 'error');
    }
}

async function activateLocalDevice(device) {
    const ip = device.ip;
    const port = device.port;
    const deviceId = device.device_id;
    const displayName = device.remote_name || device.name;

    try {
        // Try ZeroConf activation (backend handles device matching and transfer)
        const response = await fetch('/api/devices/local/activate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ip, port, device_name: displayName })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            // Backend handles activation, device matching, and transfer
            if (data.spotify_device_id) {
                // Transfer was successful
                showToast(data.message || `Afspelen op ${displayName}`, 'info');
                loadDevices();
            } else if (data.warning) {
                // Activation worked but device not found in Spotify
                showToast(data.message || data.warning, 'error');
                loadDevices();
            } else {
                // Activation only (no device_name was passed)
                showToast(data.message || `${displayName} geactiveerd`, 'info');
                loadDevices();
            }
        } else {
            showToast(data.error || 'Activatie mislukt', 'error');
        }
    } catch (error) {
        console.error('Error activating device:', error);
        showToast('Fout bij activeren device', 'error');
    }
}

function getDeviceIcon(type) {
    const icons = {
        'Computer': '<svg class="icon" viewBox="0 0 24 24" fill="currentColor"><path d="M20 18c1.1 0 1.99-.9 1.99-2L22 6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2H0v2h24v-2h-4zM4 6h16v10H4V6z"/></svg>',
        'Smartphone': '<svg class="icon" viewBox="0 0 24 24" fill="currentColor"><path d="M17 1.01L7 1c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-1.99-2-1.99zM17 19H7V5h10v14z"/></svg>',
        'Speaker': '<svg class="icon" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>',
        'TV': '<svg class="icon" viewBox="0 0 24 24" fill="currentColor"><path d="M21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h5v2h8v-2h5c1.1 0 1.99-.9 1.99-2L23 5c0-1.1-.9-2-2-2zm0 14H3V5h18v12z"/></svg>'
    };
    return icons[type] || '<svg class="icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v9.28c-.47-.17-.97-.28-1.5-.28C8.01 12 6 14.01 6 16.5S8.01 21 10.5 21c2.31 0 4.2-1.75 4.45-4H15V6h4V3h-7z"/></svg>';
}

async function selectDevice(deviceId) {
    try {
        const response = await fetch('/api/transfer-playback', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ device_id: deviceId })
        });

        if (response.ok) {
            loadDevices(); // Refresh device list to show new active device
        }
    } catch (error) {
        console.error('Error transferring playback:', error);
    }
}

// Audio Device Management
// Preload audio devices in background (silent, no UI update)
async function preloadAudioDevices() {
    try {
        const response = await fetch('/api/audio/devices');
        const data = await response.json();

        if (!data.error) {
            cachedAudioDevices = data;
            cachedAudioDevicesTimestamp = Date.now();
        }
    } catch (error) {
        // Silent failure - non-critical background operation
        console.debug('Audio device preload failed (non-critical):', error);
    }
}

async function loadAudioDevices() {
    const audioDevicesList = document.getElementById('audio-devices-list');

    // Use cache if fresh (less than 60 seconds old)
    if (cachedAudioDevices &&
        cachedAudioDevicesTimestamp &&
        (Date.now() - cachedAudioDevicesTimestamp) < CACHE_DURATION) {

        renderAudioDevices(audioDevicesList, cachedAudioDevices);
        preloadAudioDevices(); // Refresh cache in background
        return;
    }

    // Otherwise fetch fresh data
    try {
        const response = await fetch('/api/audio/devices');
        const data = await response.json();

        // Update cache
        cachedAudioDevices = data;
        cachedAudioDevicesTimestamp = Date.now();

        renderAudioDevices(audioDevicesList, data);
    } catch (error) {
        console.error('Error loading audio devices:', error);
        audioDevicesList.innerHTML = '<div class="empty-state">Fout bij laden van audio apparaten</div>';
    }
}

function createAudioDeviceElement(device) {
    const div = document.createElement('div');
    div.className = 'device-item';
    div.setAttribute('data-device-id', device.id);
    const isSelected = device.is_active || device.is_default;
    if (isSelected) div.classList.add('active');

    const icon = getAudioDeviceIcon(device.name);
    const activeDot = isSelected ? '<span class="active-dot"></span>' : '';

    div.innerHTML = `
        <span class="device-icon">${icon}</span>
        <div class="device-info">
            <div class="device-name">${escapeHtml(device.name)}</div>
        </div>
        ${activeDot}
    `;

    div.onclick = () => selectAudioDevice(device.id);
    return div;
}

function getAudioDeviceIcon(deviceName) {
    const name = deviceName.toLowerCase();

    // Check for Headphones - EXTENSIVE KEYWORD LIST
    const headphoneKeywords = [
        // Generic terms
        'headphone', 'headphones', 'headset', 'earphone', 'earphones',
        'earbud', 'earbuds', 'in-ear', 'on-ear', 'over-ear',

        // Dutch terms
        'koptelefoon', 'hoofdtelefoon', 'oortelefoon', 'oordopjes', 'oortjes',

        // Common brands (often in device names)
        'airpods', 'beats', 'bose', 'sony wh', 'sony wf', 'jabra',
        'sennheiser', 'jbl', 'plantronics', 'hyperx', 'steelseries',
        'razer', 'logitech g', 'corsair hs',

        // Device types
        'gaming headset', 'wireless headset', 'usb headset',

        // Technical indicators
        'hands-free', 'headset (', 'hp (', 'hs (',

        // Port indicators
        '3.5mm', 'audio jack'
    ];

    for (let keyword of headphoneKeywords) {
        if (name.includes(keyword)) {
            return '<svg class="icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 1c-4.97 0-9 4.03-9 9v7c0 1.66 1.34 3 3 3h3v-8H5v-2c0-3.87 3.13-7 7-7s7 3.13 7 7v2h-4v8h3c1.66 0 3-1.34 3-3v-7c0-4.97-4.03-9-9-9z"/></svg>';
        }
    }

    // Default: Speaker icon
    return '<svg class="icon" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>';
}

async function selectAudioDevice(deviceId) {
    // Check if already switching
    if (isAudioSwitching) {
        console.log('Already switching audio device');
        return;
    }

    // Check cooldown
    const now = Date.now();
    const timeSinceLastSwitch = now - lastSwitchTime;
    if (timeSinceLastSwitch < COOLDOWN_MS) {
        const remainingSeconds = Math.ceil((COOLDOWN_MS - timeSinceLastSwitch) / 1000);
        showToast(`Wacht nog ${remainingSeconds} seconde${remainingSeconds > 1 ? 'n' : ''}...`);
        return;
    }

    isAudioSwitching = true;

    // Disable all device buttons and add loading state
    const allDevices = document.querySelectorAll('.device-item');
    const clickedDevice = Array.from(allDevices).find(
        el => el.getAttribute('data-device-id') === deviceId
    );

    allDevices.forEach(btn => {
        btn.classList.add('disabled');
        btn.style.pointerEvents = 'none';
    });

    if (clickedDevice) {
        clickedDevice.classList.add('switching');
        const spinner = document.createElement('span');
        spinner.className = 'device-loading-spinner';
        spinner.innerHTML = '<svg class="icon" viewBox="0 0 24 24" fill="currentColor"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>';
        clickedDevice.appendChild(spinner);
    }

    try {
        const response = await fetch('/api/audio/output', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ device_id: deviceId })
        });

        if (response.ok) {
            // Update last switch time for cooldown
            lastSwitchTime = Date.now();

            // Invalidate frontend cache to force fresh fetch
            cachedAudioDevices = null;
            cachedAudioDevicesTimestamp = null;

            // Wait for system to update default device (100ms delay)
            await new Promise(resolve => setTimeout(resolve, 100));

            // Reload devices to show new active state
            await loadAudioDevices();

            // Sync volume slider (backend resets to safe default on device switch)
            await loadSystemVolume();

            // Show success animation
            showSuccessCheck(clickedDevice);
        } else {
            const errorData = await response.json();
            showToast(errorData.error || 'Kon niet schakelen', 'error');
        }
    } catch (error) {
        console.error('Error switching audio device:', error);
        showToast('Fout bij schakelen', 'error');
    } finally {
        isAudioSwitching = false;
        // Re-enable all buttons (loadAudioDevices will have refreshed the list)
        document.querySelectorAll('.device-item').forEach(btn => {
            btn.classList.remove('disabled', 'switching');
            btn.style.pointerEvents = '';
        });
    }
}

function showSuccessCheck(element) {
    if (!element) return;

    const check = document.createElement('div');
    check.className = 'success-check';
    check.textContent = '✓';
    element.appendChild(check);

    setTimeout(() => check.remove(), 800);
}

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 2000);
}

// Shutdown modal
function showShutdownModal() {
    shutdownModal.classList.remove('hidden');
}

function hideShutdownModal() {
    shutdownModal.classList.add('hidden');
}

async function confirmShutdown() {
    try {
        const response = await fetch('/api/system/shutdown', { method: 'POST' });
        const data = await response.json();

        hideShutdownModal();

        if (response.ok) {
            showToast(data.message || 'Systeem wordt uitgeschakeld...', 'info');
        } else {
            showToast(data.error || 'Er ging iets mis', 'error');
        }
    } catch (error) {
        console.error('Error shutting down:', error);
        showToast('Fout bij uitschakelen', 'error');
    }
}

// Reboot modal
function showRebootModal() {
    rebootModal.classList.remove('hidden');
}

function hideRebootModal() {
    rebootModal.classList.add('hidden');
}

async function confirmReboot() {
    try {
        const response = await fetch('/api/system/reboot', { method: 'POST' });
        const data = await response.json();

        hideRebootModal();

        if (response.ok) {
            showToast(data.message || 'Systeem wordt herstart...', 'info');
        } else {
            showToast(data.error || 'Er ging iets mis', 'error');
        }
    } catch (error) {
        console.error('Error rebooting:', error);
        showToast('Fout bij herstarten', 'error');
    }
}

// Poll current track every 5 seconds
function startCurrentTrackPolling() {
    updateCurrentTrack();
    setInterval(updateCurrentTrack, 5000);
}

// Utility: Escape HTML to prevent XSS
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Theme Management
function loadSavedTheme() {
    // Load from localStorage or use defaults
    currentTheme = localStorage.getItem('theme') || 'light';
    primaryColor = localStorage.getItem('primaryColor') || '#667eea';
    secondaryColor = localStorage.getItem('secondaryColor') || '#764ba2';
    accentColor = localStorage.getItem('accentColor') || '#eacd66';

    applyTheme();
}

function saveTheme() {
    localStorage.setItem('theme', currentTheme);
    localStorage.setItem('primaryColor', primaryColor);
    localStorage.setItem('secondaryColor', secondaryColor);
    localStorage.setItem('accentColor', accentColor);
}

function applyTheme() {
    // Set data attribute for dark/light mode
    document.body.setAttribute('data-theme', currentTheme);

    // Set CSS custom properties
    document.documentElement.style.setProperty('--primary-color', primaryColor);
    document.documentElement.style.setProperty('--secondary-color', secondaryColor);
    document.documentElement.style.setProperty('--accent-color', accentColor);
    document.documentElement.style.setProperty('--bg-gradient-start', primaryColor);
    document.documentElement.style.setProperty('--bg-gradient-end', secondaryColor);

    // Update UI buttons
    updateThemeUI();
}

function updateThemeUI() {
    // Update preset button active states
    document.querySelectorAll('.theme-preset-btn').forEach(btn => {
        const btnTheme = btn.getAttribute('data-theme');
        const btnPrimary = btn.getAttribute('data-primary');
        const btnSecondary = btn.getAttribute('data-secondary');

        const isActive = btnTheme === currentTheme &&
                        btnPrimary === primaryColor &&
                        btnSecondary === secondaryColor;

        btn.classList.toggle('active', isActive);
    });
}

function applyPreset(theme, primary, secondary, accent) {
    currentTheme = theme;
    primaryColor = primary;
    secondaryColor = secondary;
    accentColor = accent;
    applyTheme();
    saveTheme();
}

function setupThemeListeners() {
    // Theme preset buttons (16 presets)
    document.querySelectorAll('.theme-preset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const theme = btn.getAttribute('data-theme');
            const primary = btn.getAttribute('data-primary');
            const secondary = btn.getAttribute('data-secondary');
            const accent = btn.getAttribute('data-accent');
            applyPreset(theme, primary, secondary, accent);
        });
    });
}

// =============================================================================
// Bluetooth Management
// =============================================================================

async function loadBluetoothDevices() {
    try {
        const response = await fetch('/api/bluetooth/devices');
        const data = await response.json();

        if (data.error) {
            // Bluetooth not available (e.g., on Windows)
            document.getElementById('bt-paired-list').innerHTML =
                '<div class="empty-state">Bluetooth niet beschikbaar</div>';
            document.getElementById('bt-discovered-section').style.display = 'none';
            return;
        }

        bluetoothState.pairedDevices = data.paired || [];
        bluetoothState.discoveredDevices = data.discovered || [];
        bluetoothState.scanning = data.scanning || false;

        renderBluetoothDevices();
        updateBluetoothScanButton();
    } catch (error) {
        console.error('Error loading Bluetooth devices:', error);
        document.getElementById('bt-paired-list').innerHTML =
            '<div class="empty-state">Fout bij laden</div>';
    }
}

function renderBluetoothDevices() {
    const pairedList = document.getElementById('bt-paired-list');
    const discoveredSection = document.getElementById('bt-discovered-section');
    const discoveredList = document.getElementById('bt-discovered-list');

    // Render paired devices
    if (bluetoothState.pairedDevices.length === 0) {
        pairedList.innerHTML = '<div class="empty-state">Geen gekoppelde apparaten</div>';
    } else {
        pairedList.innerHTML = '';
        bluetoothState.pairedDevices.forEach(device => {
            pairedList.appendChild(createBluetoothDeviceElement(device, true));
        });
    }

    // Render discovered devices
    if (bluetoothState.discoveredDevices.length > 0 || bluetoothState.scanning) {
        discoveredSection.style.display = 'block';
        if (bluetoothState.discoveredDevices.length === 0) {
            discoveredList.innerHTML = bluetoothState.scanning
                ? '<div class="loading">Zoeken naar apparaten...</div>'
                : '<div class="empty-state">Geen apparaten gevonden</div>';
        } else {
            discoveredList.innerHTML = '';
            bluetoothState.discoveredDevices.forEach(device => {
                discoveredList.appendChild(createBluetoothDeviceElement(device, false));
            });
        }
    } else {
        discoveredSection.style.display = 'none';
    }
}

function createBluetoothDeviceElement(device, isPaired) {
    const div = document.createElement('div');
    div.className = 'device-item bt-device';
    div.setAttribute('data-bt-address', device.address);

    // State-based classes
    if (device.connected) div.classList.add('active');
    if (device.address === bluetoothState.connectingDevice) div.classList.add('connecting');
    if (device.address === bluetoothState.pairingDevice) div.classList.add('pairing');
    if (!isPaired) div.classList.add('discovered');

    const icon = getBluetoothDeviceIcon(device);
    const statusText = getBluetoothDeviceStatus(device, isPaired);
    const activeDot = device.connected ? '<span class="active-dot"></span>' : '';

    // Spinner for connecting/pairing
    let spinner = '';
    if (device.address === bluetoothState.connectingDevice ||
        device.address === bluetoothState.pairingDevice) {
        spinner = `<span class="device-loading-spinner">
            <svg class="icon" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
            </svg>
        </span>`;
    }

    // Forget button for paired devices
    const forgetBtn = isPaired ? `
        <button class="btn-bt-forget" data-address="${device.address}">Vergeten</button>
    ` : '';

    div.innerHTML = `
        <span class="device-icon">${icon}</span>
        <div class="device-info">
            <div class="device-name">${escapeHtml(device.name || 'Onbekend apparaat')}</div>
            <div class="device-status">${statusText}</div>
        </div>
        ${spinner}
        ${activeDot}
        ${forgetBtn}
    `;

    // Click handler for device body
    div.onclick = (e) => {
        // Ignore clicks on forget button
        if (e.target.closest('.btn-bt-forget')) {
            e.stopPropagation();
            showForgetModal(device);
            return;
        }
        handleBluetoothDeviceClick(device, isPaired);
    };

    return div;
}

function getBluetoothDeviceIcon(device) {
    const iconType = (device.icon || '').toLowerCase();

    // Headphones icon
    if (iconType.includes('audio-headset') || iconType.includes('audio-headphones')) {
        return '<svg class="icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 1c-4.97 0-9 4.03-9 9v7c0 1.66 1.34 3 3 3h3v-8H5v-2c0-3.87 3.13-7 7-7s7 3.13 7 7v2h-4v8h3c1.66 0 3-1.34 3-3v-7c0-4.97-4.03-9-9-9z"/></svg>';
    }

    // Default: Bluetooth icon
    return '<svg class="icon" viewBox="0 0 24 24" fill="currentColor"><path d="M17.71 7.71L12 2h-1v7.59L6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 11 14.41V22h1l5.71-5.71-4.3-4.29 4.3-4.29zM13 5.83l1.88 1.88L13 9.59V5.83zm1.88 10.46L13 18.17v-3.76l1.88 1.88z"/></svg>';
}

function getBluetoothDeviceStatus(device, isPaired) {
    if (device.address === bluetoothState.connectingDevice) return 'Verbinden...';
    if (device.address === bluetoothState.pairingDevice) return 'Koppelen...';
    if (device.connected) return 'Verbonden';
    if (isPaired) return 'Niet verbonden';
    return 'Beschikbaar';
}

async function handleBluetoothDeviceClick(device, isPaired) {
    // Prevent double clicks while processing
    if (bluetoothState.connectingDevice || bluetoothState.pairingDevice) {
        return;
    }

    if (device.connected) {
        await disconnectBluetoothDevice(device.address);
    } else if (isPaired) {
        await connectBluetoothDevice(device.address);
    } else {
        await pairBluetoothDevice(device.address);
    }
}

async function startBluetoothScan() {
    if (bluetoothState.scanning) {
        await stopBluetoothScan();
        return;
    }

    try {
        const response = await fetch('/api/bluetooth/scan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'start', duration: 30 })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            bluetoothState.scanning = true;
            showToast('Zoeken naar Bluetooth apparaten...', 'info');
            updateBluetoothScanButton();

            // Poll more frequently during scan
            startBluetoothPolling(2000);

            // Auto-stop after 30 seconds
            setTimeout(() => {
                if (bluetoothState.scanning) {
                    bluetoothState.scanning = false;
                    updateBluetoothScanButton();
                    startBluetoothPolling(3000);
                }
            }, 30000);
        } else {
            showToast(data.error || 'Scan starten mislukt', 'error');
        }
    } catch (error) {
        console.error('Error starting Bluetooth scan:', error);
        showToast('Fout bij starten scan', 'error');
    }
}

async function stopBluetoothScan() {
    try {
        await fetch('/api/bluetooth/scan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'stop' })
        });

        bluetoothState.scanning = false;
        updateBluetoothScanButton();
        loadBluetoothDevices();
    } catch (error) {
        console.error('Error stopping Bluetooth scan:', error);
    }
}

function updateBluetoothScanButton() {
    const scanBtn = document.getElementById('btn-bluetooth-scan');
    if (!scanBtn) return;

    if (bluetoothState.scanning) {
        scanBtn.classList.add('scanning');
        scanBtn.querySelector('span').textContent = 'Stoppen';
    } else {
        scanBtn.classList.remove('scanning');
        scanBtn.querySelector('span').textContent = 'Scannen';
    }
}

async function pairBluetoothDevice(address, pin = null) {
    bluetoothState.pairingDevice = address;
    renderBluetoothDevices();

    try {
        const body = { address };
        if (pin) body.pin = pin;

        const response = await fetch('/api/bluetooth/pair', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        const data = await response.json();

        if (response.ok && data.success) {
            showToast('Apparaat gekoppeld', 'info');
            // Auto-connect after pairing
            bluetoothState.pairingDevice = null;
            await connectBluetoothDevice(address);
        } else if (response.status === 202 && data.needs_pin) {
            // Show PIN modal
            bluetoothState.pairingDevice = null;
            bluetoothState.pendingPinDevice = address;
            showPinModal(address);
        } else {
            showToast(data.error || 'Koppelen mislukt', 'error');
            bluetoothState.pairingDevice = null;
        }
    } catch (error) {
        console.error('Error pairing Bluetooth device:', error);
        showToast('Fout bij koppelen', 'error');
        bluetoothState.pairingDevice = null;
    }

    renderBluetoothDevices();
}

async function connectBluetoothDevice(address) {
    bluetoothState.connectingDevice = address;
    renderBluetoothDevices();

    try {
        const response = await fetch('/api/bluetooth/connect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ address })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            showToast('Verbonden', 'info');
            // Refresh audio devices too
            loadAudioDevices();
        } else {
            showToast(data.error || 'Verbinden mislukt', 'error');
        }
    } catch (error) {
        console.error('Error connecting Bluetooth device:', error);
        showToast('Fout bij verbinden', 'error');
    }

    bluetoothState.connectingDevice = null;
    loadBluetoothDevices();
}

async function disconnectBluetoothDevice(address) {
    bluetoothState.connectingDevice = address;
    renderBluetoothDevices();

    try {
        const response = await fetch('/api/bluetooth/disconnect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ address })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            showToast('Losgekoppeld', 'info');
            loadAudioDevices();
        } else {
            showToast(data.error || 'Loskoppelen mislukt', 'error');
        }
    } catch (error) {
        console.error('Error disconnecting Bluetooth device:', error);
        showToast('Fout bij loskoppelen', 'error');
    }

    bluetoothState.connectingDevice = null;
    loadBluetoothDevices();
}

async function forgetBluetoothDevice(address) {
    try {
        const response = await fetch('/api/bluetooth/forget', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ address })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            showToast('Apparaat vergeten', 'info');
            loadAudioDevices();
        } else {
            showToast(data.error || 'Vergeten mislukt', 'error');
        }
    } catch (error) {
        console.error('Error forgetting Bluetooth device:', error);
        showToast('Fout bij vergeten', 'error');
    }

    loadBluetoothDevices();
}

// PIN Modal
function showPinModal(address) {
    const modal = document.getElementById('bt-pin-modal');
    const input = document.getElementById('bt-pin-input');

    modal.classList.remove('hidden');
    input.value = '';
    input.focus();

    bluetoothState.pendingPinDevice = address;
}

function hidePinModal() {
    const modal = document.getElementById('bt-pin-modal');
    modal.classList.add('hidden');
    bluetoothState.pendingPinDevice = null;
}

function submitPin() {
    const input = document.getElementById('bt-pin-input');
    const pin = input.value.trim();
    const address = bluetoothState.pendingPinDevice;

    if (!pin || !address) {
        showToast('Voer een PIN code in', 'error');
        return;
    }

    hidePinModal();
    pairBluetoothDevice(address, pin);
}

// Forget Confirmation Modal
function showForgetModal(device) {
    const modal = document.getElementById('bt-forget-modal');
    const message = document.getElementById('bt-forget-message');

    message.textContent = `Weet je zeker dat je "${device.name || 'dit apparaat'}" wilt vergeten?`;
    modal.classList.remove('hidden');

    // Store device for confirmation
    modal.dataset.address = device.address;
}

function hideForgetModal() {
    const modal = document.getElementById('bt-forget-modal');
    modal.classList.add('hidden');
    delete modal.dataset.address;
}

function confirmForget() {
    const modal = document.getElementById('bt-forget-modal');
    const address = modal.dataset.address;

    hideForgetModal();

    if (address) {
        forgetBluetoothDevice(address);
    }
}

// Bluetooth Polling
function startBluetoothPolling(interval = 3000) {
    stopBluetoothPolling();
    bluetoothPollingInterval = setInterval(loadBluetoothDevices, interval);
}

function stopBluetoothPolling() {
    if (bluetoothPollingInterval) {
        clearInterval(bluetoothPollingInterval);
        bluetoothPollingInterval = null;
    }
}

// Setup Bluetooth event listeners
function setupBluetoothEventListeners() {
    // Scan button
    const scanBtn = document.getElementById('btn-bluetooth-scan');
    if (scanBtn) {
        scanBtn.addEventListener('click', startBluetoothScan);
    }

    // PIN modal buttons
    const cancelPinBtn = document.getElementById('btn-cancel-pin');
    const submitPinBtn = document.getElementById('btn-submit-pin');
    const pinInput = document.getElementById('bt-pin-input');

    if (cancelPinBtn) cancelPinBtn.addEventListener('click', hidePinModal);
    if (submitPinBtn) submitPinBtn.addEventListener('click', submitPin);
    if (pinInput) {
        pinInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') submitPin();
        });
    }

    // Forget modal buttons
    const cancelForgetBtn = document.getElementById('btn-cancel-forget');
    const confirmForgetBtn = document.getElementById('btn-confirm-forget');

    if (cancelForgetBtn) cancelForgetBtn.addEventListener('click', hideForgetModal);
    if (confirmForgetBtn) confirmForgetBtn.addEventListener('click', confirmForget);

    // Close modals on outside click
    const pinModal = document.getElementById('bt-pin-modal');
    const forgetModal = document.getElementById('bt-forget-modal');

    if (pinModal) {
        pinModal.addEventListener('click', (e) => {
            if (e.target === pinModal) hidePinModal();
        });
    }
    if (forgetModal) {
        forgetModal.addEventListener('click', (e) => {
            if (e.target === forgetModal) hideForgetModal();
        });
    }
}

// =============================================================================
// Settings PIN Modal
// =============================================================================

function showSettingsPinModal(targetTab) {
    pendingProtectedTab = targetTab;
    currentPinInput = '';
    updatePinDisplay();
    hideSettingsPinError();

    const modal = document.getElementById('settings-pin-modal');
    modal.classList.remove('hidden');

    // Setup keypad event listeners
    setupSettingsPinKeypad();
}

function hideSettingsPinModal() {
    const modal = document.getElementById('settings-pin-modal');
    modal.classList.add('hidden');
    currentPinInput = '';
    pendingProtectedTab = null;
}

function setupSettingsPinKeypad() {
    const keypad = document.querySelector('#settings-pin-modal .pin-keypad');
    const cancelBtn = document.getElementById('btn-cancel-settings-pin');

    // Remove old listeners by cloning
    const newKeypad = keypad.cloneNode(true);
    keypad.parentNode.replaceChild(newKeypad, keypad);

    // Add keypad click handler
    newKeypad.addEventListener('click', (e) => {
        const key = e.target.closest('.pin-key');
        if (!key) return;

        const keyValue = key.dataset.key;
        if (!keyValue) return;

        if (keyValue === 'backspace') {
            currentPinInput = currentPinInput.slice(0, -1);
            hideSettingsPinError();
        } else if (currentPinInput.length < 6) {
            currentPinInput += keyValue;
            hideSettingsPinError();
        }

        updatePinDisplay();

        // Auto-verify when 6 digits entered
        if (currentPinInput.length === 6) {
            verifySettingsPin();
        }
    });

    // Cancel button
    if (cancelBtn) {
        const newCancelBtn = cancelBtn.cloneNode(true);
        cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
        newCancelBtn.addEventListener('click', hideSettingsPinModal);
    }

    // Close on outside click
    const modal = document.getElementById('settings-pin-modal');
    modal.onclick = (e) => {
        if (e.target === modal) hideSettingsPinModal();
    };
}

function updatePinDisplay() {
    const dots = document.querySelectorAll('#settings-pin-modal .pin-dot');
    dots.forEach((dot, index) => {
        if (index < currentPinInput.length) {
            dot.classList.add('filled');
        } else {
            dot.classList.remove('filled');
        }
    });
}

function showSettingsPinError() {
    const error = document.getElementById('settings-pin-error');
    error.classList.remove('hidden');
}

function hideSettingsPinError() {
    const error = document.getElementById('settings-pin-error');
    error.classList.add('hidden');
}

async function verifySettingsPin() {
    try {
        const response = await fetch('/api/verify-pin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pin: currentPinInput })
        });

        const data = await response.json();

        if (data.success) {
            settingsUnlocked = true;
            const targetTab = pendingProtectedTab; // Save before hiding modal resets it
            hideSettingsPinModal();
            // Now switch to the protected tab
            if (targetTab) {
                switchTab(targetTab);
            }
        } else {
            showSettingsPinError();
            currentPinInput = '';
            updatePinDisplay();
        }
    } catch (error) {
        console.error('Error verifying PIN:', error);
        showSettingsPinError();
        currentPinInput = '';
        updatePinDisplay();
    }
}

