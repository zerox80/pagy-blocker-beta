/**
 * @file filter_precompiler.js
 * @description Kompiliert Filterlisten in das JSON-Format für die declarativeNetRequest API.
 * @version 4.0.0
 * @author Gemini
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { parseRule, RULE_TYPES } from './core/ruleParser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const INPUT_FILE = path.join(__dirname, 'filter_lists', 'filter_optimized.txt');
const OUTPUT_DIR = path.join(__dirname, 'filter_lists');
const OUTPUT_NETWORK_RULES = path.join(OUTPUT_DIR, 'filter_precompiled.json');

export async function precompileFilters() {
    console.log('Starte Filter-Präkompilierung...');

    try {
        const fileExists = await fs
            .stat(INPUT_FILE)
            .then(() => true)
            .catch(() => false);
        if (!fileExists) {
            console.error(`FEHLER: Eingabedatei nicht gefunden: ${INPUT_FILE}`);
            await fs.writeFile(INPUT_FILE, `! Beispiel-Filterliste\n||doubleclick.net^`, 'utf-8');
            console.log(`Eine Beispieldatei wurde unter ${INPUT_FILE} erstellt.`);
            return;
        }

        // Sicherstellen, dass das Ausgabe-Verzeichnis existiert
        await fs.mkdir(OUTPUT_DIR, { recursive: true });

        const lines = (await fs.readFile(INPUT_FILE, 'utf-8')).split(/\r?\n/);
        const networkRules = [];

        let ruleId = 1;

        for (const line of lines) {
            const trimmedLine = line.trim();
            // Leere Zeilen und reine Kommentare überspringen
            if (!trimmedLine || trimmedLine.startsWith('!')) continue;

            const parsedRule = await parseRule(trimmedLine);

            if (!parsedRule) continue; // Ungültige oder irrelevante Regel

            if (parsedRule.type === RULE_TYPES.NETWORK) {
                networkRules.push({
                    id: ruleId++,
                    priority: 1, // Standardpriorität
                    action: { type: 'block' }, // Standardaktion
                    condition: {
                        urlFilter: parsedRule.pattern,
                        // Standard-Ressourcentypen, wenn keine angegeben sind
                        resourceTypes: (parsedRule.options && parsedRule.options.resourceTypes) || [
                            'main_frame',
                            'sub_frame',
                            'script',
                            'image',
                            'stylesheet',
                            'object',
                            'xmlhttprequest',
                            'ping',
                            'media',
                            'websocket',
                            'other',
                        ],
                    },
                });
            }
        }

        await fs.writeFile(OUTPUT_NETWORK_RULES, JSON.stringify(networkRules, null, 2), 'utf-8');
        console.log(`${networkRules.length} Netzwerkregeln geschrieben in ${OUTPUT_NETWORK_RULES}`);

        console.log('Filter-Präkompilierung erfolgreich abgeschlossen.');
    } catch (error) {
        console.error('FEHLER während der Filter-Präkompilierung:', error);
        process.exit(1);
    }
}

// Führt das Skript nur aus, wenn es direkt über Node aufgerufen wurde
// Führt das Skript nur aus, wenn es direkt über Node aufgerufen wurde
const isMainModule = import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
    precompileFilters();
}
