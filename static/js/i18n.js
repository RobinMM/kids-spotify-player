// ============================================
// INTERNATIONALIZATION (i18n) SYSTEM
// ============================================

const translations = {
    en: {
        // Navigation
        'nav.playlists': 'Playlists',
        'nav.artists': 'Artists',

        // Panel titles
        'panel.tracks': 'Tracks',
        'panel.topTracks': 'Top Tracks',
        'panel.albums': 'Albums',
        'panel.nowPlaying': 'Now playing',
        'panel.noMusic': 'No music',
        'panel.back': 'Back',

        // Loading states
        'loading.playlists': 'Loading playlists...',
        'loading.artists': 'Loading artists...',
        'loading.tracks': 'Loading tracks...',
        'loading.topTracks': 'Loading top tracks...',
        'loading.albums': 'Loading albums...',
        'loading.devices': 'Loading devices...',
        'loading.searching': 'Searching for devices...',

        // Empty states
        'empty.selectPlaylist': 'Select a playlist',
        'empty.selectArtist': 'Select an artist',
        'empty.noPlaylists': 'No playlists found',
        'empty.noArtists': 'No artists found',
        'empty.noTracks': 'No tracks found',
        'empty.noAlbums': 'No albums found',
        'empty.noDevices': 'No devices found',
        'empty.noAudioDevices': 'No audio devices found',
        'empty.noPairedDevices': 'No paired devices',
        'empty.noDiscoveredDevices': 'No devices found',

        // Error messages
        'error.loadPlaylists': 'Error loading playlists',
        'error.loadArtists': 'Error loading artists',
        'error.loadTracks': 'Error loading tracks',
        'error.loadAlbums': 'Error loading albums',
        'error.loadDevices': 'Error loading devices',
        'error.loadAudioDevices': 'Error loading audio devices',
        'error.loadBluetooth': 'Error loading',
        'error.playback': 'Something went wrong during playback',
        'error.previousTrack': 'Something went wrong with previous track',
        'error.nextTrack': 'Something went wrong with next track',
        'error.volume': 'Error adjusting volume',
        'error.seek': 'Error adjusting position',
        'error.save': 'Error saving',
        'error.deviceIdUnavailable': 'Device ID not available',
        'error.selectDevice': 'Error selecting device',
        'error.connectDevice': 'Error connecting to device',
        'error.activateFailed': 'Activation failed',
        'error.activateDevice': 'Error activating device',
        'error.switchFailed': 'Could not switch',
        'error.switchError': 'Error switching',
        'error.shutdown': 'Error shutting down',
        'error.reboot': 'Error restarting',
        'error.updateCheck': 'Could not check for updates',
        'error.updateFailed': 'Update failed',
        'error.serverNotResponding': 'Server not responding after update. Refresh the page manually.',

        // Settings tabs
        'settings.theme': 'Theme',
        'settings.devices': 'Devices',
        'settings.volume': 'Volume',
        'settings.bluetooth': 'Bluetooth',
        'settings.system': 'System',
        'settings.language': 'Language',

        // Settings - Devices tab
        'settings.computerAudio': 'Computer audio:',
        'settings.spotifyPlayOn': 'Play Spotify on:',
        'settings.localNetwork': 'Local network',
        'settings.showLocalDevices': 'Show local devices',

        // Settings - Bluetooth tab
        'settings.scan': 'Scan',
        'settings.stop': 'Stop',
        'settings.pairedDevices': 'Paired devices',
        'settings.discoveredDevices': 'Discovered devices',

        // Settings - Other tab
        'settings.defaultVolume': 'Default Volume',
        'settings.maxVolume': 'Maximum Volume',
        'settings.volumeHintDefault': 'Volume at startup and device switch',
        'settings.volumeHintMax': 'Volume cannot exceed this',
        'settings.pinProtection': 'PIN Protection',
        'settings.enabled': 'Enabled',
        'settings.disabled': 'Disabled',
        'settings.clearCache': 'Clear Cache',
        'settings.refreshInterface': 'Refresh Interface',
        'settings.update': 'Update',
        'settings.checking': 'Checking...',
        'settings.logout': 'Log out',
        'settings.reboot': 'Restart',
        'settings.shutdown': 'Shut down',

        // Settings - Language tab
        'language.title': 'Language',
        'language.en': 'English',
        'language.nl': 'Nederlands',

        // Bluetooth status
        'bt.connecting': 'Connecting...',
        'bt.pairing': 'Pairing...',
        'bt.connected': 'Connected',
        'bt.notConnected': 'Not connected',
        'bt.available': 'Available',
        'bt.unknownDevice': 'Unknown device',
        'bt.notAvailable': 'Bluetooth not available',
        'bt.forget': 'Forget',
        'bt.disconnect': 'Disconnect',

        // Bluetooth toasts
        'bt.searchStarted': 'Searching for Bluetooth devices...',
        'bt.scanFailed': 'Failed to start scan',
        'bt.startScanError': 'Error starting scan',
        'bt.paired': 'Device paired',
        'bt.pairFailed': 'Pairing failed',
        'bt.pairError': 'Error pairing',
        'bt.connectedToast': 'Connected',
        'bt.connectFailed': 'Connection failed',
        'bt.connectError': 'Error connecting',
        'bt.disconnected': 'Disconnected',
        'bt.disconnectFailed': 'Disconnect failed',
        'bt.disconnectError': 'Error disconnecting',
        'bt.forgotten': 'Device forgotten',
        'bt.forgetFailed': 'Forget failed',
        'bt.forgetError': 'Error forgetting',
        'bt.enterPin': 'Enter a PIN code',
        'bt.poweredOn': 'Bluetooth enabled',
        'bt.poweredOff': 'Bluetooth disabled',
        'bt.powerFailed': 'Failed to change Bluetooth power',

        // Device toast messages
        'device.playingOn': 'Playing on',
        'device.activating': 'Device needs to be activated...',
        'device.activated': 'activated',
        'device.waitSeconds': 'Wait {n} more second(s)...',

        // Modals - Shutdown
        'modal.confirmTitle': 'Are you sure?',
        'modal.shutdownQuestion': 'Do you want to shut down the music player?',
        'modal.shutdownConfirm': 'Yes, shut down',
        'modal.cancel': 'Cancel',

        // Modals - Reboot
        'modal.rebootQuestion': 'Do you want to restart the music player?',
        'modal.rebootConfirm': 'Yes, restart',

        // Modals - PIN
        'modal.pinRequired': 'PIN required',
        'modal.pinIncorrect': 'Incorrect PIN',
        'modal.enterPinDevice': 'Enter the PIN code for this device:',
        'modal.pair': 'Pair',

        // Modals - Forget device
        'modal.forgetDevice': 'Forget device?',
        'modal.forgetQuestion': 'Are you sure you want to forget "{name}"?',
        'modal.forgetConfirm': 'Forget',

        // Modals - Update
        'modal.updateAvailable': 'Update available',
        'modal.currentVersion': 'Current version:',
        'modal.newVersion': 'New version:',
        'modal.updateConfirm': 'Update',

        // Update progress
        'update.updating': 'Updating...',
        'update.downloading': 'Downloading updates...',
        'update.restarting': 'Restarting...',
        'update.serviceRestart': 'Service is restarting...',
        'update.complete': 'Complete!',
        'update.success': 'Update successfully installed',
        'update.failed': 'Update failed',
        'update.upToDate': 'Application is up-to-date',

        // System messages
        'system.shuttingDown': 'System is shutting down...',
        'system.restarting': 'System is restarting...',
        'system.somethingWrong': 'Something went wrong',

        // Control buttons (titles/tooltips)
        'control.previous': 'Previous',
        'control.playPause': 'Play/Pause',
        'control.next': 'Next',
        'control.shuffle': 'Shuffle',
        'control.settings': 'Settings',

        // Duration formatting
        'duration.hour': 'hour',
        'duration.hours': 'hours',
        'duration.min': 'min',
        'duration.tracks': 'tracks',
    },

    nl: {
        // Navigation
        'nav.playlists': 'Playlists',
        'nav.artists': 'Artiesten',

        // Panel titles
        'panel.tracks': 'Nummers',
        'panel.topTracks': 'Top Nummers',
        'panel.albums': 'Albums',
        'panel.nowPlaying': 'Nu aan het spelen',
        'panel.noMusic': 'Geen muziek',
        'panel.back': 'Terug',

        // Loading states
        'loading.playlists': 'Playlists laden...',
        'loading.artists': 'Artiesten laden...',
        'loading.tracks': 'Nummers laden...',
        'loading.topTracks': 'Top nummers laden...',
        'loading.albums': 'Albums laden...',
        'loading.devices': 'Apparaten laden...',
        'loading.searching': 'Zoeken naar apparaten...',

        // Empty states
        'empty.selectPlaylist': 'Selecteer een playlist',
        'empty.selectArtist': 'Selecteer een artiest',
        'empty.noPlaylists': 'Geen playlists gevonden',
        'empty.noArtists': 'Geen artiesten gevonden',
        'empty.noTracks': 'Geen nummers gevonden',
        'empty.noAlbums': 'Geen albums gevonden',
        'empty.noDevices': 'Geen apparaten gevonden',
        'empty.noAudioDevices': 'Geen audio apparaten gevonden',
        'empty.noPairedDevices': 'Geen gekoppelde apparaten',
        'empty.noDiscoveredDevices': 'Geen apparaten gevonden',

        // Error messages
        'error.loadPlaylists': 'Fout bij laden van playlists',
        'error.loadArtists': 'Fout bij laden van artiesten',
        'error.loadTracks': 'Fout bij laden van nummers',
        'error.loadAlbums': 'Fout bij laden van albums',
        'error.loadDevices': 'Fout bij laden van apparaten',
        'error.loadAudioDevices': 'Fout bij laden van audio apparaten',
        'error.loadBluetooth': 'Fout bij laden',
        'error.playback': 'Er ging iets mis bij het afspelen',
        'error.previousTrack': 'Er ging iets mis bij het vorige nummer',
        'error.nextTrack': 'Er ging iets mis bij het volgende nummer',
        'error.volume': 'Fout bij volume aanpassen',
        'error.seek': 'Fout bij positie aanpassen',
        'error.save': 'Fout bij opslaan',
        'error.deviceIdUnavailable': 'Device ID niet beschikbaar',
        'error.selectDevice': 'Fout bij selecteren device',
        'error.connectDevice': 'Fout bij verbinden met device',
        'error.activateFailed': 'Activatie mislukt',
        'error.activateDevice': 'Fout bij activeren device',
        'error.switchFailed': 'Kon niet schakelen',
        'error.switchError': 'Fout bij schakelen',
        'error.shutdown': 'Fout bij uitschakelen',
        'error.reboot': 'Fout bij herstarten',
        'error.updateCheck': 'Kon niet controleren op updates',
        'error.updateFailed': 'Update mislukt',
        'error.serverNotResponding': 'Server reageert niet na update. Ververs de pagina handmatig.',

        // Settings tabs
        'settings.theme': 'Thema',
        'settings.devices': 'Apparaten',
        'settings.volume': 'Volume',
        'settings.bluetooth': 'Bluetooth',
        'settings.system': 'Systeem',
        'settings.language': 'Taal',

        // Settings - Devices tab
        'settings.computerAudio': 'Computer geluid:',
        'settings.spotifyPlayOn': 'Spotify afspelen op:',
        'settings.localNetwork': 'Lokaal netwerk',
        'settings.showLocalDevices': 'Toon lokale apparaten',

        // Settings - Bluetooth tab
        'settings.scan': 'Scannen',
        'settings.stop': 'Stoppen',
        'settings.pairedDevices': 'Gekoppelde apparaten',
        'settings.discoveredDevices': 'Gevonden apparaten',

        // Settings - Other tab
        'settings.defaultVolume': 'Standaard Volume',
        'settings.maxVolume': 'Maximum Volume',
        'settings.volumeHintDefault': 'Volume bij opstarten en wisselen van apparaat',
        'settings.volumeHintMax': 'Volume kan niet hoger dan dit',
        'settings.pinProtection': 'PIN Beveiliging',
        'settings.enabled': 'Ingeschakeld',
        'settings.disabled': 'Uitgeschakeld',
        'settings.clearCache': 'Cache Verwijderen',
        'settings.refreshInterface': 'Refresh Interface',
        'settings.update': 'Bijwerken',
        'settings.checking': 'Controleren...',
        'settings.logout': 'Uitloggen',
        'settings.reboot': 'Herstarten',
        'settings.shutdown': 'Afsluiten',

        // Settings - Language tab
        'language.title': 'Taal',
        'language.en': 'English',
        'language.nl': 'Nederlands',

        // Bluetooth status
        'bt.connecting': 'Verbinden...',
        'bt.pairing': 'Koppelen...',
        'bt.connected': 'Verbonden',
        'bt.notConnected': 'Niet verbonden',
        'bt.available': 'Beschikbaar',
        'bt.unknownDevice': 'Onbekend apparaat',
        'bt.notAvailable': 'Bluetooth niet beschikbaar',
        'bt.forget': 'Vergeten',
        'bt.disconnect': 'Verbreken',

        // Bluetooth toasts
        'bt.searchStarted': 'Zoeken naar Bluetooth apparaten...',
        'bt.scanFailed': 'Scan starten mislukt',
        'bt.startScanError': 'Fout bij starten scan',
        'bt.paired': 'Apparaat gekoppeld',
        'bt.pairFailed': 'Koppelen mislukt',
        'bt.pairError': 'Fout bij koppelen',
        'bt.connectedToast': 'Verbonden',
        'bt.connectFailed': 'Verbinden mislukt',
        'bt.connectError': 'Fout bij verbinden',
        'bt.disconnected': 'Losgekoppeld',
        'bt.disconnectFailed': 'Loskoppelen mislukt',
        'bt.disconnectError': 'Fout bij loskoppelen',
        'bt.forgotten': 'Apparaat vergeten',
        'bt.forgetFailed': 'Vergeten mislukt',
        'bt.forgetError': 'Fout bij vergeten',
        'bt.enterPin': 'Voer een PIN code in',
        'bt.poweredOn': 'Bluetooth ingeschakeld',
        'bt.poweredOff': 'Bluetooth uitgeschakeld',
        'bt.powerFailed': 'Kon Bluetooth status niet wijzigen',

        // Device toast messages
        'device.playingOn': 'Afspelen op',
        'device.activating': 'Device moet eerst geactiveerd worden...',
        'device.activated': 'geactiveerd',
        'device.waitSeconds': 'Wacht nog {n} seconde(n)...',

        // Modals - Shutdown
        'modal.confirmTitle': 'Weet je het zeker?',
        'modal.shutdownQuestion': 'Wil je de muziekspeler uitschakelen?',
        'modal.shutdownConfirm': 'Ja, uitschakelen',
        'modal.cancel': 'Annuleren',

        // Modals - Reboot
        'modal.rebootQuestion': 'Wil je de muziekspeler herstarten?',
        'modal.rebootConfirm': 'Ja, herstarten',

        // Modals - PIN
        'modal.pinRequired': 'PIN vereist',
        'modal.pinIncorrect': 'Onjuiste PIN',
        'modal.enterPinDevice': 'Voer de PIN code in voor dit apparaat:',
        'modal.pair': 'Koppelen',

        // Modals - Forget device
        'modal.forgetDevice': 'Apparaat vergeten?',
        'modal.forgetQuestion': 'Weet je zeker dat je "{name}" wilt vergeten?',
        'modal.forgetConfirm': 'Vergeten',

        // Modals - Update
        'modal.updateAvailable': 'Update beschikbaar',
        'modal.currentVersion': 'Huidige versie:',
        'modal.newVersion': 'Nieuwe versie:',
        'modal.updateConfirm': 'Bijwerken',

        // Update progress
        'update.updating': 'Bijwerken...',
        'update.downloading': 'Downloaden van updates...',
        'update.restarting': 'Herstarten...',
        'update.serviceRestart': 'Service wordt herstart...',
        'update.complete': 'Voltooid!',
        'update.success': 'Update succesvol geïnstalleerd',
        'update.failed': 'Update mislukt',
        'update.upToDate': 'Applicatie is up-to-date',

        // System messages
        'system.shuttingDown': 'Systeem wordt uitgeschakeld...',
        'system.restarting': 'Systeem wordt herstart...',
        'system.somethingWrong': 'Er ging iets mis',

        // Control buttons (titles/tooltips)
        'control.previous': 'Vorige',
        'control.playPause': 'Afspelen/Pauzeren',
        'control.next': 'Volgende',
        'control.shuffle': 'Shuffle',
        'control.settings': 'Instellingen',

        // Duration formatting
        'duration.hour': 'uur',
        'duration.hours': 'uur',
        'duration.min': 'min',
        'duration.tracks': 'nummers',
    }
};

