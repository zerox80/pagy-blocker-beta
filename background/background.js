/**
 * @file background.js
 * @description Service Worker für Pagy Blocker - Domain-basierte Filtersteuerung
 * @version 7.1.0
 */

import { EXTENSION_CONFIG, RULE_CONFIG } from '../core/config.js';
import { backgroundLogger } from '../core/logger.js';
import { getDomainFromUrl, normalizeDomain, isValidDomain, debounce, PerformanceTimer } from '../core/utilities.js';
import { domainStorage } from '../core/storage.js';
import { trackingDetector } from '../core/trackingDetector.js';

// State management
class BackgroundState {
    constructor() {
        this.precompiledFilterCount = 0;
        this.isInitialized = false;
        this.activeOperations = new Set();
        this.iconUpdateQueue = new Map();
    }

    async initialize() {
        if (this.isInitialized) return;
        
        const timer = new PerformanceTimer('Background initialization');
        
        try {
            await this.initializeFilterCount();
            await this.initializeStorage();
            await this.initializeTrackingDetector();
            await this.updateDynamicRules();
            
            this.isInitialized = true;
            backgroundLogger.info('Background script initialized successfully');
        } catch (error) {
            backgroundLogger.error('Failed to initialize background script', { error: error.message });
            throw error;
        } finally {
            timer.end();
        }
    }

    async initializeTrackingDetector() {
        try {
            await trackingDetector.initialize();
            backgroundLogger.info('Tracking detector initialized');
        } catch (error) {
            backgroundLogger.error('Failed to initialize tracking detector', { error: error.message });
            // Continue without tracking detector if it fails
        }
    }

    async initializeFilterCount() {
        try {
            const response = await fetch(chrome.runtime.getURL('filter_lists/filter_precompiled.json'));
            const filterRules = await response.json();
            this.precompiledFilterCount = Array.isArray(filterRules) ? filterRules.length : 0;
            backgroundLogger.info('Filter count initialized', { count: this.precompiledFilterCount });
        } catch (error) {
            backgroundLogger.error('Failed to initialize filter count', { error: error.message });
            this.precompiledFilterCount = 0;
        }
    }

    async initializeStorage() {
        try {
            const disabledDomains = await domainStorage.getDisabledDomains();
            backgroundLogger.debug('Storage initialized', { disabledDomainsCount: disabledDomains.length });
        } catch (error) {
            backgroundLogger.error('Failed to initialize storage', { error: error.message });
            // Initialize with empty array if storage fails
            await domainStorage.setDisabledDomains([]);
        }
    }
}

const state = new BackgroundState();

// Centralized Rule ID Management
class RuleIdManager {
    static ID_RANGES = {
        ALLOW_RULES: { start: 1, end: 999 },           // 1-999: Allow rules for disabled domains
        TRACKING_RULES: { start: 1000, end: 9999 },   // 1000-9999: Bulk tracking rules  
        AUTO_BLOCK_RULES: { start: 10000, end: 99999 } // 10000+: Auto-block rules
    };

    static async getNextAvailableId(rangeType) {
        const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
        const range = this.ID_RANGES[rangeType];
        
        const usedIds = new Set(
            existingRules
                .filter(rule => rule.id >= range.start && rule.id <= range.end)
                .map(rule => rule.id)
        );

        for (let id = range.start; id <= range.end; id++) {
            if (!usedIds.has(id)) {
                return id;
            }
        }
        
        throw new Error(`No available IDs in range ${rangeType}`);
    }

    static async clearRulesInRange(rangeType) {
        const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
        const range = this.ID_RANGES[rangeType];
        
        const rulesToRemove = existingRules
            .filter(rule => rule.id >= range.start && rule.id <= range.end)
            .map(rule => rule.id);

        if (rulesToRemove.length > 0) {
            await chrome.declarativeNetRequest.updateDynamicRules({
                removeRuleIds: rulesToRemove
            });
        }

        return rulesToRemove.length;
    }
}

