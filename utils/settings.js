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