// Current language (default: English)
let currentLanguage = localStorage.getItem('language') || 'en';

/**
 * Get translation for a key
 * @param {string} key - Translation key (e.g., 'nav.playlists')
 * @param {Object} params - Optional parameters for interpolation
 * @returns {string} Translated string or key if not found
 */
function t(key, params = {}) {
    let text = translations[currentLanguage]?.[key]
        || translations['en'][key]
        || key;

    // Simple parameter interpolation: {name} -> value
    Object.keys(params).forEach(param => {
        text = text.replace(new RegExp(`\\{${param}\\}`, 'g'), params[param]);
    });

    return text;
}

/**
 * Get current language code
 * @returns {string} Current language code ('en' or 'nl')
 */
function getCurrentLanguage() {
    return currentLanguage;
}

/**
 * Set the application language
 * @param {string} lang - Language code ('en' or 'nl')
 */
function setLanguage(lang) {
    if (!translations[lang]) {
        console.warn(`Language '${lang}' not supported, falling back to 'en'`);
        lang = 'en';
    }

    currentLanguage = lang;
    localStorage.setItem('language', lang);
    document.documentElement.lang = lang;

    // Sync to backend
    fetch('/api/settings/language', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: lang })
    }).catch(err => console.warn('Failed to sync language to backend:', err));

    // Update all translations in the DOM
    updateAllTranslations();

    // Update language toggle UI
    updateLanguageToggle();
}