// Dynamic rules management with proper ID management
const updateDynamicRules = async () => {
    const operationId = 'updateDynamicRules';
    
    // Prevent concurrent operations
    if (state.activeOperations.has(operationId)) {
        backgroundLogger.debug('Dynamic rules update already in progress');
        return;
    }
    
    state.activeOperations.add(operationId);
    const timer = new PerformanceTimer('Update dynamic rules');
    
    try {
        const disabledDomains = await domainStorage.getDisabledDomains();
        
        // Validate and filter domains
        const validDomains = disabledDomains
            .filter(isValidDomain)
            .slice(0, EXTENSION_CONFIG.LIMITS.MAX_DYNAMIC_RULES);

        if (validDomains.length !== disabledDomains.length) {
            backgroundLogger.warn('Invalid domains filtered out', { 
                original: disabledDomains.length, 
                valid: validDomains.length 
            });
        }

        // Clear existing allow rules
        const removedCount = await RuleIdManager.clearRulesInRange('ALLOW_RULES');

        // Create new allow rules with sequential IDs starting from 1
        const rulesToAdd = validDomains.map((domain, index) => ({
            id: RuleIdManager.ID_RANGES.ALLOW_RULES.start + index,
            priority: EXTENSION_CONFIG.PRIORITIES.ALLOW_RULE,
            action: { type: RULE_CONFIG.ACTIONS.ALLOW },
            condition: { 
                requestDomains: [domain], 
                resourceTypes: RULE_CONFIG.RESOURCE_TYPES
            }
        }));

        if (rulesToAdd.length > 0) {
            await chrome.declarativeNetRequest.updateDynamicRules({
                addRules: rulesToAdd
            });
        }

        backgroundLogger.info('Dynamic rules updated', { 
            removed: removedCount, 
            added: rulesToAdd.length 
        });

    } catch (error) {
        backgroundLogger.error('Failed to update dynamic rules', { 
            error: error.message,
            stack: error.stack 
        });
        throw error;
    } finally {
        state.activeOperations.delete(operationId);
        timer.end();
    }
};

// Add updateDynamicRules to state class
state.updateDynamicRules = updateDynamicRules;

// Icon management with debouncing
const updateIcon = debounce(async (tabId) => {
    const operationId = `updateIcon-${tabId}`;
    
    if (state.activeOperations.has(operationId)) {
        return;
    }
    
    state.activeOperations.add(operationId);
    
    try {
        if (!tabId || typeof tabId !== 'number') {
            backgroundLogger.error('Invalid tabId for updateIcon', { tabId });
            return;
        }

        const tab = await chrome.tabs.get(tabId);
        const domain = getDomainFromUrl(tab.url);

        // For non-web URLs use default icon
        if (!domain) {
            await chrome.action.setIcon({ path: EXTENSION_CONFIG.ICONS.DEFAULT, tabId });
            return;
        }

        const isPausedForDomain = await domainStorage.isDomainDisabled(domain);
        const iconPath = isPausedForDomain ? EXTENSION_CONFIG.ICONS.DISABLED : EXTENSION_CONFIG.ICONS.DEFAULT;
        
        await chrome.action.setIcon({ path: iconPath, tabId });
        
        // Badge text for additional information
        const badgeText = isPausedForDomain ? '⏸' : '';
        await chrome.action.setBadgeText({ text: badgeText, tabId });
        
        backgroundLogger.debug('Icon updated', { tabId, domain, isPaused: isPausedForDomain });
        
    } catch (error) {
        // Tab might not exist anymore - normal during fast tab switching
        if (!error.message.includes('No tab with id')) {
            backgroundLogger.error('Failed to update icon', { tabId, error: error.message });
        }
    } finally {
        state.activeOperations.delete(operationId);
    }
}, 100); // Debounce icon updates

// Message handler with improved error handling
class MessageHandler {
    static async handleGetPopupData() {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const domain = getDomainFromUrl(activeTab?.url);
        const isPaused = domain ? await domainStorage.isDomainDisabled(domain) : false;
        
        return {
            isPaused,
            domain,
            filterCount: state.precompiledFilterCount
        };
    }

    static async handleGetState(sender) {
        const domain = getDomainFromUrl(sender.tab?.url);
        if (!domain) {
            return { isPaused: false };
        }
        
        const isPaused = await domainStorage.isDomainDisabled(domain);
        return { isPaused, domain };
    }

