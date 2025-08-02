/**
 * @file trackingConfig.js
 * @description Configuration for tracking detection system
 * @version 1.0.0
 */

export const TRACKING_CONFIG = Object.freeze({
    // Thresholds for tracking detection (lowered for faster detection)
    THRESHOLDS: {
        MIN_SITES_FOR_TRACKING: 1,    // Minimum sites a domain must appear on to be considered tracking
        MIN_SITES_FOR_BLOCKING: 2,    // Minimum sites for automatic blocking  
        BLOCKING_SCORE: 30,            // Score threshold for automatic blocking
        SUSPICIOUS_SCORE: 20,          // Score threshold for marking as suspicious
        LOW_RISK_SCORE: 10             // Score threshold for low risk domains
    },

    // Score increments for different tracking indicators
    SCORE_INCREMENTS: {
        CROSS_SITE: 10,                // Per additional site the domain appears on
        URL_PATTERN: 8,                // For tracking-related URL patterns
        TRACKING_PARAMS: 6,            // For tracking parameters in URLs
        SUSPICIOUS_TYPE: 5,            // For suspicious resource types
        SUSPICIOUS_HEADERS: 4,         // For tracking-related headers
        INDICATOR_BONUS: 3             // Bonus per unique tracking indicator
    },

    // Data management
    SAVE_INTERVAL: 10,                 // Save data every N requests per domain
    CLEANUP_INTERVAL: 6 * 60 * 60 * 1000, // Cleanup every 6 hours (ms)
    MAX_DATA_AGE: 30 * 24 * 60 * 60 * 1000, // Keep data for 30 days (ms)

    // Performance limits
    MAX_DOMAINS: 10000,                // Maximum domains to track
    MAX_SITES_PER_DOMAIN: 1000,       // Maximum sites per domain to track

    // Known tracking categories
    TRACKING_CATEGORIES: {
        ANALYTICS: [
            'google-analytics.com',
            'googletagmanager.com',
            'adobe.com',
            'omniture.com',
            'quantserve.com',
            'comscore.com',
            'chartbeat.com',
            'newrelic.com'
        ],
        ADVERTISING: [
            'doubleclick.net',
            'googlesyndication.com',
            'amazon-adsystem.com',
            'facebook.com',
            'adsystem.amazon.com',
            'criteo.com',
            'outbrain.com',
            'taboola.com'
        ],
        SOCIAL: [
            'facebook.net',
            'twitter.com',
            'linkedin.com',
            'pinterest.com',
            'instagram.com',
            'tiktok.com'
        ],
        CDN: [
            'cloudflare.com',
            'akamai.net',
            'fastly.com',
            'amazonaws.com',
            'azure.com',
            'googleapis.com'
        ]
    },

    // Whitelist of domains that should never be blocked
    WHITELIST: [
        // Essential infrastructure
        'cloudflare.com',
        'akamai.net',
        'fastly.com',
        'amazonaws.com',
        'googleusercontent.com',
        'gstatic.com',
        
        // Essential functionality
        'recaptcha.net',
        'googleapis.com',
        'jquery.com',
        'bootstrap.com',
        
        // Payment providers
        'paypal.com',
        'stripe.com',
        'square.com'
    ],

    // URL patterns that indicate tracking behavior
    TRACKING_URL_PATTERNS: [
        // Analytics
        /\/analytics?\//i,
        /\/ga[?\/]/i,
        /\/gtm[?\/]/i,
        /\/(universal[-_])?analytics/i,
        
        // Tracking pixels
        /\/pixel\./i,
        /\/beacon[?\/]/i,
        /\/track[?\/]/i,
        /\/collect[?\/]/i,
        
        // Events and conversions
        /\/event[?\/]/i,
        /\/conversion[?\/]/i,
        /\/impression[?\/]/i,
        /\/click[?\/]/i,
        
        // Affiliate tracking
        /\/affiliate[?\/]/i,
        /\/partner[?\/]/i,
        /\/referral[?\/]/i,
        
        // Remarketing
        /\/retarget/i,
        /\/remarket/i,
        /\/audience[?\/]/i
    ],

    // Tracking parameter patterns
    TRACKING_PARAM_PATTERNS: [
        // Google Analytics
        /utm_[a-z]+/i,
        /ga_[a-z]+/i,
        /gclid/i,
        
        // Facebook
        /fbclid/i,
        /fb_[a-z]+/i,
        
        // Microsoft/Bing
        /msclkid/i,
        /ms_[a-z]+/i,
        
        // Twitter
        /twclid/i,
        /tw_[a-z]+/i,
        
        // Generic tracking
        /click_?id/i,
        /impression_?id/i,
        /campaign_?id/i,
        /source_?id/i,
        /affiliate_?id/i,
        /partner_?id/i,
        /ref_?id/i
    ],

    // Request headers that may indicate tracking
    TRACKING_HEADERS: [
        'x-requested-with',
        'x-forwarded-for',
        'x-real-ip',
        'x-client-ip',
        'x-originating-ip',
        'cf-connecting-ip',
        'true-client-ip',
        'dnt',
        'sec-fetch-dest',
        'sec-fetch-mode',
        'sec-fetch-site',
        'sec-fetch-user'
    ],

    // Resource types that are commonly used for tracking
    TRACKING_RESOURCE_TYPES: [
        'beacon',
        'ping',
        'xmlhttprequest',
        'image', // tracking pixels
        'script' // analytics scripts
    ],

    // Settings for different blocking modes
    BLOCKING_MODES: {
        STRICT: {
            name: 'Strikt',
            description: 'Blockiert aggressiv alle erkannten Tracker',
            thresholds: {
                MIN_SITES_FOR_BLOCKING: 3,
                BLOCKING_SCORE: 60
            }
        },
        BALANCED: {
            name: 'Ausgewogen',
            description: 'Standardmodus - blockiert eindeutige Tracker',
            thresholds: {
                MIN_SITES_FOR_BLOCKING: 5,
                BLOCKING_SCORE: 75
            }
        },
        PERMISSIVE: {
            name: 'Tolerant',
            description: 'Blockiert nur offensichtliche Tracker',
            thresholds: {
                MIN_SITES_FOR_BLOCKING: 8,
                BLOCKING_SCORE: 85
            }
        }
    }
});

export default TRACKING_CONFIG;
