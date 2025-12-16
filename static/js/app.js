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
    powered: true,
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
let pinProtectionEnabled = true;

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
        if (artistSubToggle) artistSubToggle.style.display = 'flex';

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

    tracksContainer.innerHTML = `<div class="loading">${t('loading.tracks')}</div>`;

    try {
        const response = await fetch(`/api/playlist/${playlistId}`);
        const tracks = await response.json();
        setCache(cacheKey, tracks);
        renderTracks(tracks);
    } catch (error) {
        console.error('Error loading tracks:', error);
        tracksContainer.innerHTML = `<div class="empty-state">${t('error.loadTracks')}</div>`;
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
        tracksPanelTitle.textContent = t('panel.topTracks');
    }

    const cacheKey = CACHE_KEYS.ARTIST_TRACKS_PREFIX + artistId;
    const cached = getCache(cacheKey);
    if (cached) {
        renderTracks(cached);
        return;
    }

    tracksContainer.innerHTML = `<div class="loading">${t('loading.topTracks')}</div>`;

    try {
        const response = await fetch(`/api/artist/${artistId}/top-tracks`);
        const tracks = await response.json();
        setCache(cacheKey, tracks);
        renderTracks(tracks);
    } catch (error) {
        console.error('Error loading artist tracks:', error);
        tracksContainer.innerHTML = `<div class="empty-state">${t('error.loadTracks')}</div>`;
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

    tracksContainer.innerHTML = `<div class="loading">${t('loading.tracks')}</div>`;

    try {
        const response = await fetch(`/api/album/${albumId}/tracks`);
        const tracks = await response.json();
        setCache(cacheKey, tracks);
        renderAlbumTracks(tracks);
    } catch (error) {
        console.error('Error loading album tracks:', error);
        tracksContainer.innerHTML = `<div class="empty-state">${t('error.loadTracks')}</div>`;
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
const updateBtn = document.getElementById('btn-update');
const updateModal = document.getElementById('update-modal');
const confirmUpdateBtn = document.getElementById('btn-confirm-update');
const cancelUpdateBtn = document.getElementById('btn-cancel-update');
const updateProgressOverlay = document.getElementById('update-progress-overlay');
const updateRetryBtn = document.getElementById('btn-update-retry');
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
function renderAudioDevices(container, data, errorMessage = null) {
    if (data.error) {
        container.innerHTML = `<div class="empty-state">${errorMessage || t('error.loadAudioDevices')}</div>`;
        return;
    }

    if (!data.devices || data.devices.length === 0) {
        container.innerHTML = `<div class="empty-state">${t('empty.noAudioDevices')}</div>`;
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
    setupPinProtectionToggle();
    setupAccountEventListeners();

    // Reopen settings modal if coming back from refresh
    const reopenTab = localStorage.getItem('reopenSettingsTab');
    if (reopenTab) {
        localStorage.removeItem('reopenSettingsTab');
        settingsUnlocked = true; // Was already unlocked before refresh
        updateProtectedTabsLockState(); // Update lock icon visibility
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
            localStorage.setItem('reopenSettingsTab', 'system');
            location.reload();
        });
    }

    // Default volume slider in settings
    setupDefaultVolumeSlider();

    confirmShutdownBtn.addEventListener('click', confirmShutdown);
    cancelShutdownBtn.addEventListener('click', hideShutdownModal);
    confirmRebootBtn.addEventListener('click', confirmReboot);
    cancelRebootBtn.addEventListener('click', hideRebootModal);

    // Update button and modal event listeners
    if (updateBtn) {
        updateBtn.addEventListener('click', checkForUpdate);
    }
    if (confirmUpdateBtn) {
        confirmUpdateBtn.addEventListener('click', performUpdate);
    }
    if (cancelUpdateBtn) {
        cancelUpdateBtn.addEventListener('click', hideUpdateModal);
    }
    if (updateRetryBtn) {
        updateRetryBtn.addEventListener('click', performUpdate);
    }
    if (updateModal) {
        updateModal.addEventListener('click', (e) => {
            if (e.target === updateModal) hideUpdateModal();
        });
    }

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

    // Local devices toggle setup
    setupLocalDevicesToggle();

    // Power saving toggle setup
    setupPowerSavingToggle();

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

    // Language toggle event listeners
    document.querySelectorAll('.language-toggle-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const lang = btn.getAttribute('data-lang');
            setLanguage(lang);
        });
    });
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
        playlistsContainer.innerHTML = `<div class="empty-state">${t('error.loadPlaylists')}</div>`;
    }
}

// Render playlists to DOM
function renderPlaylists(playlists) {
    playlistsContainer.innerHTML = '';

    if (playlists.length === 0) {
        playlistsContainer.innerHTML = `<div class="empty-state">${t('empty.noPlaylists')}</div>`;
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
        playlistsContainer.innerHTML = `<div class="empty-state">${t('error.loadArtists')}</div>`;
    }
}