    static async handleToggleDomainState({ domain, isPaused }) {
        if (!domain || !isValidDomain(domain)) {
            throw new Error('Invalid domain provided');
        }

        const timer = new PerformanceTimer(`Toggle domain ${domain}`);
        
        try {
            if (isPaused) {
                await domainStorage.addDisabledDomain(domain);
            } else {
                await domainStorage.removeDisabledDomain(domain);
            }

            await updateDynamicRules();

            // Notify all content scripts about the state change
            const tabs = await chrome.tabs.query({});
            const notificationPromises = tabs
                .filter(tab => getDomainFromUrl(tab.url) === domain)
                .map(async (tab) => {
                    try {
                        await chrome.tabs.sendMessage(tab.id, {
                            command: 'updatePauseState',
                            isPaused: isPaused
                        });
                    } catch (e) {
                        // Tab might not exist anymore or be loading
                    }
                });

            await Promise.allSettled(notificationPromises);

            // Reload active tab if it matches the domain
            const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (activeTab && getDomainFromUrl(activeTab.url) === domain) {
                chrome.tabs.reload(activeTab.id);
            }

            return { success: true };
        } finally {
            timer.end();
        }
    }

    static async handleUpdateTrackingRules({ blockedDomains }) {
        try {
            // Clear existing tracking rules
            const removedCount = await RuleIdManager.clearRulesInRange('TRACKING_RULES');

            // Create new blocking rules for detected trackers using sequential IDs
            const maxRules = Math.min(blockedDomains.length, 8999); // Stay within range
            const newTrackingRules = blockedDomains.slice(0, maxRules).map((domain, index) => ({
                id: RuleIdManager.ID_RANGES.TRACKING_RULES.start + index,
                priority: EXTENSION_CONFIG.PRIORITIES.DEFAULT_RULE + 50, // Higher than regular rules
                action: { type: RULE_CONFIG.ACTIONS.BLOCK },
                condition: { 
                    requestDomains: [domain], 
                    resourceTypes: RULE_CONFIG.RESOURCE_TYPES
                }
            }));

            if (newTrackingRules.length > 0) {
                await chrome.declarativeNetRequest.updateDynamicRules({
                    addRules: newTrackingRules
                });
            }

            backgroundLogger.info('Tracking rules updated', { 
                blocked: newTrackingRules.length,
                removed: removedCount 
            });

            return { success: true, blockedCount: newTrackingRules.length };
        } catch (error) {
            backgroundLogger.error('Failed to update tracking rules', { error: error.message });
            throw error;
        }
    }

    static async handleGetTrackingStats({ domain }) {
        try {
            if (domain) {
                const stats = trackingDetector.getDomainStats(domain);
                return { stats };
            } else {
                const blockedDomains = trackingDetector.getBlockedDomains();
                return { blockedDomains, totalBlocked: blockedDomains.length };
            }
        } catch (error) {
            backgroundLogger.error('Failed to get tracking stats', { error: error.message });
            throw error;
        }
    }

    static async handleAllowTrackingDomain({ domain }) {
        try {
            await trackingDetector.allowTrackingDomain(domain);
            return { success: true };
        } catch (error) {
            backgroundLogger.error('Failed to allow tracking domain', { error: error.message });
            throw error;
        }
    }

    static async handleGetSessionStats({ domain }) {
        try {
            // Get session-specific tracking statistics
            const sessionStats = await MessageHandler.getSessionTrackingStats(domain);
            return sessionStats;
        } catch (error) {
            backgroundLogger.error('Failed to get session stats', { error: error.message });
            return { blockedCount: 0, trackerDomains: [] };
        }
    }

