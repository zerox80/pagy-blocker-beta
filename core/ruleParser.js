/**
 * @file core/ruleParser.js
 * @description Umfassender Regelparser mit erweiterter Syntaxvalidierung.
 * @version 5.0.0

 */

// Regeltyp-Konstanten
export const RULE_TYPES = {
    NETWORK: 'network',
    COMMENT: 'comment',
    INVALID: 'invalid',
};

// SICHERHEIT: ReDoS-sichere Mustervalidierung mit zeichenbasierter Analyse
const URL_PATTERN_VALIDATORS = {
    DOMAIN_CHARS: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-',
    URL_CHARS:
        "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-_~:/?#[]@!$&'()*+,;=%",
    WILDCARD_CHARS: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-*/',
};

/**
 * SICHERHEIT: Sichere Zeichenvalidierung ohne Regex zur Vermeidung von ReDoS-Angriffen.
 */
function validateStringChars(input, allowedChars, maxLength = 500) {
    if (!input || typeof input !== 'string') {
        return { success: false, error: 'Eingabe muss ein nicht leerer String sein' };
    }
    if (input.length > maxLength) {
        return { success: false, error: `Eingabe überschreitet die maximale Länge (${maxLength})` };
    }
    for (let i = 0; i < input.length; i++) {
        if (!allowedChars.includes(input[i])) {
            return { success: false, error: `Ungültiges Zeichen an Position ${i}: ${input[i]}` };
        }
    }
    return { success: true, result: true };
}

/**
 * SICHERHEIT: Sichere Domain-Validierung mit zeichenbasierter Analyse.
 */
function safeDomainValidation(domain) {
    if (!domain || typeof domain !== 'string') {
        return { success: false, error: 'Domain muss ein nicht leerer String sein' };
    }
    if (domain.length > 253) {
        return { success: false, error: 'Domain überschreitet die maximale Länge (253)' };
    }
    if (domain.includes('..') || domain.startsWith('.') || domain.endsWith('.')) {
        return { success: false, error: 'Ungültiges Domain-Format' };
    }
    const parts = domain.split('.');
    if (parts.length < 2) {
        return { success: false, error: 'Domain muss aus mindestens zwei Teilen bestehen' };
    }
    for (const part of parts) {
        if (part.length === 0 || part.length > 63) {
            return { success: false, error: 'Ungültige Länge des Domain-Teils' };
        }
        const validation = validateStringChars(part, URL_PATTERN_VALIDATORS.DOMAIN_CHARS, 63);
        if (!validation.success) {
            return validation;
        }
    }
    return { success: true, result: { domain } };
}

/**
 * SICHERHEIT: Sichere URL-Mustererkennung ohne komplexe Regex.
 */
function safeURLPatternMatch(pattern) {
    if (!pattern || typeof pattern !== 'string') {
        return { success: false, error: 'Muster muss ein nicht leerer String sein' };
    }
    if (pattern.length > 500) {
        return { success: false, error: 'Muster überschreitet die maximale Länge (500)' };
    }
    if (pattern.startsWith('||')) {
        const endCaret = pattern.endsWith('^');
        const domain = endCaret ? pattern.slice(2, -1) : pattern.slice(2);
        const domainValidation = safeDomainValidation(domain);
        if (!domainValidation.success) {
            return domainValidation;
        }
        return { success: true, result: [pattern, domain], type: 'domain_anchor' };
    }
    if (pattern.startsWith('|') && !pattern.startsWith('||')) {
        if (pattern.startsWith('|http://') || pattern.startsWith('|https://')) {
            const validation = validateStringChars(pattern, URL_PATTERN_VALIDATORS.URL_CHARS, 500);
            if (!validation.success) {
                return validation;
            }
            return { success: true, result: [pattern], type: 'url_anchor' };
        }
        return { success: false, error: 'Ungültiges URL-Anker-Muster' };
    }
    const validation = validateStringChars(pattern, URL_PATTERN_VALIDATORS.WILDCARD_CHARS, 100);
    if (!validation.success) {
        return validation;
    }
    return { success: true, result: [pattern], type: 'wildcard' };
}

/**
 * SICHERHEIT: Erkennt URL-codierte Angriffsvektoren.
 */
