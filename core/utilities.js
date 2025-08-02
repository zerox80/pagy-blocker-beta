/**
 * @file core/utilities.js
 * @description Centralized utility functions for Pagy Blocker
 * @version 7.1.0
 */

import { EXTENSION_CONFIG, VALIDATION_PATTERNS } from './config.js';
import { createLogger } from './logger.js';

const logger = createLogger('Utilities');

/**
 * Extract domain from URL
 */
export function getDomainFromUrl(url) {
    // Enhanced version with better validation and normalization
    if (typeof url !== 'string') {
        return null;
    }

    const cleanUrl = url.trim();
    if (!cleanUrl) {
        return null;
    }

    // Add protocol if missing to help URL parser
    let normalized = cleanUrl;
    if (!/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(normalized)) {
        normalized = `http://${normalized}`;
    }

    try {
        const { hostname } = new URL(normalized);
        // Normalize hostname: lowercase & remove trailing dot
        const cleanHost = hostname.replace(/\.$/, '').toLowerCase();
        return cleanHost || null;
    } catch (error) {
        return null;
    }
}

// Alias for backward compatibility with core/utils.js
export function getDomainFromURL(url) {
    return getDomainFromUrl(url);
}

/**
 * Normalize domain for consistent storage/retrieval
 */
export function normalizeDomain(domain) {
    if (!domain || typeof domain !== 'string') return null;
    
    let normalized = domain.toLowerCase();
    
    // Remove www. prefix
    if (normalized.startsWith('www.')) {
        normalized = normalized.substring(4);
    }
    
    // Remove trailing dots
    normalized = normalized.replace(/\.$/, '');
    
    return normalized;
}

/**
 * Validates domain using safe character checking
 */
export function isValidDomain(domain) {
    if (!domain || typeof domain !== 'string') {
        return false;
    }

    // Basic length check
    if (domain.length > EXTENSION_CONFIG.LIMITS.MAX_DOMAIN_LENGTH || domain.length < 1) {
        return false;
    }

    // Must contain at least one dot
    if (!domain.includes('.')) {
        return false;
    }

    // Split into labels and validate each
    const labels = domain.split('.');
    
    // Must have at least 2 labels (e.g., "example.com")
    if (labels.length < 2) {
        return false;
    }

    return labels.every(label => {
        if (!label || label.length > EXTENSION_CONFIG.LIMITS.MAX_LABEL_LENGTH) {
            return false;
        }
        
        // Character validation using allowlist
        for (let i = 0; i < label.length; i++) {
            if (!VALIDATION_PATTERNS.DOMAIN_CHARS.includes(label[i])) {
                return false;
            }
        }
        
        return true;
    });
}

/**
 * Validates string against allowed character set (ReDoS-safe)
 */
export function validateStringChars(input, allowedChars, maxLength = EXTENSION_CONFIG.LIMITS.MAX_URL_LENGTH) {
    if (!input || typeof input !== 'string') {
        return { isValid: false, error: 'Input must be a non-empty string' };
    }

    if (input.length > maxLength) {
        return { isValid: false, error: `Input exceeds maximum length (${maxLength})` };
    }

    for (let i = 0; i < input.length; i++) {
        if (!allowedChars.includes(input[i])) {
            return { isValid: false, error: `Invalid character at position ${i}: ${input[i]}` };
        }
    }

    return { isValid: true };
}

/**
 * Debounce function for performance optimization
 */
export function debounce(func, delay = EXTENSION_CONFIG.PERFORMANCE.DEBOUNCE_DELAY) {
    let timeoutId;
    return function (...args) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => func.apply(this, args), delay);
    };
}

/**
 * Throttle function for rate limiting
 */
export function throttle(func, limit) {
    let inThrottle;
    return function (...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

/**
 * Safe JSON parsing with error handling
 */
export function safeJsonParse(jsonString, fallback = null) {
    try {
        return JSON.parse(jsonString);
    } catch (error) {
        logger.warn('JSON parsing failed', { jsonString, error: error.message });
        return fallback;
    }
}

/**
 * Deep clone object safely
 */
export function deepClone(obj) {
    if (obj === null || typeof obj !== 'object') {
        return obj;
    }
    
    if (obj instanceof Date) {
        return new Date(obj.getTime());
    }
    
    if (Array.isArray(obj)) {
        return obj.map(item => deepClone(item));
    }
    
    const cloned = {};
    for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
            cloned[key] = deepClone(obj[key]);
        }
    }
    
    return cloned;
}

/**
 * Retry mechanism for async operations
 */
export async function retryAsync(fn, maxRetries = 3, delay = 1000) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            if (attempt === maxRetries) {
                throw error;
            }
            
            logger.debug(`Retry attempt ${attempt} failed`, { error: error.message });
            await new Promise(resolve => setTimeout(resolve, delay * attempt));
        }
    }
}

/**
 * Performance timing utility
 */
export class PerformanceTimer {
    constructor(label) {
        this.label = label;
        this.startTime = performance.now();
    }

    end() {
        const duration = performance.now() - this.startTime;
        logger.debug(`Performance: ${this.label}`, { duration: `${duration.toFixed(2)}ms` });
        return duration;
    }
}

/**
 * Memory usage monitoring
 */
export function getMemoryUsage() {
    if (typeof performance !== 'undefined' && performance.memory) {
        return {
            used: Math.round(performance.memory.usedJSHeapSize / 1024 / 1024),
            total: Math.round(performance.memory.totalJSHeapSize / 1024 / 1024),
            limit: Math.round(performance.memory.jsHeapSizeLimit / 1024 / 1024)
        };
    }
    return null;
}

/**
 * Sanitize user input to prevent XSS
 */
export function sanitizeInput(input) {
    if (typeof input !== 'string') {
        return '';
    }
    
    return input
        .replace(/[<>'"&]/g, char => {
            switch (char) {
                case '<': return '&lt;';
                case '>': return '&gt;';
                case '"': return '&quot;';
                case "'": return '&#x27;';
                case '&': return '&amp;';
                default: return char;
            }
        })
        .trim()
        .slice(0, 1000); // Limit length
}

/**
 * Generate unique ID
 */
export function generateId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Check if extension context is valid
 */
export function isExtensionContextValid() {
    try {
        return chrome?.runtime?.id !== undefined;
    } catch (error) {
        return false;
    }
}

/**
 * Batch process array with concurrency control
 */
export async function batchProcess(items, processor, batchSize = EXTENSION_CONFIG.PERFORMANCE.BATCH_SIZE) {
    const results = [];
    
    for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        const batchResults = await Promise.all(batch.map(processor));
        results.push(...batchResults);
        
        // Yield control to prevent blocking
        if (i + batchSize < items.length) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }
    
    return results;
}

export default {
    getDomainFromUrl,
    normalizeDomain,
    isValidDomain,
    validateStringChars,
    debounce,
    throttle,
    safeJsonParse,
    deepClone,
    retryAsync,
    PerformanceTimer,
    getMemoryUsage,
    sanitizeInput,
    generateId,
    isExtensionContextValid,
    batchProcess
};