// Render artists to DOM
function renderArtists(artists) {
    playlistsContainer.innerHTML = '';

    if (artists.length === 0) {
        playlistsContainer.innerHTML = `<div class="empty-state">${t('empty.noArtists')}</div>`;
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
        tracksContainer.innerHTML = `<div class="empty-state">${t('error.loadTracks')}</div>`;
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

    tracksContainer.innerHTML = `<div class="loading">${t('loading.albums')}</div>`;

    try {
        const response = await fetch(`/api/artist/${artistId}/albums`);
        const albums = await response.json();

        // Cache the result
        setCache(cacheKey, albums);
        renderAlbums(albums);
        updateURL();
    } catch (error) {
        console.error('Error loading artist albums:', error);
        tracksContainer.innerHTML = `<div class="empty-state">${t('error.loadAlbums')}</div>`;
    }
}

// Render albums to DOM
function renderAlbums(albums) {
    tracksContainer.innerHTML = '';

    if (albums.length === 0) {
        tracksContainer.innerHTML = `<div class="empty-state">${t('empty.noAlbums')}</div>`;
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
        tracksContainer.innerHTML = `<div class="empty-state">${t('error.loadTracks')}</div>`;
    }
}

// Go back from album tracks to albums list
function goBackToAlbums() {
    currentAlbumId = null;

    // Hide back button, show sub-toggle
    if (albumBackBtn) albumBackBtn.style.display = 'none';
    const artistSubToggle = document.getElementById('artist-sub-toggle');
    if (artistSubToggle) artistSubToggle.style.display = 'flex';

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
        tracksContainer.innerHTML = `<div class="empty-state">${t('empty.noTracks')}</div>`;
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
        tracksContainer.innerHTML = `<div class="empty-state">${t('error.loadTracks')}</div>`;
    }
}

// Render tracks to DOM
function renderTracks(tracks) {
    tracksContainer.innerHTML = '';

    if (tracks.length === 0) {
        tracksContainer.innerHTML = `<div class="empty-state">${t('empty.noTracks')}</div>`;
        return;
    }

    // Compact list layout for all tracks
    const listContainer = document.createElement('div');
    listContainer.className = 'top-tracks-list';

    tracks.forEach(track => {
        const trackDiv = document.createElement('div');
        trackDiv.className = 'top-track-item';
        trackDiv.setAttribute('data-track-id', track.id);
        trackDiv.setAttribute('data-uri', track.uri);

        // Thumbnail
        const img = document.createElement('img');
        img.src = track.image || '/static/img/placeholder.svg';
        img.alt = track.name;
        img.className = 'top-track-image';
        trackDiv.appendChild(img);

        // Info container (artist + title)
        const infoDiv = document.createElement('div');
        infoDiv.className = 'top-track-info';

        // Artist (above title)
        const artist = document.createElement('span');
        artist.className = 'top-track-artist';
        artist.textContent = track.artist;
        infoDiv.appendChild(artist);

        // Title
        const title = document.createElement('span');
        title.className = 'top-track-title';
        title.textContent = track.name;
        infoDiv.appendChild(title);

        trackDiv.appendChild(infoDiv);

        // Duration
        const duration = document.createElement('span');
        duration.className = 'top-track-duration';
        duration.textContent = formatDuration(track.duration_ms);
        trackDiv.appendChild(duration);

        trackDiv.onclick = () => playTrack(track.uri);
        listContainer.appendChild(trackDiv);
    });

    tracksContainer.appendChild(listContainer);

    // Highlight currently playing track if any
    highlightCurrentTrack();
}

// Play specific track
async function playTrack(uri) {
    try {
        // Collect track URIs for artist top tracks (no playlist/album context)
        let trackUris = null;
        if (currentArtistId && !currentPlaylistId && !currentAlbumId) {
            const trackItems = document.querySelectorAll('.top-track-item[data-uri]');
            const allUris = Array.from(trackItems).map(item => item.getAttribute('data-uri'));
            const startIndex = allUris.indexOf(uri);
            if (startIndex !== -1) {
                trackUris = allUris.slice(startIndex);
            }
        }

        const response = await fetch('/api/play-track', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                uri: uri,
                playlist_id: currentPlaylistId,
                album_id: currentAlbumId,
                track_uris: trackUris
            })
        });

        if (!response.ok) {
            const data = await response.json();
            showToast(data.error || t('error.playback'), 'error');
            return;
        }

        isPlaying = true;
        updatePlayPauseButton();
        // Update current track after a short delay
        setTimeout(updateCurrentTrack, 500);
    } catch (error) {
        console.error('Error playing track:', error);
        showToast(t('error.playback'), 'error');
    }
}

// Toggle play/pause
async function togglePlayPause() {
    try {
        const endpoint = isPlaying ? '/api/pause' : '/api/play';
        const response = await fetch(endpoint, { method: 'POST' });

        if (!response.ok) {
            const data = await response.json();
            showToast(data.error || t('error.playback'), 'error');
            return;
        }

        isPlaying = !isPlaying;
        updatePlayPauseButton();
    } catch (error) {
        console.error('Error toggling playback:', error);
        showToast(t('error.playback'), 'error');
    }
}