function isEncodedAttack(input) {
    const dangerousEncodedPatterns = [
        '%3c%73%63%72%69%70%74', // <script
        '%6a%61%76%61%73%63%72%69%70%74', // javascript
        '%65%76%61%6c', // eval
        '%61%6c%65%72%74', // alert
        '%64%6f%63%75%6d%65%6e%74', // document
        '%77%69%6e%64%6f%77', // window
        '%75%72%6c%28', // url(
        '%65%78%70%72%65%73%73%69%6f%6e', // expression
        '%6f%6e%6c%6f%61%64', // onload
        '%6f%6e%65%72%72%6f%72', // onerror
        '%3c%69%66%72%61%6d%65', // <iframe
        '%3c%6f%62%6a%65%63%74', // <object
        '%3c%65%6d%62%65%64', // <embed
    ];
    const lowerInput = input.toLowerCase();
    return dangerousEncodedPatterns.some((pattern) => lowerInput.includes(pattern));
}

// Filteroptions-Validierung
const VALID_OPTIONS = new Set([
    'script',
    'image',
    'stylesheet',
    'object',
    'xmlhttprequest',
    'subdocument',
    'document',
    'websocket',
    'webrtc',
    'popup',
    'third-party',
    'match-case',
    'donottrack',
    'important',
    'sitekey',
    'ping',
    'font',
    'media',
    'other',
]);

/**
 * Verbesserte Domain-Säuberung mit strengerer Validierung.
 */
