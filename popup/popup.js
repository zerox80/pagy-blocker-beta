/**
 * @file popup.js
 * @description Popup UI für Pagy Blocker - Domain-basierte Steuerung
 * @version 7.1.0
 */

import { EXTENSION_CONFIG } from '../core/config.js';
import { popupLogger } from '../core/logger.js';
import { debounce, sanitizeInput, isExtensionContextValid } from '../core/utilities.js';

class PagyPopup {
    constructor() {
        this.elements = {
            enableSwitch: document.getElementById('enable-switch'),
            statusText: document.getElementById('status-text'),
            domainText: document.getElementById('domain-text'),
            filterCountEl: document.getElementById('filter-count'),
            trackingStats: document.getElementById('tracking-stats'),
            currentSiteBlocked: document.getElementById('current-site-blocked'),
            currentSiteTrackers: document.getElementById('current-site-trackers'),
            totalSessionBlocked: document.getElementById('total-session-blocked'),
            trackerList: document.getElementById('tracker-list')
        };
        
        this.state = {
            currentDomain: null,
            isUpdating: false,
            retryCount: 0
        };
        
        this.debouncedToggle = debounce(this.handleToggle.bind(this), 300);
        this.init();
    }

    init() {
        try {
            this.validateElements();
            this.setupEventListeners();
            this.updateUI();
        } catch (error) {
            popupLogger.error('Failed to initialize popup', { error: error.message });
            this.showError('Initialisierungsfehler');
        }
    }

    validateElements() {
        for (const [name, element] of Object.entries(this.elements)) {
            if (!element) {
                throw new Error(`Required element not found: ${name}`);
            }
        }
    }

    setupEventListeners() {
        this.elements.enableSwitch.addEventListener('change', this.debouncedToggle);
        
        // Add error recovery on focus
        window.addEventListener('focus', () => {
            if (!this.state.isUpdating) {
                this.updateUI();
            }
        });
    }

