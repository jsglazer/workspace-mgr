// Shared i18n helpers, ported verbatim from the reference plugin's i18n.js.
// The per-language dictionaries under ./locales import these; keeping them in
// one module avoids duplicating the plural/platform logic across languages.

// Russian plural helper (3 forms: one, few, many).
export function ruPlural(n: number, one: string, few: string, many: string): string {
    const mod100 = Math.abs(n) % 100;
    const mod10 = mod100 % 10;
    if (mod100 >= 11 && mod100 <= 14) return many;
    if (mod10 === 1) return one;
    if (mod10 >= 2 && mod10 <= 4) return few;
    return many;
}

// Arabic plural helper (singular for 1/11+, dual for 2, plural for 3-10).
export function arPlural(n: number, one: string, two: string, few: string, many: string): string {
    if (n === 1) return one;
    if (n === 2) return two;
    if (n <= 10) return n + ' ' + few;
    return n + ' ' + many;
}

export function isMacPlatform(): boolean {
    return typeof navigator !== 'undefined'
        && typeof navigator.platform === 'string'
        && navigator.platform.indexOf('Mac') !== -1;
}

export function platformLabel(macText: string, otherText: string): () => string {
    return function () {
        return isMacPlatform() ? macText : otherText;
    };
}

export function modifiedClickLabel(baseText: string, macKey: string, otherKey: string): () => string {
    return function () {
        return (isMacPlatform() ? macKey : otherKey) + ' + ' + baseText;
    };
}