// Previous track
async function previousTrack() {
    try {
        const response = await fetch('/api/previous', { method: 'POST' });
        if (!response.ok) {
            const data = await response.json();
            showToast(data.error || t('error.previousTrack'), 'error');
            return;
        }
        setTimeout(updateCurrentTrack, 500);
    } catch (error) {
        console.error('Error skipping to previous track:', error);
        showToast(t('error.previousTrack'), 'error');
    }
}

// Next track
async function nextTrack() {
    try {
        const response = await fetch('/api/next', { method: 'POST' });
        if (!response.ok) {
            const data = await response.json();
            showToast(data.error || t('error.nextTrack'), 'error');
            return;
        }
        setTimeout(updateCurrentTrack, 500);
    } catch (error) {
        console.error('Error skipping to next track:', error);
        showToast(t('error.nextTrack'), 'error');
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
                showToast(data.error || t('error.volume'), 'error');
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
            showToast(data.error || t('error.save'), 'error');
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
            showToast(data.error || t('error.seek'), 'error');
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
    document.querySelectorAll('.album-track-item.playing, .track-item.playing, .top-track-item.playing').forEach(el => {
        el.classList.remove('playing');
    });

    // If no track is playing, we're done
    if (!currentTrackId) return;

    // Find and highlight the matching track
    document.querySelectorAll('.album-track-item[data-track-id], .track-item[data-track-id], .top-track-item[data-track-id]').forEach(el => {
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
    updateProtectedTabsLockState(); // Reset lock icons
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
    const protectedTabs = ['bluetooth', 'volume', 'system', 'account'];
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

    // Load default volume setting when switching to volume tab
    if (tabName === 'volume') {
        loadDefaultVolumeSetting();
    }

    // Load network status and power saving status when switching to system tab
    if (tabName === 'system') {
        loadNetworkStatus();
        loadPowerSavingStatus();
    }

    // Load account info when switching to account tab
    if (tabName === 'account') {
        loadAccountInfo();
        loadDeviceInfo();
    }
}

// Load network status (IP and internet connectivity)
async function loadNetworkStatus() {
    const ipEl = document.getElementById('local-ip');
    const statusEl = document.getElementById('internet-status');

    try {
        const response = await fetch('/api/system/network-status');
        const data = await response.json();

        ipEl.textContent = data.ip || '--';
        statusEl.textContent = data.internet ? t('settings.online') : t('settings.offline');
        statusEl.className = 'system-info-value ' + (data.internet ? 'online' : 'offline');
    } catch (e) {
        ipEl.textContent = '--';
        statusEl.textContent = t('settings.offline');
        statusEl.className = 'system-info-value offline';
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

// Load Spotify devices (API + local mDNS)
async function loadDevices() {
    try {
        // Fetch both Spotify API devices and local mDNS devices in parallel
        const [apiResponse, localResponse] = await Promise.all([
            fetch('/api/devices'),
            fetch('/api/spotify-connect/local')
        ]);

        const apiData = await apiResponse.json();
        const localData = await localResponse.json();

        const devicesList = document.getElementById('devices-list');
        devicesList.innerHTML = '';

        const apiDevices = apiData.devices || [];
        const localDevices = localData.devices || [];

        // Check if local devices should be shown (toggle setting)
        const showLocalDevices = localStorage.getItem('showLocalDevices') !== 'false';

        // Filter local devices: only show if NOT already in API devices (match on name)
        const apiDeviceNames = apiDevices.map(d => d.name.toLowerCase());
        const filteredLocalDevices = showLocalDevices ? localDevices.filter(localDevice => {
            const localName = (localDevice.remote_name || localDevice.name).toLowerCase();
            return !apiDeviceNames.some(apiName =>
                apiName.includes(localName) || localName.includes(apiName)
            );
        }) : [];

        // Check if we have any devices to show
        if (apiDevices.length === 0 && filteredLocalDevices.length === 0) {
            devicesList.innerHTML = `<div class="empty-state">${t('empty.noDevices')}</div>`;
            return;
        }

        // Render API devices
        apiDevices.forEach(device => {
            const deviceDiv = createDeviceElement(device);
            devicesList.appendChild(deviceDiv);
        });

        // Render filtered local devices (if any)
        if (filteredLocalDevices.length > 0) {
            // Add separator if there are also API devices
            if (apiDevices.length > 0) {
                const separator = document.createElement('div');
                separator.className = 'device-separator';
                separator.innerHTML = `<span>${t('settings.localNetwork')}</span>`;
                devicesList.appendChild(separator);
            }

            filteredLocalDevices.forEach(device => {
                const deviceDiv = createLocalDeviceElement(device);
                devicesList.appendChild(deviceDiv);
            });
        }
    } catch (error) {
        console.error('Error loading devices:', error);
        document.getElementById('devices-list').innerHTML = `<div class="empty-state">${t('error.loadDevices')}</div>`;
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
            showToast(`${t('device.playingOn')} ${displayName}`, 'info');
            loadDevices(); // Refresh device list
        } else if (data.needs_activation) {
            // Device needs ZeroConf activation
            showToast(t('device.activating'), 'info');
            await activateLocalDevice(device);
        } else {
            showToast(data.error || t('error.selectDevice'), 'error');
        }
    } catch (error) {
        console.error('Error selecting local device:', error);
        showToast(t('error.connectDevice'), 'error');
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
                showToast(data.message || `${t('device.playingOn')} ${displayName}`, 'info');
                loadDevices();
            } else if (data.warning) {
                // Activation worked but device not found in Spotify
                showToast(data.message || data.warning, 'error');
                loadDevices();
            } else {
                // Activation only (no device_name was passed)
                showToast(data.message || `${displayName} ${t('device.activated')}`, 'info');
                loadDevices();
            }
        } else {
            showToast(data.error || t('error.activateFailed'), 'error');
        }
    } catch (error) {
        console.error('Error activating device:', error);
        showToast(t('error.activateDevice'), 'error');
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
        audioDevicesList.innerHTML = `<div class="empty-state">${t('error.loadAudioDevices')}</div>`;
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
            showToast(errorData.error || t('error.switchFailed'), 'error');
        }
    } catch (error) {
        console.error('Error switching audio device:', error);
        showToast(t('error.switchError'), 'error');
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
            showToast(data.message || t('system.shuttingDown'), 'info');
        } else {
            showToast(data.error || t('system.somethingWrong'), 'error');
        }
    } catch (error) {
        console.error('Error shutting down:', error);
        showToast(t('error.shutdown'), 'error');
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
            showToast(data.message || t('system.restarting'), 'info');
        } else {
            showToast(data.error || t('system.somethingWrong'), 'error');
        }
    } catch (error) {
        console.error('Error rebooting:', error);
        showToast(t('error.reboot'), 'error');
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
            `<div class="empty-state">${t('error.loadBluetooth')}</div>`;
    }
}