    async updateUI() {
        const maxRetries = 3;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                if (!isExtensionContextValid()) {
                    throw new Error('Extension context invalid');
                }

                const data = await chrome.runtime.sendMessage({ command: 'getPopupData' });
                
                if (!data) {
                    throw new Error('No data received from background script');
                }

                if (data.error) {
                    throw new Error(data.error);
                }

                await this.renderUI(data);
                this.state.retryCount = 0; // Reset retry count on success
                popupLogger.debug('UI updated successfully', { domain: data.domain });
                return;
                
            } catch (error) {
                popupLogger.warn(`UI update attempt ${attempt} failed`, { error: error.message });
                
                if (attempt === maxRetries) {
                    this.showError('Fehler beim Laden der Daten');
                    popupLogger.error('All UI update attempts failed', { error: error.message });
                } else {
                    // Wait before retry
                    await new Promise(resolve => setTimeout(resolve, 100 * attempt));
                }
            }
        }
    }

    async renderUI(data) {
        const { isPaused, domain, filterCount } = data;
        this.state.currentDomain = domain;

        if (domain && this.isValidDomain(domain)) {
            this.updateForValidDomain(domain, isPaused);
            await this.updateTrackingStats(domain);
        } else {
            this.updateForInvalidDomain();
            this.hideTrackingStats();
        }

        this.updateFilterCount(filterCount);
    }

    updateForValidDomain(domain, isPaused) {
        this.elements.enableSwitch.disabled = false;
        this.elements.enableSwitch.checked = !isPaused;
        this.elements.statusText.textContent = isPaused ? 'Deaktiviert auf:' : 'Aktiv auf:';
        this.elements.domainText.textContent = sanitizeInput(domain);
        this.elements.statusText.className = isPaused ? 'status-disabled' : 'status-active';
    }

    updateForInvalidDomain() {
        this.elements.enableSwitch.disabled = true;
        this.elements.enableSwitch.checked = false;
        this.elements.statusText.textContent = 'Keine gültige Webseite';
        this.elements.domainText.textContent = 'Nicht anwendbar';
        this.elements.statusText.className = 'status-neutral';
    }

    updateFilterCount(filterCount) {
        const displayCount = typeof filterCount === 'number' 
            ? filterCount.toLocaleString() 
            : 'N/A';
        this.elements.filterCountEl.textContent = displayCount;
    }

    async handleToggle() {
        if (!this.state.currentDomain || this.state.isUpdating) {
            popupLogger.debug('Toggle ignored', { 
                domain: this.state.currentDomain, 
                isUpdating: this.state.isUpdating 
            });
            return;
        }

        if (!this.isValidDomain(this.state.currentDomain)) {
            popupLogger.error('Invalid domain for toggle', { domain: this.state.currentDomain });
            return;
        }

        this.state.isUpdating = true;
        const originalState = this.captureCurrentState();
        
        try {
            this.setLoadingState();

            const response = await chrome.runtime.sendMessage({
                command: 'toggleDomainState',
                domain: this.state.currentDomain,
                isPaused: !this.elements.enableSwitch.checked,
            });

            if (response?.error) {
                throw new Error(response.error);
            }

            popupLogger.info('Domain state toggled successfully', { 
                domain: this.state.currentDomain,
                newState: !this.elements.enableSwitch.checked ? 'disabled' : 'enabled'
            });

            // Popup will close automatically after page reload
            
        } catch (error) {
            popupLogger.error('Failed to toggle domain state', { 
                domain: this.state.currentDomain,
                error: error.message 
            });
            
            this.restoreState(originalState);
            this.showError('Fehler beim Ändern des Status');
            
            // Reset UI after delay
            setTimeout(() => {
                if (!this.state.isUpdating) {
                    this.updateUI();
                }
            }, 2000);
        }
    }

    captureCurrentState() {
        return {
            statusText: this.elements.statusText.textContent,
            statusClass: this.elements.statusText.className,
            switchEnabled: !this.elements.enableSwitch.disabled,
            switchChecked: this.elements.enableSwitch.checked
        };
    }

    setLoadingState() {
        this.elements.statusText.textContent = 'Wird geändert...';
        this.elements.statusText.className = 'status-updating';
        this.elements.enableSwitch.disabled = true;
    }

    restoreState(state) {
        this.elements.statusText.textContent = state.statusText;
        this.elements.statusText.className = state.statusClass;
        this.elements.enableSwitch.disabled = !state.switchEnabled;
        this.elements.enableSwitch.checked = state.switchChecked;
        this.state.isUpdating = false;
    }

    showError(message) {
        this.elements.statusText.textContent = sanitizeInput(message);
        this.elements.statusText.className = 'status-error';
        this.elements.domainText.textContent = '';
        this.elements.filterCountEl.textContent = 'N/A';
        this.elements.enableSwitch.disabled = true;
        this.elements.enableSwitch.checked = false;
        this.state.isUpdating = false;
    }

    async updateTrackingStats(domain) {
        try {
            popupLogger.debug('Loading tracking stats for domain', { domain });
            
            // Get session stats from background script
            const sessionStats = await chrome.runtime.sendMessage({ 
                command: 'getSessionStats',
                domain: domain 
            });

            if (sessionStats?.error) {
                throw new Error(sessionStats.error);
            }

            // Get overall session stats (total blocked across all sites)
            const overallSessionStats = await chrome.runtime.sendMessage({ 
                command: 'getSessionStats'
                // No domain parameter = get overall stats
            });

            if (overallSessionStats?.error) {
                throw new Error(overallSessionStats.error);
            }

            popupLogger.debug('Received tracking stats', { 
                sessionStats, 
                overallSessionStats,
                domain 
            });

            this.renderTrackingStats(sessionStats, overallSessionStats);
            this.elements.trackingStats.style.display = 'block';

        } catch (error) {
            popupLogger.warn('Failed to load tracking stats', { error: error.message });
            // Show basic stats even if detailed data fails
            this.renderBasicTrackingStats();
            this.elements.trackingStats.style.display = 'block';
        }
    }

    renderTrackingStats(sessionStats, trackingStats) {
        // Clear previous debug content
        const existingDebug = this.elements.trackingStats.querySelectorAll('[data-debug]');
        existingDebug.forEach(el => el.remove());

        let currentSiteStats = sessionStats || { blockedCount: 0, trackerDomains: [] };
        const totalStats = trackingStats || { totalBlocked: 0, blockedDomains: [] };


        // Update current site stats (now using potentially modified currentSiteStats)
        this.elements.currentSiteBlocked.textContent = currentSiteStats.blockedCount || 0;
        this.elements.currentSiteTrackers.textContent = currentSiteStats.trackerDomains?.length || 0;
        this.elements.totalSessionBlocked.textContent = totalStats.totalBlocked || 0;

        // Render tracker list for current site
        this.renderTrackerList(currentSiteStats.trackerDomains || []);
    }

    renderBasicTrackingStats() {
        // Fallback when detailed stats are not available
        this.elements.currentSiteBlocked.textContent = '?';
        this.elements.currentSiteTrackers.textContent = '?';
        this.elements.totalSessionBlocked.textContent = '?';
        this.elements.trackerList.innerHTML = '<div class="tracker-item"><span class="tracker-domain">Lädt...</span></div>';
    }

    renderTrackerList(trackerDomains) {
        if (!trackerDomains || trackerDomains.length === 0) {
            this.elements.trackerList.innerHTML = '<div class="tracker-item"><span class="tracker-domain">Keine Tracker erkannt</span></div>';
            return;
        }

        // Group trackers by domain and count requests
        const trackerCounts = {};
        trackerDomains.forEach(domain => {
            if (typeof domain === 'string') {
                trackerCounts[domain] = (trackerCounts[domain] || 0) + 1;
            } else if (domain && domain.domain) {
                const key = domain.domain;
                trackerCounts[key] = domain.count || 1;
            }
        });

        // Sort by request count (descending)
        const sortedTrackers = Object.entries(trackerCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10); // Show max 10 trackers

        // Render tracker items
        this.elements.trackerList.innerHTML = sortedTrackers
            .map(([domain, count]) => `
                <div class="tracker-item">
                    <span class="tracker-domain" title="${sanitizeInput(domain)}">${sanitizeInput(this.truncateDomain(domain))}</span>
                    <span class="tracker-count">${count}</span>
                </div>
            `).join('');
    }

    hideTrackingStats() {
        this.elements.trackingStats.style.display = 'none';
    }

    truncateDomain(domain) {
        if (!domain || domain.length <= 20) return domain;
        return domain.substring(0, 17) + '...';
    }

    isValidDomain(domain) {
        if (!domain || typeof domain !== 'string') return false;
        
        // Basic domain validation - exclude chrome:// and extension:// URLs
        const invalidPrefixes = ['chrome', 'extension', 'moz-extension', 'about'];
        return !invalidPrefixes.some(prefix => domain.startsWith(prefix)) && 
               domain.includes('.') && 
               domain.length <= EXTENSION_CONFIG.LIMITS.MAX_DOMAIN_LENGTH;
    }

    // Cleanup method for proper resource management
    destroy() {
        if (this.debouncedToggle) {
            this.debouncedToggle.cancel?.();
        }
        
        // Remove event listeners
        this.elements.enableSwitch?.removeEventListener('change', this.debouncedToggle);
        window.removeEventListener('focus', this.updateUI);
        
        popupLogger.debug('Popup destroyed');
    }
}

// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    try {
        new PagyPopup();
    } catch (error) {
        console.error('[Pagy Popup] Failed to initialize:', error);
    }
});

// Handle unload for cleanup
window.addEventListener('beforeunload', () => {
    if (window.pagyPopup) {
        window.pagyPopup.destroy();
    }
});
