/**
 * @file options.js
 * @description Einstellungsseite für Pagy Blocker
 * @version 7.1.0
 */

import { settingsStorage, domainStorage } from '../core/storage.js';
import { createLogger } from '../core/logger.js';
import { EXTENSION_CONFIG } from '../core/config.js';

const logger = createLogger('Options');

class OptionsManager {
    constructor() {
        this.settings = {};
        this.isInitialized = false;
    }

    async initialize() {
        if (this.isInitialized) return;
        
        try {
            await this.loadSettings();
            this.setupEventListeners();
            this.updateUI();
            await this.loadStatistics();
            
            this.isInitialized = true;
            logger.info('Options page initialized');
        } catch (error) {
            logger.error('Failed to initialize options page', { error: error.message });
            this.showError('Fehler beim Laden der Einstellungen');
        }
    }

    async loadSettings() {
        this.settings = await settingsStorage.getUserSettings();
        logger.debug('Settings loaded', this.settings);
    }

    async saveSettings() {
        try {
            await settingsStorage.updateUserSettings(this.settings);
            this.showSuccess('Einstellungen gespeichert');
            logger.info('Settings saved', this.settings);
        } catch (error) {
            logger.error('Failed to save settings', { error: error.message });
            this.showError('Fehler beim Speichern der Einstellungen');
        }
    }

    setupEventListeners() {
        // Protection Level
        const protectionLevel = document.getElementById('protection-level');
        protectionLevel.value = this.settings.protectionLevel || 'standard';
        protectionLevel.addEventListener('change', (e) => {
            this.settings.protectionLevel = e.target.value;
            this.saveSettings();
        });

        // Auto Update
        const autoUpdate = document.getElementById('auto-update');
        autoUpdate.checked = this.settings.autoUpdateFilters !== false;
        autoUpdate.addEventListener('change', (e) => {
            this.settings.autoUpdateFilters = e.target.checked;
            this.saveSettings();
        });

        // Show Stats
        const showStats = document.getElementById('show-stats');
        showStats.checked = this.settings.showSessionStats !== false;
        showStats.addEventListener('change', (e) => {
            this.settings.showSessionStats = e.target.checked;
            this.saveSettings();
        });

        // Performance Monitoring
        const perfMonitoring = document.getElementById('performance-monitoring');
        perfMonitoring.checked = this.settings.enablePerformanceMonitoring || false;
        perfMonitoring.addEventListener('change', (e) => {
            this.settings.enablePerformanceMonitoring = e.target.checked;
            this.saveSettings();
        });

        // Log Level
        const logLevel = document.getElementById('log-level');
        logLevel.value = this.settings.logLevel?.toString() || '1';
        logLevel.addEventListener('change', (e) => {
            this.settings.logLevel = parseInt(e.target.value);
            this.saveSettings();
        });

        // Advanced buttons
        document.getElementById('manage-whitelist').addEventListener('click', () => {
            this.openWhitelistManager();
        });

        document.getElementById('import-filters').addEventListener('click', () => {
            this.importCustomFilters();
        });

        document.getElementById('export-settings').addEventListener('click', () => {
            this.exportSettings();
        });

        document.getElementById('reset-all').addEventListener('click', () => {
            this.resetAllSettings();
        });
    }

    updateUI() {
        // Update version in header
        const versionElement = document.querySelector('.version');
        if (versionElement) {
            versionElement.textContent = `Version ${EXTENSION_CONFIG.VERSION}`;
        }
    }

    async loadStatistics() {
        try {
            // Total blocked trackers from session
            const sessionStats = await chrome.runtime.sendMessage({
                command: 'getSessionStats'
            });

            // Active filter rules
            const response = await fetch(chrome.runtime.getURL('filter_lists/filter_precompiled.json'));
            const filterRules = await response.json();
            const activeRules = Array.isArray(filterRules) ? filterRules.length : 0;

            // Protected websites (disabled domains count)
            const disabledDomains = await domainStorage.getDisabledDomains();
            const websitesProtected = disabledDomains.length;

            // Storage usage
            const storageUsage = await this.getStorageUsage();

            // Update UI
            this.updateStatCard('total-blocked', sessionStats.totalBlocked || 0);
            this.updateStatCard('active-rules', activeRules);
            this.updateStatCard('websites-protected', websitesProtected);
            this.updateStatCard('storage-usage', `${storageUsage} KB`);

        } catch (error) {
            logger.error('Failed to load statistics', { error: error.message });
            // Show default values
            this.updateStatCard('total-blocked', '---');
            this.updateStatCard('active-rules', '---');
            this.updateStatCard('websites-protected', '---');
            this.updateStatCard('storage-usage', '--- KB');
        }
    }