    static async getSessionTrackingStats(currentDomain) {
        try {
            // Session stats are stored in memory for the current browser session
            const sessionData = await chrome.storage.session.get(['sessionTrackingStats']);
            const stats = sessionData.sessionTrackingStats || {};
            
            // Normalize domain for consistent lookup
            const normalizedDomain = currentDomain ? normalizeDomain(currentDomain) : null;
            
            
            if (!normalizedDomain) {
                // Return overall session stats
                let totalBlocked = 0;
                const allTrackers = new Set();
                
                Object.values(stats).forEach(siteStats => {
                    totalBlocked += siteStats.blockedCount || 0;
                    if (siteStats.trackerDomains) {
                        siteStats.trackerDomains.forEach(tracker => allTrackers.add(tracker));
                    }
                });
                
                return {
                    totalBlocked,
                    trackerDomains: Array.from(allTrackers),
                    sitesCount: Object.keys(stats).length
                };
            }
            
            // Return stats for specific domain (normalized)
            const siteStats = stats[normalizedDomain] || { blockedCount: 0, trackerDomains: [] };
            
            return {
                blockedCount: siteStats.blockedCount || 0,
                trackerDomains: siteStats.trackerDomains || [],
                lastUpdated: siteStats.lastUpdated || Date.now()
            };
            
        } catch (error) {
            backgroundLogger.warn('Failed to get session tracking stats from storage', { error: error.message });
            return { blockedCount: 0, trackerDomains: [] };
        }
    }

    static async updateSessionStats(domain, blockedTracker) {
        try {
            const sessionData = await chrome.storage.session.get(['sessionTrackingStats']);
            const stats = sessionData.sessionTrackingStats || {};
            
            // Normalize domain for consistent storage
            const normalizedDomain = normalizeDomain(domain);
            
            if (!stats[normalizedDomain]) {
                stats[normalizedDomain] = {
                    blockedCount: 0,
                    trackerDomains: [],
                    firstSeen: Date.now(),
                    lastUpdated: Date.now()
                };
            }
            
            stats[normalizedDomain].blockedCount++;
            if (!stats[normalizedDomain].trackerDomains.includes(blockedTracker)) {
                stats[normalizedDomain].trackerDomains.push(blockedTracker);
            }
            stats[normalizedDomain].lastUpdated = Date.now();
            
            await chrome.storage.session.set({ sessionTrackingStats: stats });
            
        } catch (error) {
            backgroundLogger.warn('Failed to update session stats', { error: error.message });
        }
    }

    static async handleLiveTrackerDetected(data) {
        try {
            // Validiere und sanitize alle Eingabedaten
            if (!data || typeof data !== 'object') {
                throw new Error('Invalid data object provided');
            }

            const url = String(data.url || '').substring(0, 200);
            const domain = String(data.domain || '').toLowerCase();
            const type = String(data.type || 'unknown');
            const initiator = String(data.initiator || 'unknown').toLowerCase();
            const timestamp = Number(data.timestamp) || Date.now();

            // Validiere kritische Felder
            if (!domain || !initiator) {
                throw new Error('Missing required fields: domain or initiator');
            }
            
            backgroundLogger.info('Live tracker detected', { 
                domain, 
                type, 
                initiator,
                url: url.substring(0, 100)
            });

            // 1. Sofort Session-Stats aktualisieren
            await MessageHandler.updateSessionStats(initiator, domain);

            // 2. An TrackingDetector weiterleiten für langfristige Analyse
            if (trackingDetector && trackingDetector.isInitialized) {
                try {
                    // Simuliere einen Request für den TrackingDetector
                    const mockDetails = {
                        url,
                        type,
                        initiator: `https://${initiator}`,
                        documentUrl: `https://${initiator}`,
                        timestamp
                    };
                    
                    await trackingDetector.analyzeRequest(mockDetails);
                } catch (error) {
                    backgroundLogger.warn('Failed to analyze with tracking detector', { error: error.message });
                }
            }

            // 3. Prüfe ob Domain automatisch blockiert werden sollte
            const shouldAutoBlock = await MessageHandler.shouldAutoBlockDomain(domain);
            if (shouldAutoBlock) {
                await MessageHandler.autoBlockTracker(domain);
            }

            return { success: true, autoBlocked: shouldAutoBlock };

        } catch (error) {
            const errorMessage = error?.message || String(error) || 'Unknown error';
            backgroundLogger.error('Failed to handle live tracker detection', { 
                error: errorMessage,
                stack: error?.stack,
                type: typeof error
            });
            return { error: errorMessage };
        }
    }

