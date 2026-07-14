# Engineering decisions

## 2026-07-15: Xiaohongshu comments use browser-network data as the canonical source

- Signed comment responses captured from the logged-in browser are authoritative. Responses are replayed in request order before cursor/stop-state aggregation.
- DOM and static HTML comments are fallback sources only. Cross-source duplicates are identified by normalized author and content even when displayed times differ.
- Replies must stay under their root comment. API replies require a matching root ID; DOM `回复 用户` rows attach only when the parent author resolves uniquely. Unmatched replies are counted in diagnostics instead of being promoted to main comments.
- Pagination scrolls the real comment-list container, waits for network/DOM progress, and stops on API exhaustion, repeated idle rounds, or the bounded safety limit.
- Final diagnostics retain root/reply/page, fallback, duplicate, unmatched, invalid-payload, scrolling, and stop-reason counters so future platform changes can be diagnosed from a user report.

Reason:

- Xiaohongshu loads main comments and folded replies asynchronously. Treating whichever source arrives first as final caused ten-comment truncation, duplicated comments, and replies flattened into roots.
- DOM text alone does not carry stable root IDs, so ambiguous folded replies cannot be assigned safely without inventing hierarchy.