function renderBluetoothDevices() {
    const pairedList = document.getElementById('bt-paired-list');
    const discoveredSection = document.getElementById('bt-discovered-section');
    const discoveredList = document.getElementById('bt-discovered-list');

    // Render paired devices
    if (bluetoothState.pairedDevices.length === 0) {
        pairedList.innerHTML = `<div class="empty-state">${t('empty.noPairedDevices')}</div>`;
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
                ? `<div class="loading">${t('loading.searching')}</div>`
                : `<div class="empty-state">${t('empty.noDiscoveredDevices')}</div>`;
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

    // Disconnect button for connected paired devices
    const disconnectBtn = (isPaired && device.connected) ? `
        <button class="btn-bt-disconnect" data-address="${device.address}">${t('bt.disconnect')}</button>
    ` : '';

    // Forget button for paired devices
    const forgetBtn = isPaired ? `
        <button class="btn-bt-forget" data-address="${device.address}">${t('bt.forget')}</button>
    ` : '';

    div.innerHTML = `
        <span class="device-icon">${icon}</span>
        <div class="device-info">
            <div class="device-name">${escapeHtml(device.name || t('bt.unknownDevice'))}</div>
            <div class="device-status">${statusText}</div>
        </div>
        ${spinner}
        ${disconnectBtn}
        ${forgetBtn}
    `;

    // Click handler for device body
    div.onclick = (e) => {
        // Ignore clicks on disconnect button
        if (e.target.closest('.btn-bt-disconnect')) {
            e.stopPropagation();
            disconnectBluetoothDevice(device.address);
            return;
        }
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
    if (device.address === bluetoothState.connectingDevice) return t('bt.connecting');
    if (device.address === bluetoothState.pairingDevice) return t('bt.pairing');
    if (device.connected) {
        let status = t('bt.connected');
        if (device.codec) {
            status += ` · ${device.codec}`;
        }
        return status;
    }
    if (isPaired) return t('bt.notConnected');
    return t('bt.available');
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
            showToast(t('bt.searchStarted'), 'info');
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
            showToast(data.error || t('bt.scanFailed'), 'error');
        }
    } catch (error) {
        console.error('Error starting Bluetooth scan:', error);
        showToast(t('bt.startScanError'), 'error');
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
        scanBtn.querySelector('span').textContent = t('settings.stop');
    } else {
        scanBtn.classList.remove('scanning');
        scanBtn.querySelector('span').textContent = t('settings.scan');
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
            showToast(t('bt.paired'), 'info');
            // Auto-connect after pairing
            bluetoothState.pairingDevice = null;
            await connectBluetoothDevice(address);
        } else if (response.status === 202 && data.needs_pin) {
            // Show PIN modal
            bluetoothState.pairingDevice = null;
            bluetoothState.pendingPinDevice = address;
            showPinModal(address);
        } else {
            showToast(data.error || t('bt.pairFailed'), 'error');
            bluetoothState.pairingDevice = null;
        }
    } catch (error) {
        console.error('Error pairing Bluetooth device:', error);
        showToast(t('bt.pairError'), 'error');
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
            showToast(t('bt.connectedToast'), 'info');
            // Refresh audio devices too
            loadAudioDevices();
        } else {
            showToast(data.error || t('bt.connectFailed'), 'error');
        }
    } catch (error) {
        console.error('Error connecting Bluetooth device:', error);
        showToast(t('bt.connectError'), 'error');
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
            showToast(t('bt.disconnected'), 'info');
            loadAudioDevices();
        } else {
            showToast(data.error || t('bt.disconnectFailed'), 'error');
        }
    } catch (error) {
        console.error('Error disconnecting Bluetooth device:', error);
        showToast(t('bt.disconnectError'), 'error');
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
            showToast(t('bt.forgotten'), 'info');
            loadAudioDevices();
        } else {
            showToast(data.error || t('bt.forgetFailed'), 'error');
        }
    } catch (error) {
        console.error('Error forgetting Bluetooth device:', error);
        showToast(t('bt.forgetError'), 'error');
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
        showToast(t('bt.enterPin'), 'error');
        return;
    }

    hidePinModal();
    pairBluetoothDevice(address, pin);
}

