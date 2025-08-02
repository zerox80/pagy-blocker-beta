#!/usr/bin/env node
/**
 * @file setup-dev.js
 * @description Entwickler-Setup Script für Pagy Blocker
 * @version 7.1.0
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

console.log('🚀 Pagy Blocker - Entwickler Setup');
console.log('=====================================\n');

// Check Node.js version
const nodeVersion = process.version;
const requiredVersion = 'v14.0.0';
console.log(`📋 Node.js Version: ${nodeVersion}`);

if (nodeVersion < requiredVersion) {
    console.error(`❌ Node.js ${requiredVersion} oder höher erforderlich`);
    process.exit(1);
}

// Check if npm dependencies are installed
console.log('\n📦 Überprüfe Dependencies...');
try {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
    
    if (!existsSync('node_modules')) {
        console.log('📥 Installiere Dependencies...');
        execSync('npm install', { stdio: 'inherit' });
    } else {
        console.log('✅ Dependencies bereits installiert');
    }
} catch (error) {
    console.error('❌ Fehler beim Installieren der Dependencies:', error.message);
    process.exit(1);
}

// Build filter lists
console.log('\n⚙️ Kompiliere Filter-Listen...');
try {
    execSync('npm run precompile', { stdio: 'inherit' });
    console.log('✅ Filter-Listen erfolgreich kompiliert');
} catch (error) {
    console.error('❌ Fehler beim Kompilieren der Filter-Listen:', error.message);
    process.exit(1);
}

// Run linting
console.log('\n🔍 Führe Code-Validierung durch...');
try {
    execSync('npm run lint', { stdio: 'inherit' });
    console.log('✅ Code-Validierung erfolgreich');
} catch (error) {
    console.warn('⚠️ Code-Validierung mit Warnungen abgeschlossen');
}

// Create development configuration
console.log('\n🛠️ Erstelle Entwickler-Konfiguration...');
const devConfig = {
    development: true,
    logLevel: 3, // Debug
    enablePerformanceMonitoring: true,
    autoUpdateFilters: false,
    showSessionStats: true,
    protectionLevel: 'standard'
};

try {
    writeFileSync('.dev-config.json', JSON.stringify(devConfig, null, 2));
    console.log('✅ Entwickler-Konfiguration erstellt');
} catch (error) {
    console.warn('⚠️ Entwickler-Konfiguration konnte nicht erstellt werden');
}

// Display next steps
console.log('\n🎉 Setup erfolgreich abgeschlossen!');
console.log('\n📋 Nächste Schritte:');
console.log('1. Öffne Chrome und gehe zu chrome://extensions/');
console.log('2. Aktiviere den "Entwicklermodus" (oben rechts)');
console.log('3. Klicke auf "Entpackte Erweiterung laden"');
console.log('4. Wähle diesen Ordner aus');
console.log('\n🔧 Entwickler-Befehle:');
console.log('• npm run dev     - Entwicklungsbuild');
console.log('• npm run test    - Tests ausführen');
console.log('• npm run lint    - Code prüfen');
console.log('• npm run format  - Code formatieren');
console.log('• npm run release - Release-Build');

console.log('\n🐛 Debug-Tipps:');
console.log('• Öffne chrome://extensions/ und klicke auf "Hintergrundseite"');
console.log('• Verwende F12 Entwicklertools im Popup');
console.log('• Prüfe die Konsole auf Fehlermeldungen');
console.log('• Log-Level in den Einstellungen erhöhen');

console.log('\n📚 Dokumentation:');
console.log('• README.md - Projekt-Übersicht');
console.log('• CONTRIBUTING.md - Mitwirken');
console.log('• CODE_OF_CONDUCT.md - Verhaltenskodex');

console.log('\n✨ Viel Erfolg beim Entwickeln!');
