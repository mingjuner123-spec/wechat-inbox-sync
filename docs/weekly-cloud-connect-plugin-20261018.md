# Weekly cloud connect plugin implementation

## Scope

This candidate updates the Obsidian plugin only. It does not deploy the sync API, upload a plugin package, or read real account settings.

## Connection ticket

- `CNT-XXXX-XXXX-XXXX` is normalized and recognized before the legacy binding path.
- CNT uses an unauthenticated ticket request to `POST /connection/consume` with `purpose: obsidian_bind`, the stable plugin `clientId`, plugin version, and platform.
- The plugin accepts the backend's `credentialType: bind_code` response and the earlier `binding_token` label for compatibility, then saves the returned binding token into the existing `bindings` collection.
- Existing long binding codes still use `POST /bind`. Existing `pendingBindCode`, bindings, and entitlement fields are preserved when a CNT connection succeeds.
- A missing or old server route is reported as a temporary connection-service issue, so an existing binding is not marked invalid.

## Cloud fallback

- The setting is `cloudFallbackEnabled`, defaulting to `false`. The settings panel explains that an explicitly enabled fallback can send the original Douyin link or a controlled CloudBase `fileID` to cloud processing; Cookie and request headers are never sent.
- A Douyin source is submitted only after the existing direct and logged-in media candidates have all failed, including expired or forbidden media URLs and local ASR failure. The fallback submits the original Douyin URL when no controlled upload is available; no-speech and user cancellation stay out of the paid path. A local ASR failure uses the new job API with a controlled `fileID` when the retained media upload succeeds.
- When the plugin has already downloaded a candidate but local ASR fails, it first converts the retained temporary media to MP3, calls `/media/prepare`, uploads the raw bytes with the returned signed `PUT` metadata, and calls `/media/complete`. The resulting owned `cloud://` file ID is then submitted as `sourceType: uploaded_file`. If preparation, upload, or completion fails, the candidate is cleaned up and the original Douyin URL remains the only new job source. The upload is bounded at 100 MB, cancellable, and never sends cookies, request headers, or an arbitrary candidate URL to the backend.
- The upload submission intent is persisted before the job `POST`. If the response is lost, restart/retry reuses the same binding scope, record retry generation, `clientRequestId`, and uploaded file ID; it does not switch to the original URL under the same idempotency key.
- New jobs use `POST /transcriptions/fallback/jobs`, are polled with `GET /transcriptions/fallback/jobs/:id`, and can be explicitly cancelled with `POST /transcriptions/fallback/jobs/:id/cancel`.
- Job state is persisted in `cloudFallbackJobs`. Jobs carry a binding fingerprint, client ID, source fingerprint, and the mini-program record retry generation so a different binding/client or an older retry cannot consume a saved job. Worker retry attempts remain a separate field. Pending jobs survive restart; terminal history is bounded while pending jobs are retained.
- A retryable `failed` job remains pollable. Cancellation keeps a local `cancelled` record; the next normal sync skips that terminal state, and an explicit retry must advance the record retry count, pass a new client request ID, or set the retry option. No-speech stays outside the paid fallback submission path.
- A completed job is transformed into the normal record metadata and passed through the existing note writer. It uses the stored transcript directly, which avoids downloading an expired Douyin media URL again. If the lifecycle lease temporarily hides the server row, the persisted local snapshot resumes the same claim before completion. A pending job is skipped without reporting a sync failure; it is not reported as a successful note.

## Operator media node

- The operator node is opt-in and starts only when the process environment contains `WECHAT_INBOX_OPERATOR_NODE_ENABLED=1`, a separate `WECHAT_INBOX_OPERATOR_NODE_ID`, and `WECHAT_INBOX_OPERATOR_NODE_TOKEN`. Ordinary plugin users do not see or configure this capability; the token is not written to `data.json` or shared plugin assets.
- A media job first resolves the original Douyin URL through the plugin's own Electron Douyin session and existing candidate resolution, then downloads candidates one by one. It never downloads the share page as if it were media and never uploads Cookie data. A downloaded media file is converted and uploaded through the worker `media/prepare` → signed raw `PUT` → `media/complete` protocol; the final endpoint atomically moves the job into ASR and is not followed by a generic `media_ready` completion.
- An ASR job downloads the backend's controlled media URL, checks the actual byte count and SHA-256 against the leased artifact metadata, and invokes the existing local ASR wrapper in an operator-only context. Operator work uses its own temporary files and does not write the operator's sync records or vault notes. While a normal foreground local ASR run is active, `local_asr` is removed from the node's advertised capabilities and a race is released as retryable work.
- Capacity heartbeats run independently of the current job heartbeat so the worker TTL and runtime capability set remain live during long media downloads or ASR. Job heartbeat stages remain `acquiring` for media and `transcribing` for ASR; heartbeat stops before completion. Closing the plugin releases active work as a retryable failure so another node can claim it. `STALE_HEARTBEAT` is ignored, while an actual lease loss stops the current job. Operator API responses are capped and require HTTPS, except for an explicitly injected loopback test transport.
- Foreground and operator local ASR calls claim one synchronous mutex before component setup awaits. A foreground run removes `local_asr` from capacity advertisements, and a race is released as retryable work without sharing the foreground record, progress, recovery session, or vault write path.

## Local validation

- `node tests/plugin-connection-ticket.test.js`
- `node tests/plugin-cloud-fallback-jobs.test.js` (helper checks plus real plugin prototype method checks for connection, job submission, polling, retryable failure, and cancellation)
- `node tests/plugin-main-ai.test.js`
- `node tests/plugin-cloud-transcription-response-utils.test.js`
- `node tests/plugin-douyin-note-transcription.test.js`
- `node tests/plugin-no-speech.test.js`
- `node tests/plugin-processing-cancellation.test.js`
- `node tests/plugin-record-state-utils.test.js`
- `node --check obsidian-plugin/wechat-inbox-sync/src/main.js`
- `npm run build` and `npm run check` in `obsidian-plugin/wechat-inbox-sync`

`tests/plugin-upload-sync.test.js` was not present in this isolated worktree, so it was not run.

## Remaining verification

The backend routes and worker/provider behavior still require the parent agent's separate server tests and deployment decision. This candidate has not exercised a real CloudBase environment, paid transcription provider, or device account.