// Forget Confirmation Modal
function showForgetModal(device) {
    const modal = document.getElementById('bt-forget-modal');
    const message = document.getElementById('bt-forget-message');

    message.textContent = t('modal.forgetQuestion', { name: device.name || t('bt.unknownDevice') });
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

    // Setup Bluetooth power toggle
    setupBluetoothPowerToggle();
}

// Setup Bluetooth power toggle
async function setupBluetoothPowerToggle() {
    const powerToggle = document.getElementById('bluetooth-power-toggle');
    const bluetoothContent = document.querySelector('.bluetooth-content');
    const scanBtn = document.getElementById('btn-bluetooth-scan');

    if (!powerToggle) return;

    // Load initial power state from backend
    try {
        const response = await fetch('/api/bluetooth/power');
        const data = await response.json();
        bluetoothState.powered = data.powered !== false;
        powerToggle.checked = bluetoothState.powered;
        updateBluetoothPowerUI();
    } catch (error) {
        console.error('Error loading Bluetooth power state:', error);
    }

    // Handle toggle changes
    powerToggle.addEventListener('change', async () => {
        const newState = powerToggle.checked;

        try {
            const response = await fetch('/api/bluetooth/power', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ powered: newState })
            });
            const data = await response.json();

            if (data.success) {
                bluetoothState.powered = newState;
                updateBluetoothPowerUI();
                showToast(data.message || (newState ? t('bt.poweredOn') : t('bt.poweredOff')), 'info');

                // Reload devices if turning on
                if (newState) {
                    loadBluetoothDevices();
                }
            } else {
                // Revert toggle on failure
                powerToggle.checked = !newState;
                showToast(data.error || t('bt.powerFailed'), 'error');
            }
        } catch (error) {
            console.error('Error setting Bluetooth power:', error);
            powerToggle.checked = !newState;
            showToast(t('bt.powerFailed'), 'error');
        }
    });
}

// Update UI based on Bluetooth power state
function updateBluetoothPowerUI() {
    const bluetoothContent = document.querySelector('.bluetooth-content');
    const scanBtn = document.getElementById('btn-bluetooth-scan');

    if (bluetoothContent) {
        if (bluetoothState.powered) {
            bluetoothContent.classList.remove('disabled');
        } else {
            bluetoothContent.classList.add('disabled');
        }
    }

    if (scanBtn) {
        scanBtn.disabled = !bluetoothState.powered;
    }
}

// =============================================================================
// Settings PIN Modal
// =============================================================================

