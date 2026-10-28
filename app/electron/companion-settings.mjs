import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_COMPANION_SETTINGS = {
  palette: 'original', size: 'normal', motion: true, roam: false,
  sound: false, volume: 40, idleInterval: 30,
};

export function normalizeCompanionSettings(value = {}) {
  const input = value && typeof value === 'object' ? value : {};
  return {
    palette: ['mono', 'original'].includes(input.palette) ? input.palette : DEFAULT_COMPANION_SETTINGS.palette,
    size: ['small', 'normal', 'large'].includes(input.size) ? input.size : DEFAULT_COMPANION_SETTINGS.size,
    motion: typeof input.motion === 'boolean' ? input.motion : DEFAULT_COMPANION_SETTINGS.motion,
    roam: typeof input.roam === 'boolean' ? input.roam : DEFAULT_COMPANION_SETTINGS.roam,
    sound: typeof input.sound === 'boolean' ? input.sound : DEFAULT_COMPANION_SETTINGS.sound,
    volume: Number.isFinite(input.volume) ? Math.max(0, Math.min(100, Math.round(input.volume))) : DEFAULT_COMPANION_SETTINGS.volume,
    idleInterval: Number.isFinite(input.idleInterval) ? Math.max(10, Math.min(90, Math.round(input.idleInterval))) : DEFAULT_COMPANION_SETTINGS.idleInterval,
  };
}

export function createCompanionSettingsStore(settingsFile) {
  let settings = { ...DEFAULT_COMPANION_SETTINGS }, loaded, pending = Promise.resolve();
  async function load() {
    if (!loaded) loaded = readFile(settingsFile, 'utf8')
      .then(text => { settings = normalizeCompanionSettings(JSON.parse(text)); })
      .catch(() => {});
    await loaded;
    return { ...settings };
  }
  function update(patch) {
    if (!patch || typeof patch !== 'object' || !Object.keys(patch).every(key => key in DEFAULT_COMPANION_SETTINGS)) {
      throw new Error('无效的桌宠设置。');
    }
    const result = pending.catch(() => {}).then(async () => {
      await load();
      const next = normalizeCompanionSettings({ ...settings, ...patch });
      await mkdir(path.dirname(settingsFile), { recursive: true });
      await writeFile(`${settingsFile}.tmp`, JSON.stringify(next));
      await rename(`${settingsFile}.tmp`, settingsFile);
      settings = next;
      return { ...settings };
    });
    pending = result;
    return result;
  }
  return { load, update };
}