    static async shouldAutoBlockDomain(domain) {
        try {
            // Prüfe ob Domain bereits in bekannten Trackern ist
            if (KNOWN_TRACKER_DOMAINS.has(domain)) {
                return true;
            }

            // Prüfe historische Daten aus TrackingDetector
            if (trackingDetector && trackingDetector.isInitialized) {
                const stats = trackingDetector.getDomainStats(domain);
                if (stats && stats.score >= 50) { // Hoher Tracker-Score
                    return true;
                }
            }

            return false;
        } catch (error) {
            backgroundLogger.warn('Failed to check auto-block status', { error: error.message });
            return false;
        }
    }

    static async autoBlockTracker(domain) {
        try {
            backgroundLogger.info('Auto-blocking tracker domain', { domain });

            // Hole aktuelle dynamische Regeln
            const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
            
            // Prüfe ob Domain bereits blockiert ist
            const existingBlockRule = existingRules.find(rule => 
                rule.action.type === 'block' && 
                rule.condition.requestDomains?.includes(domain)
            );

            if (existingBlockRule) {
                backgroundLogger.info('Domain already blocked', { domain, ruleId: existingBlockRule.id });
                return { success: true, ruleId: existingBlockRule.id, alreadyBlocked: true };
            }

            // Verwende RuleIdManager für sichere ID-Generierung
            const newRuleId = await RuleIdManager.getNextAvailableId('AUTO_BLOCK_RULES');

            // Erstelle neue Blockierungsregel
            const newRule = {
                id: newRuleId,
                priority: EXTENSION_CONFIG.PRIORITIES.DEFAULT_RULE + 100, // Höhere Priorität
                action: { type: RULE_CONFIG.ACTIONS.BLOCK },
                condition: { 
                    requestDomains: [domain], 
                    resourceTypes: RULE_CONFIG.RESOURCE_TYPES
                }
            };

            await chrome.declarativeNetRequest.updateDynamicRules({
                addRules: [newRule]
            });

            backgroundLogger.info('Tracker domain auto-blocked', { domain, ruleId: newRuleId });

            return { success: true, ruleId: newRuleId };

        } catch (error) {
            const errorMessage = error?.message || String(error) || 'Unknown error';
            backgroundLogger.error('Failed to auto-block tracker', { 
                domain,
                error: errorMessage,
                stack: error?.stack,
                type: typeof error
            });
            throw error;
        }
    }

}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
        try {
            let result;
            
            switch (message.command) {
                case 'getPopupData':
                    result = await MessageHandler.handleGetPopupData();
                    break;
                case 'getState':
                    result = await MessageHandler.handleGetState(sender);
                    break;
                case 'toggleDomainState':
                    result = await MessageHandler.handleToggleDomainState(message);
                    break;
                case 'updateTrackingRules':
                    result = await MessageHandler.handleUpdateTrackingRules(message);
                    break;
                case 'getTrackingStats':
                    result = await MessageHandler.handleGetTrackingStats(message);
                    break;
                case 'allowTrackingDomain':
                    result = await MessageHandler.handleAllowTrackingDomain(message);
                    break;
                case 'getSessionStats':
                    result = await MessageHandler.handleGetSessionStats(message);
                    break;
                case 'updateSessionStats':
                    result = await MessageHandler.updateSessionStats(message.site, message.blockedTracker);
                    break;
                case 'liveTrackerDetected':
                    result = await MessageHandler.handleLiveTrackerDetected(message.data);
                    break;
                default:
                    throw new Error(`Unknown command: ${message.command}`);
            }
            
            sendResponse(result);
        } catch (error) {
            backgroundLogger.error('Message handler error', { 
                command: message.command, 
                error: error.message 
            });
            sendResponse({ error: error.message });
        }
    })();
    return true;
});

// Event listeners
chrome.runtime.onInstalled.addListener(async (details) => {
    backgroundLogger.info('Extension installed/updated', { reason: details.reason });
    
    try {
        await state.initialize();
        
        // Setup direct webRequest monitoring for session stats
        setupDirectWebRequestMonitoring();
        
        backgroundLogger.info('Extension initialization completed');
    } catch (error) {
        backgroundLogger.error('Extension initialization failed', { error: error.message });
    }
});

