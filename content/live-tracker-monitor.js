/**
 * @file live-tracker-monitor.js
 * @description Echtzeit-Tracker-Überwachung für automatische Erkennung
 * @version 7.1.0
 */

class LiveTrackerMonitor {
    constructor() {
        this.currentDomain = this.getDomainFromUrl(window.location.href);
        this.detectedTrackers = new Set();
        this.requestCount = 0;
        this.setupMonitoring();
    }

    getDomainFromUrl(url) {
        try {
            return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
        } catch {
            return null;
        }
    }

    setupMonitoring() {
        // 1. Überwache fetch() API
        this.interceptFetch();
        
        // 2. Überwache XMLHttpRequest
        this.interceptXHR();
        
        // 3. Überwache DOM-Änderungen (neue Scripts, Bilder, etc.)
        this.observeDOM();
        
        // 4. Überwache Navigator.sendBeacon (Tracking-Beacon)
        this.interceptBeacon();
        
        console.log('[PAGY] Live-Tracker-Monitor aktiviert für:', this.currentDomain);
    }

    interceptFetch() {
        const originalFetch = window.fetch;
        window.fetch = (...args) => {
            this.analyzeRequest(args[0], 'fetch');
            return originalFetch.apply(window, args);
        };
    }

    interceptXHR() {
        const originalOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function(method, url, ...args) {
            this._pagy_url = url;
            return originalOpen.apply(this, [method, url, ...args]);
        };

        const originalSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.send = function(...args) {
            if (this._pagy_url) {
                window.pagyTrackerMonitor?.analyzeRequest(this._pagy_url, 'xhr');
            }
            return originalSend.apply(this, args);
        };
    }

    interceptBeacon() {
        if (navigator.sendBeacon) {
            const originalBeacon = navigator.sendBeacon;
            navigator.sendBeacon = (url, data) => {
                this.analyzeRequest(url, 'beacon');
                return originalBeacon.call(navigator, url, data);
            };
        }
    }

    observeDOM() {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === 1) { // ELEMENT_NODE
                        this.checkElement(node);
                    }
                });
            });
        });

        observer.observe(document.documentElement, {
            childList: true,
            subtree: true
        });
    }

    checkElement(element) {
        // Scripts
        if (element.tagName === 'SCRIPT' && element.src) {
            this.analyzeRequest(element.src, 'script');
        }
        
        // Tracking-Pixel (1x1 Images)
        if (element.tagName === 'IMG' && element.src) {
            this.analyzeRequest(element.src, 'image');
        }
        
        // iFrames
        if (element.tagName === 'IFRAME' && element.src) {
            this.analyzeRequest(element.src, 'iframe');
        }

        // Suche in Kindelementen
        element.querySelectorAll?.('script[src], img[src], iframe[src]').forEach(child => {
            this.analyzeRequest(child.src, child.tagName.toLowerCase());
        });
    }

    analyzeRequest(url, type) {
        try {
            if (!url || typeof url !== 'string') return;

            const requestDomain = this.getDomainFromUrl(url);
            if (!requestDomain || requestDomain === this.currentDomain) return;

            this.requestCount++;

            // Sofortige Tracker-Erkennung
            const isTracker = this.isTrackerRequest(url, requestDomain, type);
            
            if (isTracker) {
                this.detectedTrackers.add(requestDomain);
                
                // Sofort an Background Script senden
                this.reportTracker(url, requestDomain, type);
                
                console.log(`[PAGY] 🚫 TRACKER ERKANNT: ${requestDomain} (${type})`);
            }

        } catch (error) {
            console.warn('[PAGY] Fehler bei Request-Analyse:', error);
        }
    }

    isTrackerRequest(url, domain, type) {
        const urlLower = url.toLowerCase();
        
        // 1. Bekannte Tracker-Domains (O(1) Set-Lookup)
        const knownTrackers = new Set([
            'google-analytics.com', 'googletagmanager.com', 'doubleclick.net',
            'googlesyndication.com', 'facebook.com', 'facebook.net',
            'amazon-adsystem.com', 'criteo.com', 'outbrain.com', 'taboola.com',
            'twitter.com', 'linkedin.com', 'pinterest.com', 'instagram.com',
            'quantserve.com', 'comscore.com', 'chartbeat.com', 'newrelic.com',
            'adobe.com', 'omniture.com', 'adsystem.amazon.com', 'adnxs.com',
            'adsrvr.org', 'adform.net', 'pubmatic.com', 'rubiconproject.com'
        ]);

        // Exakte Domain-Überprüfung
        if (knownTrackers.has(domain)) return true;
        
        // Subdomain-Überprüfung
        for (const tracker of knownTrackers) {
            if (domain.endsWith('.' + tracker) || domain.includes(tracker)) {
                return true;
            }
        }

        // 2. URL-Pattern-Erkennung (hochperformant)
        const trackingPatterns = [
            'analytics', 'tracking', 'metrics', 'beacon', 'pixel', 
            'collect', 'event', 'impression', 'click', 'conversion',
            'affiliate', 'partner', 'retarget', 'remarket'
        ];

        if (trackingPatterns.some(pattern => urlLower.includes(pattern))) {
            return true;
        }

        // 3. Tracking-Parameter
        const trackingParams = ['utm_', 'gclid', 'fbclid', 'msclkid', 'ref=', 'source='];
        if (trackingParams.some(param => urlLower.includes(param))) {
            return true;
        }

        // 4. Verdächtige Bilder (1x1 Pixel)
        if (type === 'image' && (urlLower.includes('1x1') || urlLower.includes('pixel'))) {
            return true;
        }

        // 5. Analytics-Scripts
        if (type === 'script' && /analytic|track|metric|tag|pixel/i.test(urlLower)) {
            return true;
        }

        return false;
    }

    reportTracker(url, domain, type) {
        try {
            chrome.runtime.sendMessage({
                command: 'liveTrackerDetected',
                data: {
                    url: url.substring(0, 200), // Begrenzte URL-Länge
                    domain: String(domain),
                    type: String(type),
                    initiator: String(this.currentDomain || 'unknown'),
                    timestamp: Date.now()
                }
            }).catch(() => {
                // Extension könnte nicht bereit sein - ignorieren
            });
        } catch (error) {
            console.warn('[PAGY] Fehler beim Melden des Trackers:', error);
        }
    }

    getStats() {
        return {
            domain: this.currentDomain,
            requestCount: this.requestCount,
            detectedTrackers: Array.from(this.detectedTrackers),
            trackerCount: this.detectedTrackers.size
        };
    }
}

// Sofort initialisieren
if (typeof window !== 'undefined') {
    window.pagyTrackerMonitor = new LiveTrackerMonitor();
    
    // Debug-Interface
    window.pagyGetStats = () => window.pagyTrackerMonitor.getStats();
    
    // Test-Funktion
    window.pagyTestTracker = () => {
        console.log('[PAGY] Teste Tracker-Erkennung...');
        window.pagyTrackerMonitor.analyzeRequest('https://google-analytics.com/collect', 'script');
        window.pagyTrackerMonitor.analyzeRequest('https://facebook.com/tr', 'image');
        console.log('[PAGY] Test abgeschlossen:', window.pagyTrackerMonitor.getStats());
    };
}
