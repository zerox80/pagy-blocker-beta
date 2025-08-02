/**
 * @file trackingDetector.js
 * @description Automatic tracking domain detection system - Privacy Badger style
 * @version 1.0.0
 */

import { backgroundLogger } from './logger.js';
import { getDomainFromUrl, isValidDomain } from './utilities.js';
import { TRACKING_CONFIG } from './trackingConfig.js';

/**
 * Tracking detection and scoring system
 */
export class TrackingDetector {
    constructor() {
        this.domainStats = new Map(); // domain -> { sites: Set, requests: number, score: number }
        this.siteVisits = new Map(); // site -> timestamp
        this.blockedDomains = new Set();
        this.allowedDomains = new Set();
        this.isInitialized = false;
    }

    /**
     * Initialize the tracking detector
     */
    async initialize() {
        if (this.isInitialized) return;

        try {
            // Load existing tracking data from storage
            await this.loadTrackingData();
            
            // Setup request monitoring
            this.setupRequestMonitoring();
            
            // Setup periodic cleanup
            this.setupPeriodicCleanup();
            
            this.isInitialized = true;
            backgroundLogger.info('Tracking detector initialized');
        } catch (error) {
            backgroundLogger.error('Failed to initialize tracking detector', { error: error.message });
            throw error;
        }
    }

    /**
     * Setup request monitoring using webRequest API
     */
    setupRequestMonitoring() {
        // Monitor all network requests
        if (chrome.webRequest && chrome.webRequest.onBeforeRequest) {
            chrome.webRequest.onBeforeRequest.addListener(
                (details) => {
                    // Run analysis in try-catch to prevent blocking requests
                    try {
                        this.analyzeRequest(details);
                    } catch (error) {
                        console.error('[TrackingDetector] Analysis failed:', error);
                    }
                },
                { urls: ['<all_urls>'] },
                []
            );

            // Monitor request headers for additional tracking indicators
            chrome.webRequest.onBeforeSendHeaders.addListener(
                (details) => {
                    try {
                        this.analyzeRequestHeaders(details);
                    } catch (error) {
                        console.error('[TrackingDetector] Header analysis failed:', error);
                    }
                },
                { urls: ['<all_urls>'] },
                ['requestHeaders']
            );

            console.log('[TrackingDetector] WebRequest monitoring setup complete');
        } else {
            console.error('[TrackingDetector] WebRequest API not available');
        }
    }

    /**
     * Analyze a network request for tracking behavior
     */
    async analyzeRequest(details) {
        try {
            const requestUrl = details.url;
            const requestDomain = getDomainFromUrl(requestUrl);
            const initiatorDomain = getDomainFromUrl(details.initiator || details.documentUrl);

            // DEBUG: Log all requests for heise.de
            if (initiatorDomain === 'heise.de' || requestDomain === 'heise.de') {
                console.log('[TRACKING DEBUG] Request from/to heise.de:', {
                    requestUrl,
                    requestDomain,
                    initiatorDomain,
                    isBlocked: this.blockedDomains.has(requestDomain),
                    isAllowed: this.allowedDomains.has(requestDomain)
                });
            }

            // Skip invalid domains or same-domain requests
            if (!requestDomain || !initiatorDomain || requestDomain === initiatorDomain) {
                return;
            }

            // If this is a blocked domain, count it in session stats
            if (this.blockedDomains.has(requestDomain)) {
                console.log('[TRACKING DEBUG] Blocked domain request:', {
                    requestDomain,
                    initiatorDomain,
                    updating: 'session stats'
                });
                await this.updateSessionStatsForRequest(initiatorDomain, requestDomain);
                return;
            }

            // Skip explicitly allowed domains
            if (this.allowedDomains.has(requestDomain)) {
                return;
            }

            // Update domain statistics
            await this.updateDomainStats(requestDomain, initiatorDomain, requestUrl, details);

            // Check if domain should be blocked
            const shouldBlock = await this.shouldBlockDomain(requestDomain);
            if (shouldBlock) {
                console.log('[TRACKING DEBUG] Blocking new tracker:', {
                    requestDomain,
                    initiatorDomain,
                    reason: 'shouldBlock=true'
                });
                await this.blockTrackingDomain(requestDomain);
            }

        } catch (error) {
            backgroundLogger.error('Error analyzing request', { 
                url: details.url, 
                error: error.message 
            });
        }
    }

