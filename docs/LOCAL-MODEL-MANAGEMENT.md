# Local model management — 2026-11-17

The Local Deployment page now separates installed-model management from the existing recommended downloads. Installed entries show the exact tag, referenced-file size, parameter/quantization metadata when available and loaded/VRAM state. Users can add a model to analysis, unload it, open its directory or confirm deletion inline by name.

## Storage and ownership

- Read manifests and referenced file lengths under this installation's `data/local-ai/models`, including non-catalog tags. Weight files are never read to calculate sizes. Total bytes deduplicate shared digests; incomplete manifests remain visible but cannot be added to analysis.
- Skip reparse points, invalid digests, oversized manifests and malformed data. Status errors remain visible instead of removing the stored models.
- Model deletion uses the local Ollama delete endpoint, with exact named confirmation and membership in the scanned inventory. Do not manually remove shared model blobs. Unload a loaded selected model before deleting its tag.
- Only a service owned by this host is allowed to mutate models. An external service occupying port 11435 is rejected. Downloads and model mutations share a semaphore.
- Native local inference requests are tracked through the fetch bridge. Management cannot run during an active local request, and new inference cannot begin during management. UI disables destructive actions while local analysis is reported active.
- Successful deletion removes the model only from the managed local provider. Existing cloud providers, scripts and saved recommendations are not changed.

## Validation and limits

- 144 related local-model, Qwen, DeepSeek, targeted JSON and music-readiness regression tests passed.
- Native fixture tests cover offline/custom inventory, shared-file sizes, incomplete and malformed manifests, exact confirmation, foreign-service refusal, download/inference interlocks, unload requests, API deletion failures and preservation of other models' shared files.
- Renderer tests cover buttons, disabled states, named confirmation, cancellation, failed operations and local-provider cleanup.
- Read-only inventory on this computer identified DeepSeek R1 7B (4,683,076,297 bytes) and Qwen 3.5 4B (3,324,173,934 bytes); shared-file total was 8,007,250,231 bytes.
- A separately compiled native app/profile was used to inspect the management layout and deletion/cancel interaction. That profile used tiny synthetic files, not the user's models. No live model was deleted or unloaded and no paid API calls were made.

Prepared update and backups: `E:\XM兼容测试\本地模型管理-20261117`. Existing DS JSON, catalog-readiness and watermark fixes must remain in the payload. Version stays 1.6.3; no publication or fork changes are part of this task.