function showSettingsPinModal(targetTab) {
    // Skip PIN modal if protection is disabled
    if (!pinProtectionEnabled) {
        settingsUnlocked = true;
        updateProtectedTabsLockState(); // Update lock icon visibility
        switchTab(targetTab);
        return;
    }

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
    // Check if PIN protection is disabled
    if (!pinProtectionEnabled) {
        settingsUnlocked = true;
        const targetTab = pendingProtectedTab;
        hideSettingsPinModal();
        if (targetTab) {
            switchTab(targetTab);
        }
        return;
    }

    try {
        const response = await fetch('/api/verify-pin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pin: currentPinInput })
        });

        const data = await response.json();

        if (data.success) {
            settingsUnlocked = true;
            updateProtectedTabsLockState(); // Update lock icon visibility
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

// Setup PIN protection toggle
function setupPinProtectionToggle() {
    const pinToggle = document.getElementById('pin-protection-toggle');

    if (pinToggle) {
        // Load saved state from localStorage
        const savedState = localStorage.getItem('pinProtectionEnabled');
        if (savedState !== null) {
            pinProtectionEnabled = savedState === 'true';
            pinToggle.checked = pinProtectionEnabled;
        }
        // Apply body class for lock icon visibility
        updatePinProtectionBodyClass();

        pinToggle.addEventListener('change', () => {
            pinProtectionEnabled = pinToggle.checked;
            localStorage.setItem('pinProtectionEnabled', pinProtectionEnabled);
            // Reset unlocked state when enabling protection
            if (pinProtectionEnabled) {
                settingsUnlocked = false;
                updateProtectedTabsLockState();
            }
            // Update body class for lock icon visibility
            updatePinProtectionBodyClass();
        });
    }
}

// Update body class based on PIN protection state
function updatePinProtectionBodyClass() {
    if (pinProtectionEnabled) {
        document.body.classList.remove('pin-disabled');
    } else {
        document.body.classList.add('pin-disabled');
    }
}

// Update lock icon visibility on protected tabs
function updateProtectedTabsLockState() {
    const protectedTabs = document.querySelectorAll('.tab-btn[data-protected="true"]');
    protectedTabs.forEach(tab => {
        if (settingsUnlocked) {
            tab.classList.add('unlocked');
        } else {
            tab.classList.remove('unlocked');
        }
    });
}

// Setup local devices toggle
function setupLocalDevicesToggle() {
    const localDevicesToggle = document.getElementById('show-local-devices-toggle');

    if (localDevicesToggle) {
        // Load saved state from localStorage (default: true/checked)
        const savedState = localStorage.getItem('showLocalDevices');
        if (savedState !== null) {
            localDevicesToggle.checked = savedState !== 'false';
        }

        localDevicesToggle.addEventListener('change', () => {
            localStorage.setItem('showLocalDevices', localDevicesToggle.checked);
            // Reload devices to apply the change
            loadDevices();
        });
    }
}

// Setup power saving toggle
function setupPowerSavingToggle() {
    const powerSavingToggle = document.getElementById('power-saving-toggle');

    if (powerSavingToggle) {
        powerSavingToggle.addEventListener('change', async () => {
            try {
                const response = await fetch('/api/system/power-saving', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ enabled: powerSavingToggle.checked })
                });

                const data = await response.json();

                if (data.error) {
                    showToast(data.error, 'error');
                    // Revert toggle
                    powerSavingToggle.checked = !powerSavingToggle.checked;
                } else if (data.reboot_required) {
                    showToast(t('settings.rebootRequired'), 'info');
                }
            } catch (error) {
                console.error('Error setting power saving:', error);
                showToast(t('error.save'), 'error');
                // Revert toggle
                powerSavingToggle.checked = !powerSavingToggle.checked;
            }
        });
    }
}

// Load power saving status from backend
async function loadPowerSavingStatus() {
    const powerSavingToggle = document.getElementById('power-saving-toggle');

    if (powerSavingToggle) {
        try {
            const response = await fetch('/api/system/power-saving');
            const data = await response.json();
            powerSavingToggle.checked = data.enabled || false;
        } catch (error) {
            console.error('Error loading power saving status:', error);
        }
    }
}

// ============================================
// ACCOUNT FUNCTIONALITY
// ============================================

// Track if account error modal has been shown this session
let accountErrorShown = false;

