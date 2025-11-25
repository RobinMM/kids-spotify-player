// State management
let isPlaying = false;
let currentPlaylistId = null;
let isShuffleOn = false;
let devicePollingInterval = null;

// Theme state
let currentTheme = 'light';
let primaryColor = '#667eea';
let secondaryColor = '#764ba2';
let accentColor = '#eacd66';

// Audio device cache
let cachedAudioDevices = null;
let cachedAudioDevicesTimestamp = null;
const CACHE_DURATION = 60000; // 60 seconds

// Playlist/tracks cache configuration
const CACHE_KEYS = {
    PLAYLISTS: 'spotify-playlists-cache',
    TRACKS_PREFIX: 'spotify-tracks-'
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
const logoutBtn = document.getElementById('btn-logout');
const shutdownModal = document.getElementById('shutdown-modal');
const confirmShutdownBtn = document.getElementById('btn-confirm-shutdown');
const cancelShutdownBtn = document.getElementById('btn-cancel-shutdown');
const openSettingsBtn = document.getElementById('btn-open-settings');
const settingsModal = document.getElementById('settings-modal');
const refreshAudioDevicesBtn = document.getElementById('btn-refresh-audio-devices');
const volumeSlider = document.getElementById('volume-slider');
const volumeIconPath = document.getElementById('volume-icon-path');
const progressBar = document.getElementById('progress-bar');
const progressFill = document.getElementById('progress-fill');
const currentTimeEl = document.getElementById('current-time');
const totalTimeEl = document.getElementById('total-time');

// Progress tracking state
let trackDuration = 0;
let trackProgress = 0;
let lastProgressUpdate = Date.now();
let progressInterpolationInterval = null;

// Volume slider state
let isVolumeAdjusting = false;
let volumeDebounceTimer = null;

// Long-press helper for buttons with hold-to-activate behavior
function setupLongPress(button, duration, onComplete) {
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
    loadPlaylists();
    preloadAudioDevices(); // Preload audio devices in background
    startCurrentTrackPolling();
    startProgressInterpolation();
    setupEventListeners();
    setupThemeListeners();
});

// Setup event listeners
function setupEventListeners() {
    playPauseBtn.addEventListener('click', togglePlayPause);
    previousBtn.addEventListener('click', previousTrack);
    nextBtn.addEventListener('click', nextTrack);
    shuffleBtn.addEventListener('click', toggleShuffle);

    // Refresh playlists button
    refreshPlaylistsBtn.addEventListener('click', refreshPlaylists);

    // Refresh audio devices button
    refreshAudioDevicesBtn.addEventListener('click', refreshAudioDevices);

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

    // Long-press protection for shutdown and logout
    setupLongPress(shutdownBtn, 3000, showShutdownModal);
    setupLongPress(logoutBtn, 3000, performLogout);

    confirmShutdownBtn.addEventListener('click', confirmShutdown);
    cancelShutdownBtn.addEventListener('click', hideShutdownModal);

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

// Load tracks from playlist
async function loadTracks(playlistId, playlistBtn) {
    // Store current playlist ID for playback context
    currentPlaylistId = playlistId;

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
        return;
    }

    tracksContainer.innerHTML = '<div class="loading">Nummers laden...</div>';

    try {
        const response = await fetch(`/api/playlist/${playlistId}`);
        const tracks = await response.json();

        // Cache the result
        setCache(cacheKey, tracks);
        renderTracks(tracks);
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
                playlist_id: currentPlaylistId
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

// Handle volume change
function handleVolumeChange() {
    const volume = volumeSlider.value;
    updateVolumeIcon(volume);

    // Debounce API calls to prevent too many requests
    clearTimeout(volumeDebounceTimer);
    volumeDebounceTimer = setTimeout(async () => {
        try {
            const response = await fetch('/api/volume', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ volume_percent: parseInt(volume) })
            });
            if (!response.ok) {
                const data = await response.json();
                showToast(data.error || 'Fout bij volume aanpassen', 'error');
            }
        } catch (error) {
            console.error('Error setting volume:', error);
        }
    }, 100);
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

        if (data.volume_percent !== undefined && !isVolumeAdjusting) {
            volumeSlider.value = data.volume_percent;
            updateVolumeIcon(data.volume_percent);
        }

        if (data.track) {
            // Track playing - show real data
            albumArt.src = data.track.image || '/static/img/placeholder.svg';
            albumArt.classList.remove('hidden');
            noTrack.style.display = 'none';
            trackName.textContent = data.track.name;
            trackArtist.textContent = data.track.artist;

            // Update progress
            trackDuration = data.track.duration_ms;
            trackProgress = data.track.progress_ms;
            lastProgressUpdate = Date.now();
            updateProgressDisplay();
        } else {
            // No track playing - show placeholders (keep elements visible)
            albumArt.classList.add('hidden');
            noTrack.style.display = 'block';
            trackName.textContent = '-';
            trackArtist.textContent = '-';

            // Reset progress to 0:00
            trackDuration = 0;
            trackProgress = 0;
            updateProgressDisplay();
        }
    } catch (error) {
        console.error('Error updating current track:', error);
    }
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
}