    updateStatCard(id, value) {
        const element = document.getElementById(id);
        if (element) {
            element.textContent = value;
        }
    }

    async getStorageUsage() {
        try {
            const bytesInUse = await chrome.storage.local.getBytesInUse();
            return Math.round(bytesInUse / 1024); // Convert to KB
        } catch (error) {
            return 0;
        }
    }

    openWhitelistManager() {
        // Create and show whitelist modal
        const modal = this.createModal('Whitelist verwalten', `
            <div class="whitelist-manager">
                <p>Websites in der Whitelist werden niemals blockiert:</p>
                <div class="input-group">
                    <input type="text" id="whitelist-input" placeholder="z.B. example.com" />
                    <button id="add-whitelist" class="btn btn-secondary">Hinzufügen</button>
                </div>
                <div id="whitelist-list" class="domain-list"></div>
            </div>
        `);

        this.loadWhitelistData();
        
        // Event listeners for whitelist management
        document.getElementById('add-whitelist').addEventListener('click', () => {
            this.addToWhitelist();
        });

        document.getElementById('whitelist-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.addToWhitelist();
            }
        });
    }

    async loadWhitelistData() {
        // This would load whitelist from storage
        const whitelistContainer = document.getElementById('whitelist-list');
        if (!whitelistContainer) return;

        try {
            const whitelist = this.settings.whitelist || [];
            whitelistContainer.innerHTML = '';

            if (whitelist.length === 0) {
                whitelistContainer.innerHTML = '<p class="empty-state">Keine Websites in der Whitelist</p>';
                return;
            }

            whitelist.forEach(domain => {
                const item = document.createElement('div');
                item.className = 'domain-item';
                item.innerHTML = `
                    <span class="domain-name">${domain}</span>
                    <button class="btn-remove" data-domain="${domain}">×</button>
                `;
                
                item.querySelector('.btn-remove').addEventListener('click', (e) => {
                    this.removeFromWhitelist(e.target.dataset.domain);
                });

                whitelistContainer.appendChild(item);
            });
        } catch (error) {
            logger.error('Failed to load whitelist', { error: error.message });
        }
    }

    async addToWhitelist() {
        const input = document.getElementById('whitelist-input');
        const domain = input.value.trim().toLowerCase();
        
        if (!domain) return;

        if (!this.settings.whitelist) {
            this.settings.whitelist = [];
        }

        if (this.settings.whitelist.includes(domain)) {
            this.showError('Domain bereits in der Whitelist');
            return;
        }

        this.settings.whitelist.push(domain);
        await this.saveSettings();
        
        input.value = '';
        this.loadWhitelistData();
        this.showSuccess(`${domain} zur Whitelist hinzugefügt`);
    }

    async removeFromWhitelist(domain) {
        if (!this.settings.whitelist) return;

        this.settings.whitelist = this.settings.whitelist.filter(d => d !== domain);
        await this.saveSettings();
        
        this.loadWhitelistData();
        this.showSuccess(`${domain} aus der Whitelist entfernt`);
    }

    importCustomFilters() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.txt,.json';
        
        input.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            try {
                const content = await file.text();
                // Parse and validate filter content
                const filters = this.parseFilterFile(content, file.name);
                
                if (filters.length === 0) {
                    this.showError('Keine gültigen Filter gefunden');
                    return;
                }

                // Add to custom filters
                if (!this.settings.customFilters) {
                    this.settings.customFilters = [];
                }
                
                this.settings.customFilters.push({
                    name: file.name,
                    filters: filters,
                    imported: Date.now()
                });

                await this.saveSettings();
                this.showSuccess(`${filters.length} Filter aus ${file.name} importiert`);
                
            } catch (error) {
                logger.error('Failed to import filters', { error: error.message });
                this.showError('Fehler beim Importieren der Filter');
            }
        });

        input.click();
    }

    parseFilterFile(content, filename) {
        const filters = [];
        
        if (filename.endsWith('.json')) {
            try {
                const jsonData = JSON.parse(content);
                if (Array.isArray(jsonData)) {
                    return jsonData.filter(item => item.condition && item.action);
                }
            } catch (e) {
                // Fall back to text parsing
            }
        }

        // Parse as text filter list
        const lines = content.split('\n');
        for (const line of lines) {
            const cleanLine = line.trim();
            if (cleanLine && !cleanLine.startsWith('!') && !cleanLine.startsWith('#')) {
                filters.push(cleanLine);
            }
        }

        return filters;
    }

    async exportSettings() {
        try {
            const exportData = {
                settings: this.settings,
                exportDate: new Date().toISOString(),
                version: EXTENSION_CONFIG.VERSION
            };

            const blob = new Blob([JSON.stringify(exportData, null, 2)], {
                type: 'application/json'
            });

            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `pagy-blocker-settings-${new Date().toISOString().split('T')[0]}.json`;
            a.click();

            URL.revokeObjectURL(url);
            this.showSuccess('Einstellungen exportiert');

        } catch (error) {
            logger.error('Failed to export settings', { error: error.message });
            this.showError('Fehler beim Exportieren der Einstellungen');
        }
    }

    async resetAllSettings() {
        if (!confirm('Alle Einstellungen und Daten wirklich zurücksetzen? Diese Aktion kann nicht rückgängig gemacht werden.')) {
            return;
        }

        try {
            // Clear all storage
            await chrome.storage.local.clear();
            await chrome.storage.session.clear();

            // Reset to defaults
            this.settings = {
                logLevel: 1,
                enablePerformanceMonitoring: false,
                autoUpdateFilters: true,
                showSessionStats: true,
                protectionLevel: 'standard'
            };

            await this.saveSettings();
            
            // Reload page to show reset state
            window.location.reload();

        } catch (error) {
            logger.error('Failed to reset settings', { error: error.message });
            this.showError('Fehler beim Zurücksetzen der Einstellungen');
        }
    }

    createModal(title, content) {
        // Remove existing modal
        const existingModal = document.querySelector('.modal-overlay');
        if (existingModal) {
            existingModal.remove();
        }

        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal">
                <div class="modal-header">
                    <h3>${title}</h3>
                    <button class="modal-close">×</button>
                </div>
                <div class="modal-content">
                    ${content}
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Close modal events
        modal.querySelector('.modal-close').addEventListener('click', () => {
            modal.remove();
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });

        return modal;
    }

    showSuccess(message) {
        this.showNotification(message, 'success');
    }

    showError(message) {
        this.showNotification(message, 'error');
    }

    showNotification(message, type = 'info') {
        // Remove existing notifications
        const existing = document.querySelectorAll('.notification');
        existing.forEach(n => n.remove());

        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.textContent = message;
        
        document.body.appendChild(notification);

        // Auto remove after 3 seconds
        setTimeout(() => {
            notification.classList.add('fade-out');
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }
}

// Add styles for modal and notifications
const additionalStyles = `
.modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
}

.modal {
    background: var(--bg-secondary);
    border-radius: var(--border-radius);
    min-width: 400px;
    max-width: 600px;
    max-height: 80vh;
    overflow: hidden;
    box-shadow: var(--shadow);
}

.modal-header {
    padding: 20px;
    border-bottom: 1px solid var(--border-color);
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.modal-header h3 {
    margin: 0;
    font-size: 18px;
}

.modal-close {
    background: none;
    border: none;
    font-size: 24px;
    color: var(--text-secondary);
    cursor: pointer;
    padding: 0;
    width: 30px;
    height: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
}

.modal-content {
    padding: 20px;
    max-height: 60vh;
    overflow-y: auto;
}

.input-group {
    display: flex;
    gap: 12px;
    margin: 16px 0;
}

.input-group input {
    flex: 1;
    padding: 10px;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--bg-tertiary);
    color: var(--text-primary);
}

.domain-list {
    max-height: 300px;
    overflow-y: auto;
}

.domain-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 12px;
    margin: 4px 0;
    background: var(--bg-tertiary);
    border-radius: 6px;
}

.domain-name {
    font-family: monospace;
    font-size: 14px;
}

.btn-remove {
    background: var(--accent-danger);
    color: white;
    border: none;
    border-radius: 4px;
    width: 24px;
    height: 24px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
}

.empty-state {
    text-align: center;
    color: var(--text-muted);
    padding: 20px;
    font-style: italic;
}

.notification {
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 12px 20px;
    border-radius: 8px;
    color: white;
    font-weight: 600;
    z-index: 2000;
    transform: translateX(100%);
    animation: slideIn 0.3s ease forwards;
}

.notification-success {
    background: var(--accent-primary);
}

.notification-error {
    background: var(--accent-danger);
}

.notification.fade-out {
    animation: slideOut 0.3s ease forwards;
}

@keyframes slideIn {
    to { transform: translateX(0); }
}

@keyframes slideOut {
    to { transform: translateX(100%); }
}
`;

// Inject additional styles
const style = document.createElement('style');
style.textContent = additionalStyles;
document.head.appendChild(style);

// Initialize when DOM is ready
const optionsManager = new OptionsManager();

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        optionsManager.initialize();
    });
} else {
    optionsManager.initialize();
}

// Refresh statistics every 30 seconds
setInterval(() => {
    if (optionsManager.isInitialized) {
        optionsManager.loadStatistics();
    }
}, 30000);
