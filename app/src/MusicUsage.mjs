import { createMusicUsageStore } from '../shared/library-usage.mjs';

// One store across all scripts; clearing a script or its queue does not clear music usage.
export const musicUsage = createMusicUsageStore({
  getItem: key => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
});
