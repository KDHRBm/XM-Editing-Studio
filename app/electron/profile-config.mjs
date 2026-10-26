import { existsSync } from 'node:fs';
import path from 'node:path';

// Keep the original origin: renderer settings and history live in origin-scoped storage.
export const APP_PORT = 37651;

export function resolveUserDataDirectory(appData, override = '', exists = existsSync) {
  if (override) return path.resolve(override);
  const current = path.join(appData, 'xiaoma-editing-studio');
  const legacy = path.join(appData, '黑曜信号台');
  if (exists(current)) return current;
  if (exists(legacy)) return legacy;
  return current;
}
