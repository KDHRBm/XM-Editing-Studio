# DeepSeek API local experiment — 2026-11-13

This branch restores the local fast-analysis experiment after the public 1.6.2
local-model supplement. It is not a published release and is not installed over
the running application.

The experiment uses the official Flash API with thinking disabled. It retains
usage accounting, JSON/Markdown export, and an explicit operation that fills only
missing music recommendations using saved scene analysis.

Two production-shaped failures were reproduced before changes:

- Similar neighboring episodes selected the same shared candidate; validation
  removed the later selections. Candidate pools are now assigned before the joint
  request, with same-name aliases kept together and directory diversity preserved.
- A single invalid reference aborted all paid analysis. Invalid reference,
  evidence-line, or reason data now excludes only that recommendation while
  preserving scene boundaries and other accepted selections for supplementation.

The live local test returned 20 episodes and 61 scenes. Offline replay preserved
55 selections; one explicit supplement request filled the remaining six. All 61
track IDs/titles and scene boundaries were verified, with no neighboring-episode
conflicts and no changes to the 55 previously accepted reasons.

The two paid calls used 52,553 input and 6,666 output tokens, with no cache hits.
Combined API time was 36.874 seconds. Estimated peak-period cost was CNY 0.158434;
the balance endpoint did not confirm the ledger debit. Wall time including the
interactive repair was 269.315 seconds, so this is not an uninterrupted benchmark.
No second full-script paid request was made after the invalid response.

Validation: 424 tests passed with the native WebView2 test DLL environment set.
Live tests used an isolated in-memory analysis service through the running native
host. Existing projects, queue records, executable files and published artifacts
were not changed.

Follow-up: further reduce input or improve cache reuse, and test a fresh continuous
run only when needed. Do not describe this result as achieving CNY 0.05 or as an
audio-quality evaluation.

Workflow: use the user's find-skills workflow before subsequent code changes.
For this work, diagnosing-bugs from mattpocock/skills was selected and applied.
