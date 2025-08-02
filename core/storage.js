/**
 * @file core/storage.js
 * @description Storage abstraction layer for Pagy Blocker
 * @version 7.1.0
 */

import { EXTENSION_CONFIG } from './config.js';
import { createLogger } from './logger.js';
import { retryAsync, isExtensionContextValid } from './utilities.js';

const logger = createLogger('Storage');

class StorageManager {
    constructor() {
        this.cache = new Map();
        this.cacheTimestamps = new Map();
        this.pendingOperations = new Map();
    }

    /**
     * Get data from storage with caching support
     */
    async get(key, useCache = true) {
        if (!isExtensionContextValid()) {
            throw new Error('Extension context is invalid');
        }

        // Check cache first
        if (useCache && this.isCacheValid(key)) {
            logger.debug('Retrieved from cache', { key });
            return this.cache.get(key);
        }

        // Prevent duplicate operations
        if (this.pendingOperations.has(key)) {
            return this.pendingOperations.get(key);
        }

        const operation = retryAsync(async () => {
            const result = await chrome.storage.local.get(key);
            const value = result[key];
            
            // Update cache
            if (useCache) {
                this.updateCache(key, value);
            }
            
            logger.debug('Retrieved from storage', { key, hasValue: value !== undefined });
            return value;
        }, 3, 1000);

        this.pendingOperations.set(key, operation);
        
        try {
            const result = await operation;
            return result;
        } finally {
            this.pendingOperations.delete(key);
        }
    }

    /**
     * Set data to storage with caching
     */
    async set(key, value) {
        if (!isExtensionContextValid()) {
            throw new Error('Extension context is invalid');
        }

        await retryAsync(async () => {
            await chrome.storage.local.set({ [key]: value });
            
            // Update cache
            this.updateCache(key, value);
            
            logger.debug('Stored to storage', { key, valueType: typeof value });
        }, 3, 1000);
    }

    /**
     * Remove data from storage
     */
    async remove(key) {
        if (!isExtensionContextValid()) {
            throw new Error('Extension context is invalid');
        }

        await retryAsync(async () => {
            await chrome.storage.local.remove(key);
            
            // Remove from cache
            this.cache.delete(key);
            this.cacheTimestamps.delete(key);
            
            logger.debug('Removed from storage', { key });
        }, 3, 1000);
    }

    /**
     * Clear all data from storage
     */
    async clear() {
        if (!isExtensionContextValid()) {
            throw new Error('Extension context is invalid');
        }

        await chrome.storage.local.clear();
        this.cache.clear();
        this.cacheTimestamps.clear();
        
        logger.info('Cleared all storage data');
    }

    /**
     * Get storage usage information
     */
    async getUsage() {
        if (!isExtensionContextValid()) {
            return { bytesInUse: 0 };
        }

        try {
            const bytesInUse = await chrome.storage.local.getBytesInUse();
            return { bytesInUse };
        } catch (error) {
            logger.warn('Failed to get storage usage', { error: error.message });
            return { bytesInUse: 0 };
        }
    }

    /**
     * Cache management
     */
    updateCache(key, value) {
        this.cache.set(key, value);
        this.cacheTimestamps.set(key, Date.now());
    }

    isCacheValid(key) {
        if (!this.cache.has(key)) {
            return false;
        }

        const timestamp = this.cacheTimestamps.get(key);
        return timestamp && (Date.now() - timestamp < EXTENSION_CONFIG.PERFORMANCE.CACHE_TTL);
    }

    clearCache() {
        this.cache.clear();
        this.cacheTimestamps.clear();
        logger.debug('Cache cleared');
    }

    /**
     * Batch operations for better performance
     */
    async batchGet(keys) {
        if (!isExtensionContextValid()) {
            throw new Error('Extension context is invalid');
        }

        const result = await chrome.storage.local.get(keys);
        
        // Update cache for all retrieved values
        keys.forEach(key => {
            if (key in result) {
                this.updateCache(key, result[key]);
            }
        });

        logger.debug('Batch retrieved from storage', { keys, foundKeys: Object.keys(result) });
        return result;
    }