async function sanitizeDomain(domain) {
    if (!domain || typeof domain !== 'string') {
        return { isValid: false, error: 'Domain muss ein nicht leerer String sein' };
    }
    const cleaned = domain
        .replace(/[<>'"(){}[\]\\]/g, '')
        .toLowerCase()
        .trim();
    if (
        cleaned.includes('..') ||
        cleaned.startsWith('.') ||
        cleaned.endsWith('.') ||
        cleaned.includes('localhost') ||
        cleaned.includes('127.0.0.1') ||
        cleaned.includes('0.0.0.0') ||
        cleaned.includes('::1')
    ) {
        return { isValid: false, error: 'Domain enthält verdächtige Muster' };
    }
    const testResult = safeDomainValidation(cleaned);
    if (!testResult.success) {
        return { isValid: false, error: testResult.error };
    }
    return { isValid: true, domain: cleaned };
}

/**
 * Verbesserte Validierung von URL-Filtermustern mit ReDoS-Schutz.
 */
export async function validateURLPattern(pattern) {
    if (!pattern || typeof pattern !== 'string') {
        return { isValid: false, error: 'Muster muss ein nicht leerer String sein' };
    }
    const dangerousPatterns = [
        '<script',
        '</script',
        'javascript:',
        'data:',
        'vbscript:',
        'file:',
        'ftp:',
        'eval(',
        'function(',
        'constructor(',
        'settimeout(',
        'setinterval(',
        'onclick=',
        'onload=',
        'onerror=',
        'onmouseover=',
        'onfocus=',
        'onblur=',
        'onchange=',
        'onsubmit=',
        'onkeydown=',
        'onkeyup=',
        'onkeypress=',
        'expression(',
        '@import',
        'url(',
        'background:url',
        'background-image:url',
        'import(',
        'require(',
        'importscripts(',
        '__import__',
        'fetch(',
        'xmlhttprequest',
        'websocket',
        'eventsource',
        'filesystem:',
        'blob:',
        'about:',
        '&#',
        '&lt;',
        '&gt;',
        '&quot;',
        '&apos;',
        'union select',
        'drop table',
        'delete from',
        'insert into',
        '$(',
        '`',
        'cmd.exe',
        '/bin/',
        'powershell',
        '{{',
        '}}',
        '<%',
        '%>',
        '{%',
        '%}',
        'amF2YXNjcmlwdA==',
        'ZXZhbA==',
        'c2NyaXB0',
    ];
    const lowerPattern = pattern.toLowerCase();
    for (const dangerous of dangerousPatterns) {
        if (lowerPattern.includes(dangerous.toLowerCase())) {
            return { isValid: false, error: `Muster enthält gefährlichen Inhalt: ${dangerous}` };
        }
    }
    const forbiddenChars = [
        '\0',
        '\x01',
        '\x02',
        '\x03',
        '\x04',
        '\x05',
        '\x06',
        '\x07',
        '\x08',
        '\x0b',
        '\x0c',
        '\x0e',
        '\x0f',
    ];
    for (const char of forbiddenChars) {
        if (pattern.includes(char)) {
            return { isValid: false, error: `Muster enthält verbotenes Steuerzeichen` };
        }
    }
    if (pattern.includes('%') && isEncodedAttack(pattern)) {
        return { isValid: false, error: 'Muster enthält codierten Angriffsvektor' };
    }
    if (pattern.length > 500) {
        return { isValid: false, error: 'Muster überschreitet die maximale Länge (500 Zeichen)' };
    }
    const patternResult = safeURLPatternMatch(pattern);
    if (!patternResult.success) {
        return { isValid: false, error: patternResult.error };
    }
    if (patternResult.type === 'domain_anchor') {
        const domainResult = await sanitizeDomain(patternResult.result[1]);
        if (!domainResult.isValid) {
            return { isValid: false, error: domainResult.error };
        }
        return { isValid: true, type: 'domain_anchor', domain: domainResult.domain };
    }
    return { isValid: true, type: patternResult.type };
}

/**
 * Validiert Filteroptionen (z.B. $script,third-party).
 */
export async function validateFilterOptions(options) {
    if (!options) {
        return { isValid: true, parsedOptions: [] };
    }
    const optionList = options.split(',').map((opt) => opt.trim().toLowerCase());
    const parsedOptions = [];
    const errors = [];
    for (const option of optionList) {
        const isNegated = option.startsWith('~');
        const baseOption = isNegated ? option.slice(1) : option;
        if (baseOption.startsWith('domain=')) {
            const domains = baseOption.slice(7).split('|');
            for (const domain of domains) {
                const cleanDomain = domain.startsWith('~') ? domain.slice(1) : domain;
                if (cleanDomain) {
                    const testResult = safeDomainValidation(cleanDomain);
                    if (!testResult.success) {
                        errors.push(
                            `Ungültige Domain in den Optionen: ${cleanDomain} - ${testResult.error}`
                        );
                    }
                }
            }
            parsedOptions.push({ type: 'domain', value: baseOption.slice(7), negated: isNegated });
        } else if (VALID_OPTIONS.has(baseOption)) {
            parsedOptions.push({ type: 'filter', value: baseOption, negated: isNegated });
        } else {
            errors.push(`Unbekannte Filteroption: ${baseOption}`);
        }
    }
    return {
        isValid: errors.length === 0,
        parsedOptions,
        errors,
    };
}

/**
 * Verbesserter Regelparser mit umfassender Validierung.
 */
export async function parseRule(rule) {
    if (!rule || typeof rule !== 'string') {
        return null;
    }
    const normalizedRule = rule.trim();
    if (normalizedRule.length === 0) {
        return null;
    }
    if (normalizedRule.startsWith('!') || normalizedRule.startsWith('[')) {
        return null;
    }
    // Kosmetische Filter werden nicht mehr unterstützt.
    if (
        normalizedRule.includes('##') ||
        normalizedRule.includes('#@#') ||
        normalizedRule.includes('#?#')
    ) {
        return null;
    }

    try {
        return await parseNetworkRule(normalizedRule);
    } catch (error) {

        return null;
    }
}

/**
 * Parst Regeln für die Netzwerkfilterung.
 */
async function parseNetworkRule(rule) {
    const isException = rule.startsWith('@@');
    const cleanRule = isException ? rule.slice(2) : rule;
    const dollarIndex = cleanRule.lastIndexOf('$');
    let pattern = cleanRule;
    let options = '';
    if (dollarIndex !== -1 && dollarIndex < cleanRule.length - 1) {
        pattern = cleanRule.slice(0, dollarIndex);
        options = cleanRule.slice(dollarIndex + 1);
    }
    const patternValidation = await validateURLPattern(pattern);
    if (!patternValidation.isValid) {
        return null;
    }
    let parsedOptions = null;
    if (options) {
        const optionsValidation = await validateFilterOptions(options);
        if (!optionsValidation.isValid) {
            return null;
        }
        parsedOptions = optionsValidation.parsedOptions;
    }
    return {
        rule: rule,
        type: RULE_TYPES.NETWORK,
        pattern: pattern,
        options: parsedOptions,
        isException: isException,
        patternType: patternValidation.type,
        isValid: true,
    };
}

/**
 * Validiert die Regelkonformität mit den Standards der Filterliste.
 */
export function validateRuleCompliance(rule) {
    const result = {
        isCompliant: false,
        issues: [],
        warnings: [],
    };
    if (!rule || typeof rule !== 'string') {
        result.issues.push('Regel muss ein nicht leerer String sein');
        return result;
    }
    const trimmedRule = rule.trim();
    if (trimmedRule.length === 0) {
        result.issues.push('Leere Regel');
        return result;
    }
    if (trimmedRule.length > 2000) {
        result.issues.push('Regel überschreitet die empfohlene maximale Länge (2000 Zeichen)');
    }
    if (trimmedRule.includes('\t')) {
        result.warnings.push('Regel enthält Tabulatorzeichen');
    }
    if (trimmedRule.includes('\n') || trimmedRule.includes('\r')) {
        result.issues.push('Regel enthält Zeilenumbruchzeichen');
    }
    if (trimmedRule.startsWith('@@')) {
        if (trimmedRule.length === 2) {
            result.issues.push('Ausnahmeregel ohne Muster');
        }
    }
    if (result.issues.length === 0) {
        result.isCompliant = true;
    }
    return result;
}

/**
 * LEISTUNGSOPTIMIERT: Verbesserte Regelverarbeitung mit paralleler Batch-Verarbeitung.
 */
export async function updateRules(rules) {
    if (!Array.isArray(rules)) {
        throw new Error('Regeln müssen als Array bereitgestellt werden');
    }
    const results = {
        parsed: [],
        errors: [],
        statistics: {
            total: rules.length,
            valid: 0,
            invalid: 0,
            network: 0,
            comments: 0,
        },
    };
    const BATCH_SIZE = 200;
    const MAX_CONCURRENT_BATCHES =
        typeof navigator !== 'undefined' ? Math.min(4, navigator.hardwareConcurrency || 2) : 2;
    for (
        let batchStart = 0;
        batchStart < rules.length;
        batchStart += BATCH_SIZE * MAX_CONCURRENT_BATCHES
    ) {
        const concurrentBatches = [];
        for (
            let c = 0;
            c < MAX_CONCURRENT_BATCHES && batchStart + c * BATCH_SIZE < rules.length;
            c++
        ) {
            const currentBatchStart = batchStart + c * BATCH_SIZE;
            const currentBatchEnd = Math.min(currentBatchStart + BATCH_SIZE, rules.length);
            const batch = rules.slice(currentBatchStart, currentBatchEnd);
            const batchPromise = processBatch(batch, currentBatchStart);
            concurrentBatches.push(batchPromise);
        }
        const batchResults = await Promise.all(concurrentBatches);
        for (const batchResult of batchResults) {
            results.parsed.push(...batchResult.parsed);
            results.errors.push(...batchResult.errors);
            results.statistics.valid += batchResult.statistics.valid;
            results.statistics.invalid += batchResult.statistics.invalid;
            results.statistics.network += batchResult.statistics.network;
            results.statistics.comments += batchResult.statistics.comments;
        }
        if (batchStart + BATCH_SIZE * MAX_CONCURRENT_BATCHES < rules.length) {
            await new Promise((resolve) => {
                if (typeof requestIdleCallback !== 'undefined') {
                    requestIdleCallback(resolve, { timeout: 5 });
                } else {
                    setTimeout(resolve, 1);
                }
            });
        }
    }
    return results;
}

/**
 * Verarbeitet ein Batch von Regeln asynchron.
 */
export async function processBatch(batch, offset) {
    const batchResults = {
        parsed: [],
        errors: [],
        statistics: {
            valid: 0,
            invalid: 0,
            network: 0,
            comments: 0,
        },
    };
    for (let i = 0; i < batch.length; i++) {
        const rule = batch[i];
        const globalIndex = offset + i;
        try {
            const compliance = validateRuleCompliance(rule);
            if (!compliance.isCompliant) {
                batchResults.errors.push({
                    line: globalIndex + 1,
                    rule: rule,
                    errors: compliance.issues,
                });
                batchResults.statistics.invalid++;
                continue;
            }
            const parsed = await parseRule(rule);
            if (parsed) {
                batchResults.parsed.push(parsed);
                batchResults.statistics.valid++;
                if (parsed.type === RULE_TYPES.NETWORK) {
                    batchResults.statistics.network++;
                }
            } else {
                batchResults.statistics.comments++;
            }
        } catch (error) {
            batchResults.errors.push({
                line: globalIndex + 1,
                rule: rule,
                errors: [`Parse-Fehler: ${error.message}`],
            });
            batchResults.statistics.invalid++;
        }
        if (i > 0 && i % 50 === 0) {
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
    }
    return batchResults;
}
