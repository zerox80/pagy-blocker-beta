/**
 * @file core/config.js
 * @description Centralized configuration for Pagy Blocker
 * @version 7.1.0
 */

// Extension configuration
export const EXTENSION_CONFIG = Object.freeze({
    NAME: 'Pagy Blocker',
    VERSION: '7.1.0',
    STORAGE_KEYS: {
        DISABLED_DOMAINS: 'disabledDomains',
        USER_SETTINGS: 'userSettings',
        FILTER_CACHE: 'filterCache'
    },
    LIMITS: {
        MAX_DYNAMIC_RULES: 100,
        MAX_DOMAIN_LENGTH: 253,
        MAX_LABEL_LENGTH: 63,
        MAX_URL_LENGTH: 500,
        MAX_RULES_COUNT: 30000,
        VALIDATION_TIMEOUT_MS: 10000
    },
    PRIORITIES: {
        DEFAULT_RULE: 100,
        ALLOW_RULE: 200,
        IMPORTANT_RULE: 1000
    },
    ICONS: {
        DEFAULT: '/icons/icon128.png',
        DISABLED: '/icons/deaktivieren.png'
    },
    PERFORMANCE: {
        BATCH_SIZE: 200,
        MAX_CONCURRENT_BATCHES: 4,
        DEBOUNCE_DELAY: 300,
        CACHE_TTL: 3600000 // 1 hour
    }
});

// Logging configuration
export const LOG_CONFIG = Object.freeze({
    LEVELS: {
        ERROR: 0,
        WARN: 1,
        INFO: 2,
        DEBUG: 3
    },
    DEFAULT_LEVEL: 1, // WARN
    PREFIX: '[Pagy Blocker]'
});

// Validation patterns
export const VALIDATION_PATTERNS = Object.freeze({
    DOMAIN_CHARS: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-',
    URL_CHARS: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-_~:/?#[]@!$&'()*+,;=%",
    WILDCARD_CHARS: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-*/'
});

// Rule types and actions
export const RULE_CONFIG = Object.freeze({
    TYPES: {
        NETWORK: 'network',
        COMMENT: 'comment',
        INVALID: 'invalid'
    },
    ACTIONS: {
        BLOCK: 'block',
        ALLOW: 'allow',
        REDIRECT: 'redirect',
        UPGRADE_SCHEME: 'upgradeScheme',
        MODIFY_HEADERS: 'modifyHeaders'
    },
    RESOURCE_TYPES: [
        'main_frame',
        'sub_frame',
        'stylesheet',
        'script',
        'image',
        'font',
        'object',
        'xmlhttprequest',
        'ping',
        'csp_report',
        'media',
        'websocket',
        'webtransport',
        'webbundle',
        'other'
    ]
});

export default EXTENSION_CONFIG;
