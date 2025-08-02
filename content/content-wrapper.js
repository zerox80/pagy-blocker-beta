/**
 * @file content-wrapper.js
 * @description Content Script Wrapper mit Live-Tracker-Monitoring
 * @version 7.1.0
 */

(async () => {
    try {
        // 1. Lade Live-Tracker-Monitor (sofort für maximale Abdeckung)
        await import(chrome.runtime.getURL('content/live-tracker-monitor.js'));
        console.log('[PAGY] Live-Tracker-Monitor geladen');
        
        // 2. Lade Standard Content Script
        await import(chrome.runtime.getURL('content/content.js'));
        console.log('[PAGY] Content Script geladen');
        
    } catch (error) {
        console.error('[PAGY] Fehler beim Laden der Content Scripts:', error);
    }
})();