// Refresh playlists
function refreshPlaylists() {
    // Clear all playlist and track caches
    clearPlaylistCache();
    loadPlaylists();
    hideSettingsModal();
}

// Tab switching
function switchTab(tabName) {
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

    // Stop any existing device polling
    stopDevicePolling();

    // Load devices and audio devices when switching to devices tab
    if (tabName === 'devices') {
        loadDevices();
        loadAudioDevices();
        startDevicePolling();
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

// Load devices
async function loadDevices() {
    try {
        const response = await fetch('/api/devices');
        const data = await response.json();

        const devicesList = document.getElementById('devices-list');
        devicesList.innerHTML = '';

        if (!data.devices || data.devices.length === 0) {
            devicesList.innerHTML = '<div class="empty-state">Geen apparaten gevonden</div>';
            return;
        }

        data.devices.forEach(device => {
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

async function refreshAudioDevices() {
    const audioDevicesList = document.getElementById('audio-devices-list');
    const refreshBtn = document.getElementById('btn-refresh-audio-devices');

    // Disable button en start spinner
    refreshBtn.disabled = true;
    refreshBtn.classList.add('loading');

    try {
        // Show loading state
        audioDevicesList.innerHTML = '<div class="loading">Apparaten verversen...</div>';

        // Invalidate frontend cache
        cachedAudioDevices = null;
        cachedAudioDevicesTimestamp = null;

        // Call refresh endpoint
        const response = await fetch('/api/audio/devices/refresh', {
            method: 'POST'
        });
        const data = await response.json();

        // Update cache with fresh data
        cachedAudioDevices = data;
        cachedAudioDevicesTimestamp = Date.now();

        renderAudioDevices(audioDevicesList, data, 'Fout bij verversen van audio apparaten');
        console.log(`Audio devices refreshed: ${data.devices?.length || 0} devices found`);
        showToast('Audio apparaten vernieuwd', 'info');
    } catch (error) {
        console.error('Error refreshing audio devices:', error);
        audioDevicesList.innerHTML = '<div class="empty-state">Fout bij verversen van audio apparaten</div>';
        showToast('Fout bij verversen', 'error');
    } finally {
        // Re-enable button en stop spinner
        refreshBtn.disabled = false;
        refreshBtn.classList.remove('loading');
    }
}

function createAudioDeviceElement(device) {
    const div = document.createElement('div');
    div.className = 'device-item';
    div.setAttribute('data-device-id', device.id);
    if (device.is_active) div.classList.add('active');

    const icon = getAudioDeviceIcon(device.name);
    const activeDot = device.is_active ? '<span class="active-dot"></span>' : '';

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
        const response = await fetch('/api/shutdown', { method: 'POST' });
        const data = await response.json();

        hideShutdownModal();

        // Show message since it's a placeholder
        if (data.message) {
            showToast(data.message, 'info');
        }
    } catch (error) {
        console.error('Error shutting down:', error);
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
