import * as i18n from '../i18n';

// Ported from the reference plugin's modals/format-relative-time.js.
export default function formatRelativeTime(timestamp: number): string {
    const L = i18n.L;
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (minutes < 1) return L.modifiedJustNow;
    if (minutes < 60) return L.modifiedMinutes(minutes);
    if (hours < 24) return L.modifiedHours(hours);
    return L.modifiedDays(days);
}