chrome.runtime.onStartup.addListener(async () => {
    backgroundLogger.info('Extension startup');
    
    try {
        await state.initialize();
    } catch (error) {
        backgroundLogger.error('Extension startup failed', { error: error.message });
    }
});

// Tab event listeners with proper error handling
chrome.tabs.onActivated.addListener((activeInfo) => {
    updateIcon(activeInfo.tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' || changeInfo.url) {
        updateIcon(tabId);
    }
});

// Direct webRequest monitoring for immediate session stats
function setupDirectWebRequestMonitoring() {
    // Monitor all network requests to detect blocked trackers
    if (chrome.webRequest && chrome.webRequest.onBeforeRequest) {
        chrome.webRequest.onBeforeRequest.addListener(
            async (details) => {
                try {
                    const requestUrl = details.url;
                    const requestDomain = getDomainFromUrl(requestUrl);
                    const initiatorDomain = getDomainFromUrl(details.initiator || details.documentUrl);

                    // Skip invalid requests or same-domain requests
                    if (!requestDomain || !initiatorDomain || requestDomain === initiatorDomain) {
                        return;
                    }

                    // Check if this request domain should be blocked (is a known tracker)
                    const isKnownTracker = await isRequestFromKnownTracker(requestDomain, requestUrl);
                    
                    if (isKnownTracker) {
                        // Update session stats immediately
                        await MessageHandler.updateSessionStats(initiatorDomain, requestDomain);
                    }

                } catch (error) {
                    // Silent error handling for production
                    backgroundLogger.warn('WebRequest monitoring error', { error: error.message });
                }
            },
            { urls: ['<all_urls>'] },
            []
        );
    }
}

// Optimized tracker detection with Set for O(1) lookups
const KNOWN_TRACKER_DOMAINS = new Set([
    'doubleclick.net',
    'googletagmanager.com',
    'google-analytics.com',
    'facebook.com',
    'facebook.net',
    'amazon-adsystem.com',
    'googlesyndication.com',
    'outbrain.com',
    'taboola.com',
    'criteo.com',
    'adsystem.amazon.com',
    'twitter.com',
    'linkedin.com',
    'pinterest.com',
    'instagram.com',
    'tiktok.com',
    'chartbeat.com',
    'quantserve.com',
    'comscore.com',
    'newrelic.com',
    'adobe.com',
    'omniture.com',
    'adnxs.com',
    'adsrvr.org',
    'adform.net',
    'adsafeprotected.com',
    'pubmatic.com',
    'openx.net',
    'rubiconproject.com',
    'spotxchange.com',
    'adroll.com',
    'revcontent.com',
    'media.net',
    'flashtalking.com',
    'atdmt.com',
    'emxdgt.com',
    'appnexus.com',
    'mathtag.com',
    'contextweb.com',
    'sovrn.com',
    'yieldmo.com',
    'improvedigital.com',
    'indexexchange.com',
    'adcolony.com',
    'integralads.com',
    'smartadserver.com',
    'advertising.com',
    'casalemedia.com',
    'smaato.net'
]);

const TRACKING_PATTERNS = [
    /analytics/i,
    /tracking/i,
    /metrics/i,
    /beacon/i,
    /pixel/i,
    /collect/i,
    /event/i,
    /impression/i,
    /click/i,
    /conversion/i,
    /affiliate/i,
    /partner/i,
    /utm_/i,
    /gclid/i,
    /fbclid/i
];

// Check if a request domain is a known tracker (optimized)
async function isRequestFromKnownTracker(domain, url) {
    // Fast O(1) domain lookup
    if (KNOWN_TRACKER_DOMAINS.has(domain)) {
        return true;
    }
    
    // Check for tracking URL patterns (cached)
    const urlLower = url.toLowerCase();
    return TRACKING_PATTERNS.some(pattern => pattern.test(urlLower));
}

// Initialize immediately if service worker is already running
(async () => {
    try {
        await state.initialize();
    } catch (error) {
        backgroundLogger.error('Initial state initialization failed', { error: error.message });
    }
})();
