# Local runtime download-source detection — 2026-11-17

The reported message combined “运行环境下载源不可用：已取消一个任务” with a successful Qwen model-file check. The previous runtime check shared one 30-second cancellation source across GitHub release discovery and its asset HEAD/range requests. Any timeout became a generic unavailable error; the installer also used only the official asset URL and had no metadata timeout.

The exact original network interruption could not be reproduced. Official GitHub metadata and the official and mirror asset routes were reachable during this investigation.

## Behavior

- Official release metadata has its own 15-second deadline. The exact Ollama Windows asset URL, positive size and 64-digit SHA-256 must come from the official GitHub API. No mirror-supplied checksum is trusted.
- A file probe requests only bytes 0–3 and checks ZIP magic, response type and size/range headers. It reads at most four application bytes even if a server ignores Range, then disposes the response.
- Official and `gh-proxy.com` asset routes each have an independent eight-second probe deadline. Failure or timeout on one route allows the next route to run.
- Installation uses the same sources, a 15-second connection deadline and a 30-second idle deadline while streaming. A failed transfer or mismatched hash can fall back to the other source. Complete size and official SHA-256 must match before extraction or replacement.
- True user cancellation stops immediately, disposes stalled network reads and removes the incomplete archive. It never starts a fallback download.
- Source-check timeout is reported as inconclusive, not as user cancellation or proof the runtime is unusable. When the runtime already exists, the UI explains it need not be downloaded again. Diagnostic category/details are logged without signed download URLs.
- A model-source timeout also has a dedicated Chinese message. Existing Ollama proxy inheritance, inference, GPU selection and model storage are unchanged.

## Validation

`tests/NativeLocalRuntimeDownloadTests.cs` exercises 16 scenarios, including independent timeout budgets, range rejection/ignored Range, HTML responses, bad hashes, truncated transfers, uncooperative stalled streams, cancellation and rate limits. The deployment integration fixture verifies the installed-runtime timeout message and keeps existing runtime rollback/model-preservation checks.

Live checks used official release metadata and four-byte requests through both asset routes; they did not download or install the approximately 1.6 GB runtime or any model. An available source at test time is not a guarantee of subsequent network availability.

Local build/backup location: `E:\XM兼容测试\本地下载源修复-20261117`. Installed to `E:\小马剪辑台` after the user exited it; all 157 program hashes were verified. This fix is included in the user's requested revised 1.6.4 publication. Earlier 1.6.4 installations must apply the revised incremental manually because their updater compares version numbers only.