    /**
     * Update session stats for a blocked request
     */
    async updateSessionStatsForRequest(initiatorDomain, blockedDomain) {
        try {
            if (typeof chrome !== 'undefined' && chrome.runtime) {
                chrome.runtime.sendMessage({
                    command: 'updateSessionStats',
                    site: initiatorDomain,
                    blockedTracker: blockedDomain
                }).catch(() => {
                    // Background script might not be ready
                });
            }
        } catch (error) {
            backgroundLogger.warn('Failed to update session stats for request', { 
                initiator: initiatorDomain,
                blocked: blockedDomain,
                error: error.message 
            });
        }
    }

    /**
     * Analyze request headers for tracking indicators
     */
    analyzeRequestHeaders(details) {
        const headers = details.requestHeaders || [];
        const requestDomain = getDomainFromUrl(details.url);
        
        if (!requestDomain) return;

        // Check for tracking-related headers
        const trackingIndicators = [
            'x-requested-with',
            'x-forwarded-for',
            'dnt', // Do Not Track
            'sec-fetch-dest',
            'sec-fetch-mode',
            'sec-fetch-site'
        ];

        const hasTrackingHeaders = headers.some(header => 
            trackingIndicators.includes(header.name.toLowerCase())
        );

        if (hasTrackingHeaders) {
            // Increase tracking score for domains with suspicious headers
            this.incrementTrackingScore(requestDomain, TRACKING_CONFIG.SCORE_INCREMENTS.SUSPICIOUS_HEADERS);
        }
    }

    /**
     * Update statistics for a domain
     */
    async updateDomainStats(requestDomain, initiatorDomain, requestUrl, details) {
        if (!this.domainStats.has(requestDomain)) {
            this.domainStats.set(requestDomain, {
                sites: new Set(),
                requests: 0,
                score: 0,
                firstSeen: Date.now(),
                lastSeen: Date.now(),
                requestTypes: new Map(),
                trackingIndicators: new Set()
            });
        }

        const stats = this.domainStats.get(requestDomain);
        
        // Update basic stats
        stats.sites.add(initiatorDomain);
        stats.requests++;
        stats.lastSeen = Date.now();

        // Track request types
        const resourceType = details.type || 'unknown';
        stats.requestTypes.set(resourceType, (stats.requestTypes.get(resourceType) || 0) + 1);

        // Analyze for tracking patterns
        this.analyzeTrackingPatterns(requestDomain, requestUrl, stats, details);

        // Calculate dynamic score
        stats.score = this.calculateTrackingScore(stats);

        // Save updated stats periodically
        if (stats.requests % TRACKING_CONFIG.SAVE_INTERVAL === 0) {
            await this.saveTrackingData();
        }
    }

    /**
     * Analyze request for tracking patterns
     */
    analyzeTrackingPatterns(domain, url, stats, details) {
        const urlLower = url.toLowerCase();
        
        // Check for common tracking URL patterns
        const trackingPatterns = [
            /analytics/i,
            /tracking/i,
            /metrics/i,
            /beacon/i,
            /pixel/i,
            /collect/i,
            /log/i,
            /event/i,
            /impression/i,
            /click/i,
            /conversion/i,
            /affiliate/i,
            /partner/i,
            /retargeting/i,
            /remarketing/i
        ];

        const matchedPatterns = trackingPatterns.filter(pattern => pattern.test(urlLower));
        
        if (matchedPatterns.length > 0) {
            stats.trackingIndicators.add('url_pattern');
            this.incrementTrackingScore(domain, TRACKING_CONFIG.SCORE_INCREMENTS.URL_PATTERN * matchedPatterns.length);
        }

        // Check for tracking query parameters
        const trackingParams = [
            'utm_', 'gclid', 'fbclid', 'msclkid', 'twclid',
            'ref', 'source', 'medium', 'campaign',
            'aff_', 'affiliate', 'partner',
            'click_id', 'impression_id'
        ];

        const hasTrackingParams = trackingParams.some(param => urlLower.includes(param));
        if (hasTrackingParams) {
            stats.trackingIndicators.add('tracking_params');
            this.incrementTrackingScore(domain, TRACKING_CONFIG.SCORE_INCREMENTS.TRACKING_PARAMS);
        }

        // Check for suspicious resource types
        const suspiciousTypes = ['beacon', 'ping', 'xmlhttprequest'];
        if (suspiciousTypes.includes(details.type)) {
            stats.trackingIndicators.add('suspicious_type');
            this.incrementTrackingScore(domain, TRACKING_CONFIG.SCORE_INCREMENTS.SUSPICIOUS_TYPE);
        }

        // Check for cross-site requests (main tracking indicator)
        if (stats.sites.size >= TRACKING_CONFIG.THRESHOLDS.MIN_SITES_FOR_TRACKING) {
            stats.trackingIndicators.add('cross_site');
            this.incrementTrackingScore(domain, TRACKING_CONFIG.SCORE_INCREMENTS.CROSS_SITE);
        }
    }

