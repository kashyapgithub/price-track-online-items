/**
 * settings.js
 * ----------------------------------------------------------------------------
 * User-configurable notification preferences. Split out from storage.js so
 * "how prices are stored" and "how/when the user gets pinged" stay in
 * separate files — the popup's settings panel only ever needs this one.
 */

const SETTINGS_KEY = "settings";

const DEFAULT_SETTINGS = {
  notificationsEnabled: true,
  minDropPercent: 1, // ignore drops smaller than this (filters out noise)
  quietHoursEnabled: false,
  quietHoursStart: 22, // 24h clock, local time
  quietHoursEnd: 8,
};

export async function getSettings() {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(result[SETTINGS_KEY] || {}) };
}

export async function setSettings(partial) {
  const current = await getSettings();
  const merged = { ...current, ...partial };
  await chrome.storage.local.set({ [SETTINGS_KEY]: merged });
  return merged;
}

/** True if `hour` (0-23, local time) falls inside the configured quiet-hours window. Handles overnight ranges (e.g. 22 -> 8). */
export function isWithinQuietHours(settings, hour = new Date().getHours()) {
  if (!settings.quietHoursEnabled) return false;
  const { quietHoursStart: start, quietHoursEnd: end } = settings;
  if (start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}