    async batchSet(data) {
        if (!isExtensionContextValid()) {
            throw new Error('Extension context is invalid');
        }

        await chrome.storage.local.set(data);
        
        // Update cache for all set values
        Object.entries(data).forEach(([key, value]) => {
            this.updateCache(key, value);
        });

        logger.debug('Batch stored to storage', { keys: Object.keys(data) });
    }
}

// Domain-specific storage operations
export class DomainStorage extends StorageManager {
    async getDisabledDomains() {
        const domains = await this.get(EXTENSION_CONFIG.STORAGE_KEYS.DISABLED_DOMAINS);
        return Array.isArray(domains) ? domains : [];
    }

    async setDisabledDomains(domains) {
        if (!Array.isArray(domains)) {
            throw new Error('Domains must be an array');
        }
        
        // Validate and sanitize domains
        const validDomains = domains.filter(domain => 
            typeof domain === 'string' && domain.length > 0
        );

        await this.set(EXTENSION_CONFIG.STORAGE_KEYS.DISABLED_DOMAINS, validDomains);
        logger.info('Updated disabled domains', { count: validDomains.length });
    }

    async addDisabledDomain(domain) {
        const domains = await this.getDisabledDomains();
        if (!domains.includes(domain)) {
            domains.push(domain);
            await this.setDisabledDomains(domains);
            logger.info('Added disabled domain', { domain });
        }
    }

    async removeDisabledDomain(domain) {
        const domains = await this.getDisabledDomains();
        const filtered = domains.filter(d => d !== domain);
        await this.setDisabledDomains(filtered);
        logger.info('Removed disabled domain', { domain });
    }

    async isDomainDisabled(domain) {
        const domains = await this.getDisabledDomains();
        return domains.includes(domain);
    }
}

// Settings storage operations
export class SettingsStorage extends StorageManager {
    async getUserSettings() {
        const settings = await this.get(EXTENSION_CONFIG.STORAGE_KEYS.USER_SETTINGS);
        return {
            logLevel: 1,
            enablePerformanceMonitoring: false,
            autoUpdateFilters: true,
            showNotifications: true,
            ...settings
        };
    }

    async updateUserSettings(updates) {
        const current = await this.getUserSettings();
        const merged = { ...current, ...updates };
        await this.set(EXTENSION_CONFIG.STORAGE_KEYS.USER_SETTINGS, merged);
        logger.info('Updated user settings', { updates: Object.keys(updates) });
    }
}

// Filter cache storage operations
export class FilterCacheStorage extends StorageManager {
    async getFilterCache() {
        return await this.get(EXTENSION_CONFIG.STORAGE_KEYS.FILTER_CACHE) || {
            rules: [],
            timestamp: 0,
            version: EXTENSION_CONFIG.VERSION
        };
    }

    async updateFilterCache(rules) {
        const cache = {
            rules,
            timestamp: Date.now(),
            version: EXTENSION_CONFIG.VERSION
        };
        
        await this.set(EXTENSION_CONFIG.STORAGE_KEYS.FILTER_CACHE, cache);
        logger.info('Updated filter cache', { ruleCount: rules.length });
    }

    async isCacheValid() {
        const cache = await this.getFilterCache();
        const maxAge = 24 * 60 * 60 * 1000; // 24 hours
        
        return cache.timestamp > 0 && 
               (Date.now() - cache.timestamp < maxAge) &&
               cache.version === EXTENSION_CONFIG.VERSION;
    }
}

// Create singleton instances
export const domainStorage = new DomainStorage();
export const settingsStorage = new SettingsStorage();
export const filterCacheStorage = new FilterCacheStorage();

// Default export
export default StorageManager;