/**
 * Update all elements with data-i18n attribute
 */
function updateAllTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.dataset.i18n;
        const text = t(key);

        // Check if element has data-i18n-attr for attribute translation
        const attr = el.dataset.i18nAttr;
        if (attr) {
            el.setAttribute(attr, text);
        } else {
            el.textContent = text;
        }
    });

    // Update dynamic content that was rendered via JavaScript
    updateDynamicContent();
}

/**
 * Update dynamic content that needs special handling
 */
function updateDynamicContent() {
    // Update panel title based on current view
    const tracksPanelTitle = document.getElementById('tracks-panel-title');
    if (tracksPanelTitle && tracksPanelTitle.style.display !== 'none') {
        const currentText = tracksPanelTitle.textContent;
        // Map current text to translation keys
        if (currentText === 'Nummers' || currentText === 'Tracks') {
            tracksPanelTitle.textContent = t('panel.tracks');
        } else if (currentText === 'Top Nummers' || currentText === 'Top Tracks') {
            tracksPanelTitle.textContent = t('panel.topTracks');
        } else if (currentText === 'Albums') {
            tracksPanelTitle.textContent = t('panel.albums');
        }
    }

    // Update PIN toggle label
    const pinToggleLabel = document.querySelector('.toggle-switch-label');
    if (pinToggleLabel) {
        const pinToggle = document.getElementById('pin-protection-toggle');
        if (pinToggle) {
            pinToggleLabel.textContent = pinToggle.checked
                ? t('settings.enabled')
                : t('settings.disabled');
        }
    }

    // Update scan button text
    const scanBtn = document.getElementById('btn-bluetooth-scan');
    if (scanBtn) {
        const scanSpan = scanBtn.querySelector('span');
        if (scanSpan) {
            const isScanning = scanBtn.classList.contains('scanning');
            scanSpan.textContent = isScanning ? t('settings.stop') : t('settings.scan');
        }
    }
}

/**
 * Update language toggle button active states
 */
function updateLanguageToggle() {
    document.querySelectorAll('.language-toggle-btn').forEach(btn => {
        const lang = btn.dataset.lang;
        btn.classList.toggle('active', lang === currentLanguage);
    });
}

/**
 * Initialize i18n system
 */
function initI18n() {
    // Set initial HTML lang attribute
    document.documentElement.lang = currentLanguage;

    // Initial translation update
    updateAllTranslations();
    updateLanguageToggle();
}

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initI18n);
} else {
    initI18n();
}
