# DeepSeek Flash echoed evidence JSON repair — 2026-11-17

## Failure and scope

The locally captured fifth music-selection response stopped normally (`finish_reason: stop`) but copied input evidence into its output. Seventeen evidence entries contained a bare numeric line followed by an extra quote, such as `{"line":72", "text":"..."}`. The old object scanner consequently lost quote boundaries and rejected all eight segments across episodes 12–14. Earlier episodes had valid recommendations; later groups were never requested.

The original response and task backup remain private under `E:\XM兼容测试\DS原始JSON修复-20261117`. No real script text or file mapping is included in the repository.

## Parser change

- Before scanning object boundaries, use a quote-aware pass that removes a stray closing quote only after a bare nonnegative integer in a `line` property, with a following comma or object close.
- Keep quoted numeric strings and all string contents unchanged. Do not repair identifiers, music references, `evidenceLine` values, decimals, negatives, or absent delimiters.
- Existing truncation and multiple-object checks still apply. Normal selection validation uses the original candidate catalog and original script evidence, never model-echoed evidence.
- An eligible repaired group continues the normal queue without a repeat API request. Actual request failures still stop and preserve prior results.

## Prompt optimization contract

Target: debug the targeted API selection system prompt for the configured DeepSeek Flash model; no snapshot inferred. The official website workflow is out of scope.

Success: one compact `episodes` object using only episode IDs, segment IDs, matches and optional no-match explanation. Every match includes a candidate reference, integer evidence line and concise Chinese reason. Keep all music suitability, directory preference and neighboring-episode deduplication rules.

Loaded context: `app/shared/targeted-batch-music.mjs`, `app/shared/targeted-json.mjs`, `tests/test-deepseek-targeted.mjs`, `tests/test-targeted-json.mjs`. External model documentation is not needed for this captured syntax defect.

Candidates considered:

1. Minimal output-key allowlist and an explicit distinction between evidence inputs and result fields — adopted to preserve the existing recommendation logic.
2. Full instruction/schema restructuring — deferred; no evidence that a larger rewrite improves live output and no authorization to make paid evaluation requests.

The adopted instruction enumerates allowed keys at each level, keeps evidence/candidates/summary/ranges as input-only context and requires an unquoted integer `evidenceLine`. It adds no requests, examples containing user data or retries. Offline fixtures verify code behavior; they cannot establish live model compliance or quality.

## Validation

- The captured 8,266-character response parses after exactly 17 quote removals. All other values match an independent correction of the captured data: three episodes, eight segments, 24 raw recommendations.
- Synthetic three-episode 3/2/3-segment replay retains all 24 valid selections. A later repaired group continues all 20 episodes while preserving earlier selections.
- Forged echoed evidence, unknown references, quoted selection evidence and neighboring duplicates remain rejected. Truncation, multiple answers, escaped JSON text and normal JSON remain covered.
- 196 related tests passed. Zero paid API calls were made.

The historical response does not store the exact request's reference-to-track mapping. Parsing its 24 raw selections is not equivalent to recovering 24 playable recommendations. Nothing is imported by guessing filenames or mapping `M` references against today's catalog. Existing task results are untouched; missing music can be supplemented after installing the fix.

Deployment contains only the rebuilt native bridge and its updated manifest. Preserve the previously installed catalog readiness, DS segment boundary and watermark fixes. No fork modification or GitHub publication.