    /**
     * Calculate tracking score for a domain
     */
    calculateTrackingScore(stats) {
        let score = 0;

        // Base score from cross-site presence
        const sitesCount = stats.sites.size;
        if (sitesCount >= TRACKING_CONFIG.THRESHOLDS.MIN_SITES_FOR_TRACKING) {
            score += Math.min(sitesCount * TRACKING_CONFIG.SCORE_INCREMENTS.CROSS_SITE, 100);
        }

        // Frequency score
        const requestsScore = Math.min(stats.requests * 0.1, 20);
        score += requestsScore;

        // Tracking indicators bonus
        score += stats.trackingIndicators.size * TRACKING_CONFIG.SCORE_INCREMENTS.INDICATOR_BONUS;

        // Time-based decay (older entries get lower scores)
        const daysSinceLastSeen = (Date.now() - stats.lastSeen) / (1000 * 60 * 60 * 24);
        if (daysSinceLastSeen > 7) {
            score *= Math.max(0.1, 1 - (daysSinceLastSeen / 30));
        }

        return Math.min(score, 100);
    }

    /**
     * Increment tracking score for a domain
     */
    incrementTrackingScore(domain, increment) {
        if (this.domainStats.has(domain)) {
            const stats = this.domainStats.get(domain);
            stats.score = Math.min(stats.score + increment, 100);
        }
    }

    /**
     * Check if a domain should be blocked
     */
    async shouldBlockDomain(domain) {
        const stats = this.domainStats.get(domain);
        if (!stats) return false;

        // Check if domain meets blocking criteria
        const hasEnoughSites = stats.sites.size >= TRACKING_CONFIG.THRESHOLDS.MIN_SITES_FOR_BLOCKING;
        const hasHighScore = stats.score >= TRACKING_CONFIG.THRESHOLDS.BLOCKING_SCORE;
        const hasTrackingIndicators = stats.trackingIndicators.size >= 2;

        return hasEnoughSites && (hasHighScore || hasTrackingIndicators);
    }

    /**
     * Block a tracking domain
     */
    async blockTrackingDomain(domain) {
        if (this.blockedDomains.has(domain)) return;

        this.blockedDomains.add(domain);
        
        backgroundLogger.info('Automatically blocked tracking domain', { 
            domain, 
            sites: this.domainStats.get(domain)?.sites.size,
            score: this.domainStats.get(domain)?.score
        });

        // Update session stats for all sites that have been affected by this tracker
        await this.updateSessionStatsForBlockedDomain(domain);

        // Trigger dynamic rules update
        await this.updateBlockingRules();
        
        // Save to storage
        await this.saveTrackingData();
    }

    /**
     * Update session statistics when a domain is blocked
     */
    async updateSessionStatsForBlockedDomain(blockedDomain) {
        try {
            const stats = this.domainStats.get(blockedDomain);
            if (!stats || !stats.sites) return;

            backgroundLogger.info('Updating session stats for newly blocked domain', {
                domain: blockedDomain,
                sites: Array.from(stats.sites),
                requests: stats.requests
            });

            // Update session stats for each site this tracker was present on
            // Count all previous requests to this tracker as blocked
            for (const site of stats.sites) {
                const requestCount = stats.requests || 1;
                
                for (let i = 0; i < requestCount; i++) {
                    if (typeof chrome !== 'undefined' && chrome.runtime) {
                        // Send message to background script to update session stats
                        chrome.runtime.sendMessage({
                            command: 'updateSessionStats',
                            site: site,
                            blockedTracker: blockedDomain
                        }).catch(() => {
                            // Background script might not be ready
                        });
                    }
                }
            }
        } catch (error) {
            backgroundLogger.warn('Failed to update session stats for blocked domain', { 
                domain: blockedDomain, 
                error: error.message 
            });
        }
    }

