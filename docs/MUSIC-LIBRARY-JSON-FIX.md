# Music catalog synchronization and targeted JSON handling — 2026-11-17

## Observed failures

- The native host scanned music folders in the background at startup but `music-library-list` immediately returned its empty initial catalog. React read that snapshot once and received no completion event. Batch analysis could therefore receive zero tracks even though saved UNC directories existed.
- A later paid selection returned `finish_reason: stop` with 6,425 output characters, but strict `JSON.parse` rejected it. The old selection catch did not preserve that answer, so its exact syntax defect cannot be reconstructed. This was not reported as a length-limit termination.
- Selection failures were labeled `no-match` and displayed as completed analysis with no suitable music.

## Changes

- Native startup, list and concurrent refresh callers share an awaited scan. Completed scans notify both local views. Saved folder configurations are retained even when a root is inaccessible.
- Both analysis pages subscribe to catalog updates. Late initial responses cannot overwrite a newer refresh. Refresh remains available when a previously displayed catalog is empty.
- Batch and workspace analyses acquire a ready catalog immediately before their request; unreadable configured roots block submission with a useful error rather than silently requesting music from an empty/partial library.
- Targeted API selection uses at most eight segments and an approximately 24,000-character payload per group. JSON mode and disabled thinking are retained. Official webpage recommendation logic is unchanged.
- A bounded parser accepts complete fenced/prose-wrapped JSON, a single extra JSON encoding, trailing delimiters and raw control characters within strings. It does not supply missing brackets, fields, tracks, quotes or evidence. Multiple/truncated objects are rejected. Normal episode, candidate, evidence, reason and neighboring-episode deduplication checks still apply.
- Invalid selection is displayed as incomplete, including older saved JSON-error records. Earlier valid recommendations survive a later failed group. One copy of the failed selection response is kept in the affected local result for diagnosis.
- Single-episode cards offer “仅补缺失音乐”, using existing planning and validated selections. No automatic paid retry or migration of historical results is performed.

## Validation

- 190 related tests passed: DeepSeek, targeted identity and JSON, native music readiness, catalog subscriptions, batch queue, Gemini and official-web regressions.
- Compiled C# host and both browser bundles. Baseline renderer files matched the E-drive installation before rebuilding.
- Isolated native/WebView2 run against the two saved UNC roots found 3,259 tracks. Refresh delivered one completion event and the subsequent list returned the same revision. Zero paid AI requests were made.
- Original screenshot's 3,250 analysis candidates were after exclusions; raw scanned count is 3,259.
- All 153 staged program files passed manifest verification. Prior DS boundary and watermark fixes are preserved.

Private task backups, logs, the staged build and installation backup are under `E:\XM兼容测试\音乐库与JSON修复-20261117`; they must not be committed or published. Live provider output is not certified by offline/mock validation.