// Load account info for Account tab
async function loadAccountInfo() {
    try {
        const response = await fetch('/api/account/info');
        if (response.ok) {
            const data = await response.json();
            document.getElementById('account-display-name').textContent = data.display_name || '-';
            document.getElementById('account-email').textContent = data.email || '-';
            document.getElementById('credential-client-id').textContent = data.client_id || '-';
            document.getElementById('credential-client-secret').textContent = data.client_secret || '-';

            // Product (Premium/Free) with styling
            const productEl = document.getElementById('account-product');
            const product = data.product || '-';
            productEl.textContent = product.charAt(0).toUpperCase() + product.slice(1);
            productEl.classList.toggle('premium', product === 'premium');

            // Load avatar if available
            const avatar = document.getElementById('account-avatar');
            if (data.avatar_url) {
                avatar.innerHTML = `<img src="${data.avatar_url}" alt="Avatar">`;
            } else {
                avatar.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
                </svg>`;
            }
        }
    } catch (e) {
        console.error('Failed to load account info:', e);
    }
}

// Load device info for Account tab
async function loadDeviceInfo() {
    try {
        const response = await fetch('/api/system/device-info');
        if (response.ok) {
            const data = await response.json();
            document.getElementById('device-hostname').textContent = data.hostname || '-';
            document.getElementById('device-player-name').textContent = data.player_name || '-';
        }
    } catch (e) {
        console.error('Failed to load device info:', e);
    }
}

// Device edit modal state
let deviceEditType = null;

// Open device edit modal
function openDeviceEditModal(type) {
    deviceEditType = type;
    const modal = document.getElementById('device-edit-modal');
    const title = document.getElementById('device-edit-title');
    const label = document.getElementById('device-edit-label');
    const input = document.getElementById('device-edit-input');
    const warning = document.getElementById('device-edit-warning');

    if (type === 'hostname') {
        title.textContent = t('settings.editHostname');
        label.textContent = t('settings.hostname');
        input.value = document.getElementById('device-hostname').textContent;
        warning.textContent = t('settings.hostnameWarning');
    } else {
        title.textContent = t('settings.editPlayerName');
        label.textContent = t('settings.playerName');
        input.value = document.getElementById('device-player-name').textContent;
        warning.textContent = t('settings.playerNameWarning');
    }

    modal.classList.remove('hidden');
    input.focus();
}

// Close device edit modal
function closeDeviceEditModal() {
    document.getElementById('device-edit-modal').classList.add('hidden');
    deviceEditType = null;
}

// Save device edit (requires PIN)
async function saveDeviceEdit() {
    const input = document.getElementById('device-edit-input').value.trim();

    if (!input) {
        showToast(t('error.fieldsRequired'), 'error');
        return;
    }

    // Get PIN from user
    const pin = prompt(t('modal.enterPin'));
    if (!pin) return;

    const endpoint = deviceEditType === 'hostname'
        ? '/api/system/hostname'
        : '/api/system/player-name';

    const bodyKey = deviceEditType === 'hostname' ? 'hostname' : 'player_name';

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ [bodyKey]: input, pin: pin })
        });

        const data = await response.json();

        if (response.ok) {
            showToast(t('settings.saved'), 'info');
            loadDeviceInfo();
            closeDeviceEditModal();
        } else {
            showToast(data.error || t('error.unknown'), 'error');
        }
    } catch (e) {
        console.error('Failed to save device edit:', e);
        showToast(t('error.unknown'), 'error');
    }
}

// Check for account error (403 forbidden) in API responses
function checkForAccountError(response, data) {
    if (response.status === 403 && data && data.error_type === 'forbidden' && !accountErrorShown) {
        showAccountErrorModal();
        accountErrorShown = true;
    }
}

// Show account error modal (403 error recovery)
function showAccountErrorModal() {
    document.getElementById('account-error-modal').classList.remove('hidden');
}

// Hide account error modal
function hideAccountErrorModal() {
    document.getElementById('account-error-modal').classList.add('hidden');
}

// Show credentials modal
function showCredentialsModal() {
    // Clear previous input
    document.getElementById('credentials-client-id').value = '';
    document.getElementById('credentials-client-secret').value = '';
    document.getElementById('credentials-modal').classList.remove('hidden');
}

// Hide credentials modal
function hideCredentialsModal() {
    document.getElementById('credentials-modal').classList.add('hidden');
}

// Save credentials
async function saveCredentials() {
    const clientId = document.getElementById('credentials-client-id').value.trim();
    const clientSecret = document.getElementById('credentials-client-secret').value.trim();

    if (!clientId || !clientSecret) {
        showToast(t('error.fieldsRequired'), 'error');
        return;
    }

    try {
        const response = await fetch('/api/settings/credentials', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_id: clientId,
                client_secret: clientSecret,
                pin: currentPinInput // PIN that was verified for protected tab
            })
        });

        if (response.ok) {
            showToast(t('settings.credentialsSaved'), 'info');
            hideCredentialsModal();
            // Logout after saving to apply new credentials
            setTimeout(() => performLogout(), 1500);
        } else {
            const data = await response.json();
            showToast(data.error || t('error.generic'), 'error');
        }
    } catch (e) {
        console.error('Error saving credentials:', e);
        showToast(t('error.generic'), 'error');
    }
}

// Setup account event listeners
function setupAccountEventListeners() {
    // Account error modal buttons
    const btnErrorLogout = document.getElementById('btn-error-logout');
    const btnErrorSettings = document.getElementById('btn-error-settings');

    if (btnErrorLogout) {
        btnErrorLogout.addEventListener('click', performLogout);
    }

    if (btnErrorSettings) {
        btnErrorSettings.addEventListener('click', () => {
            hideAccountErrorModal();
            showSettingsModal();
            // Will require PIN to access account tab
            switchTab('account');
        });
    }

    // Change credentials button
    const btnChangeCredentials = document.getElementById('btn-change-credentials');
    if (btnChangeCredentials) {
        btnChangeCredentials.addEventListener('click', showCredentialsModal);
    }

    // Credentials modal buttons
    const btnCancelCredentials = document.getElementById('btn-cancel-credentials');
    const btnSaveCredentials = document.getElementById('btn-save-credentials');

    if (btnCancelCredentials) {
        btnCancelCredentials.addEventListener('click', hideCredentialsModal);
    }

    if (btnSaveCredentials) {
        btnSaveCredentials.addEventListener('click', saveCredentials);
    }

    // Device edit buttons
    const btnEditHostname = document.getElementById('btn-edit-hostname');
    const btnEditPlayerName = document.getElementById('btn-edit-player-name');
    const btnCancelDeviceEdit = document.getElementById('btn-cancel-device-edit');
    const btnSaveDeviceEdit = document.getElementById('btn-save-device-edit');

    if (btnEditHostname) {
        btnEditHostname.addEventListener('click', () => openDeviceEditModal('hostname'));
    }

    if (btnEditPlayerName) {
        btnEditPlayerName.addEventListener('click', () => openDeviceEditModal('player_name'));
    }

    if (btnCancelDeviceEdit) {
        btnCancelDeviceEdit.addEventListener('click', closeDeviceEditModal);
    }

    if (btnSaveDeviceEdit) {
        btnSaveDeviceEdit.addEventListener('click', saveDeviceEdit);
    }

    // Close modals on outside click
    const accountErrorModal = document.getElementById('account-error-modal');
    const credentialsModal = document.getElementById('credentials-modal');
    const deviceEditModal = document.getElementById('device-edit-modal');

    if (accountErrorModal) {
        accountErrorModal.addEventListener('click', (e) => {
            if (e.target === accountErrorModal) hideAccountErrorModal();
        });
    }

    if (credentialsModal) {
        credentialsModal.addEventListener('click', (e) => {
            if (e.target === credentialsModal) hideCredentialsModal();
        });
    }

    if (deviceEditModal) {
        deviceEditModal.addEventListener('click', (e) => {
            if (e.target === deviceEditModal) closeDeviceEditModal();
        });
    }
}

// ============================================
// UPDATE FUNCTIONALITY
// ============================================

let pendingUpdateVersion = null;

async function checkForUpdate() {
    // Show loading state on button
    if (updateBtn) {
        updateBtn.disabled = true;
        updateBtn.innerHTML = `
            <svg class="icon spinning" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
            </svg>
            <span>Controleren...</span>
        `;
    }

    try {
        const response = await fetch('/api/system/check-update');
        const data = await response.json();

        if (data.error) {
            showToast(data.error, 'error');
            resetUpdateButton();
            return;
        }

        if (!data.available) {
            showToast(`Applicatie is up-to-date (${data.current_version})`, 'info');
            resetUpdateButton();
            return;
        }

        // Show update modal with version info
        pendingUpdateVersion = data.latest_version;
        document.getElementById('update-current-version').textContent = data.current_version;
        document.getElementById('update-new-version').textContent = data.latest_version;

        const releaseNotes = document.getElementById('update-release-notes');
        if (data.release_notes) {
            releaseNotes.textContent = data.release_notes;
            releaseNotes.style.display = 'block';
        } else {
            releaseNotes.style.display = 'none';
        }

        showUpdateModal();
        resetUpdateButton();

    } catch (error) {
        console.error('Update check error:', error);
        showToast('Kon niet controleren op updates', 'error');
        resetUpdateButton();
    }
}

function resetUpdateButton() {
    if (updateBtn) {
        updateBtn.disabled = false;
        updateBtn.innerHTML = `
            <svg class="icon" viewBox="0 0 24 24" fill="currentColor">
                <path d="M21 10.12h-6.78l2.74-2.82c-2.73-2.7-7.15-2.8-9.88-.1-2.73 2.71-2.73 7.08 0 9.79 2.73 2.71 7.15 2.71 9.88 0C18.32 15.65 19 14.08 19 12.1h2c0 1.98-.88 4.55-2.64 6.29-3.51 3.48-9.21 3.48-12.72 0-3.5-3.47-3.53-9.11-.02-12.58 3.51-3.47 9.14-3.47 12.65 0L21 3v7.12zM12.5 8v4.25l3.5 2.08-.72 1.21L11 13V8h1.5z"/>
            </svg>
            <span>Bijwerken</span>
        `;
    }
}

function showUpdateModal() {
    if (updateModal) {
        updateModal.classList.remove('hidden');
    }
}

function hideUpdateModal() {
    if (updateModal) {
        updateModal.classList.add('hidden');
    }
    pendingUpdateVersion = null;
}

async function performUpdate() {
    hideUpdateModal();
    showUpdateProgress('Bijwerken...', 'Downloaden van updates...');
    setUpdateProgress(10);

    try {
        const response = await fetch('/api/system/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ version: pendingUpdateVersion })
        });

        // Parse JSON in try-catch om parse errors op te vangen
        let data;
        try {
            data = await response.json();
        } catch (parseError) {
            // JSON parsing failed - update waarschijnlijk gestart, redirect naar loader
            console.log('Response parsing failed, redirecting to loader...');
            window.location.href = '/static/loader.html';
            return;
        }

        if (!response.ok || data.error) {
            showUpdateError(data.error || t('update.failed'));
            return;
        }

        // Update gestart! Redirect naar loader
        setUpdateProgress(50);
        setUpdateStatus(t('update.restarting'), t('update.serviceRestart'));
        setTimeout(() => {
            window.location.href = '/static/loader.html';
        }, 500);

    } catch (error) {
        // Network error - update waarschijnlijk WEL gestart
        console.log('Update request interrupted, redirecting to loader...');
        window.location.href = '/static/loader.html';
    }
}

function showUpdateProgress(title, message) {
    if (updateProgressOverlay) {
        updateProgressOverlay.classList.remove('hidden', 'error');
        document.getElementById('update-status-title').textContent = title;
        document.getElementById('update-status-message').textContent = message;
        document.getElementById('btn-update-retry').classList.add('hidden');
    }
}

function setUpdateStatus(title, message) {
    document.getElementById('update-status-title').textContent = title;
    document.getElementById('update-status-message').textContent = message;
}

function setUpdateProgress(percent) {
    const fill = document.getElementById('update-progress-fill');
    if (fill) {
        fill.style.width = percent + '%';
    }
}

function showUpdateError(message) {
    if (updateProgressOverlay) {
        updateProgressOverlay.classList.add('error');
        document.getElementById('update-status-title').textContent = t('update.failed');
        document.getElementById('update-status-message').textContent = message;
        document.getElementById('btn-update-retry').classList.remove('hidden');
    }
}

function hideUpdateProgress() {
    if (updateProgressOverlay) {
        updateProgressOverlay.classList.add('hidden');
    }
}