    /**
     * Allow a domain (user override)
     */
    async allowTrackingDomain(domain) {
        this.blockedDomains.delete(domain);
        this.allowedDomains.add(domain);
        
        await this.updateBlockingRules();
        await this.saveTrackingData();
        
        backgroundLogger.info('User allowed tracking domain', { domain });
    }

    /**
     * Get tracking statistics for a domain
     */
    getDomainStats(domain) {
        const stats = this.domainStats.get(domain);
        if (!stats) return null;

        return {
            domain,
            sites: Array.from(stats.sites),
            sitesCount: stats.sites.size,
            requests: stats.requests,
            score: Math.round(stats.score),
            isBlocked: this.blockedDomains.has(domain),
            isAllowed: this.allowedDomains.has(domain),
            trackingIndicators: Array.from(stats.trackingIndicators),
            firstSeen: stats.firstSeen,
            lastSeen: stats.lastSeen
        };
    }

    /**
     * Get all blocked tracking domains
     */
    getBlockedDomains() {
        return Array.from(this.blockedDomains);
    }

    /**
     * Update blocking rules based on detected trackers
     */
    async updateBlockingRules() {
        // This will be implemented to integrate with the existing dynamic rules system
        // For now, we'll emit an event that the background script can listen to
        if (typeof chrome !== 'undefined' && chrome.runtime) {
            chrome.runtime.sendMessage({
                command: 'updateTrackingRules',
                blockedDomains: Array.from(this.blockedDomains)
            }).catch(() => {
                // Background script might not be ready
            });
        }
    }

    /**
     * Load tracking data from storage
     */
    async loadTrackingData() {
        try {
            const result = await chrome.storage.local.get([
                'trackingDomainStats',
                'blockedTrackingDomains',
                'allowedTrackingDomains'
            ]);

            // Load domain statistics
            if (result.trackingDomainStats) {
                Object.entries(result.trackingDomainStats).forEach(([domain, stats]) => {
                    this.domainStats.set(domain, {
                        ...stats,
                        sites: new Set(stats.sites || []),
                        requestTypes: new Map(Object.entries(stats.requestTypes || {})),
                        trackingIndicators: new Set(stats.trackingIndicators || [])
                    });
                });
            }

            // Load blocked domains
            if (result.blockedTrackingDomains) {
                this.blockedDomains = new Set(result.blockedTrackingDomains);
            }

            // Load allowed domains
            if (result.allowedTrackingDomains) {
                this.allowedDomains = new Set(result.allowedTrackingDomains);
            }

            backgroundLogger.info('Tracking data loaded', {
                domains: this.domainStats.size,
                blocked: this.blockedDomains.size,
                allowed: this.allowedDomains.size
            });

        } catch (error) {
            backgroundLogger.error('Failed to load tracking data', { error: error.message });
        }
    }

    /**
     * Save tracking data to storage
     */
    async saveTrackingData() {
        try {
            // Convert domain stats to serializable format
            const statsObj = {};
            this.domainStats.forEach((stats, domain) => {
                statsObj[domain] = {
                    ...stats,
                    sites: Array.from(stats.sites),
                    requestTypes: Object.fromEntries(stats.requestTypes),
                    trackingIndicators: Array.from(stats.trackingIndicators)
                };
            });

            await chrome.storage.local.set({
                trackingDomainStats: statsObj,
                blockedTrackingDomains: Array.from(this.blockedDomains),
                allowedTrackingDomains: Array.from(this.allowedDomains)
            });

        } catch (error) {
            backgroundLogger.error('Failed to save tracking data', { error: error.message });
        }
    }

    /**
     * Setup periodic cleanup of old data
     */
    setupPeriodicCleanup() {
        setInterval(() => {
            this.cleanupOldData();
        }, TRACKING_CONFIG.CLEANUP_INTERVAL);
    }

    /**
     * Clean up old tracking data
     */
    cleanupOldData() {
        const now = Date.now();
        const maxAge = TRACKING_CONFIG.MAX_DATA_AGE;
        let cleaned = 0;

        for (const [domain, stats] of this.domainStats) {
            if (now - stats.lastSeen > maxAge) {
                this.domainStats.delete(domain);
                cleaned++;
            }
        }

        if (cleaned > 0) {
            backgroundLogger.info('Cleaned up old tracking data', { cleaned });
            this.saveTrackingData();
        }
    }
}

// Export singleton instance
export const trackingDetector = new TrackingDetector();
