# 08 — Live collaboration backend

**Status:** design proposal plus an implemented first slice. The room server and client
presence/edit bridge are in `server/collab`, `src/collab`, `api/collab/token.mjs`, and the App/Toolbar
integration. The GitHub autosave is still performed by the leader client through the existing save
path; server-side GitHub App publishing and the fuller Yjs/offline model remain future work.

**Goal:** several users can open the same GitHub-backed `.umler` project and edit it at the same
time, with no scene-level merge dialogs in the normal case, remote cursors, and a collaborator
list in the top bar. The collaboration server is a temporary cache; GitHub remains the durable
project store and receives frequent snapshots.

**Overlap rule:** when two confirmed actions target the same field, the action the room accepts
last wins; see §3.3. No merge dialog appears for same-field edits, and a focused input is never
rewritten under the user's cursor by an earlier remote confirmation.

---

## 1. Why the current merge model cannot be extended

Today the editor is a single-writer application:

- every edit is a pure `SceneDocument` function result, kept in React state;
- undo/redo stores whole-document snapshots;
- GitHub sync is a three-way scene merge between the last synced scene digests and the two full
  project files;
- the server is only used for OAuth.

That works for non-overlapping saves, but it cannot express concurrent intent. If two users move
different rows of the same table, both save whole scenes, and one save wins or the merge dialog
appears. A live session needs a shared document that merges at **field** (and ideally text)
granularity. The GitHub merge then becomes a last-resort reconciliation with edits made outside
the live session, not the normal collaboration path.

---

## 2. Recommended architecture

```text
                     ┌──────────────────────────────────────────────┐
 GitHub              │  Live collaboration room (temporary cache)   │
 ┌──────────────┐    │                                              │
 │ .umler file  │◄──►│  Yjs document + awareness + room metadata    │
 │ branch/path  │    │  last GitHub SHA + per-scene digests         │
 └──────────────┘    │  TTL: e.g. 4 h after last participant leaves │
        ▲            └───────────────┬──────────────────────────────┘
        │ Contents API              │ WebSocket (Yjs sync + awareness)
        │ (GitHub App token)        │
        │                    ┌──────┴──────┬─────────────┐
        │                    │ Browser A   │ Browser B   │ ...
        │                    │ Y.Doc +     │ Y.Doc +     │
        │                    │ y-indexeddb │ y-indexeddb │
        │                    └─────────────┴─────────────┘
        │
        └── Vercel API: GitHub login / permission check / short-lived collab JWT
```

### 2.1 CRDT: Yjs

Use **Yjs** for the shared project and **Yjs Awareness** for ephemeral presence.

Reasons:

- Mature provider ecosystem and a documented awareness protocol for names, colours, cursors and
  active scene.
- Compact binary updates and state-vector sync; Yjs is an efficient shared-state transport for
  late joiners and reconnect catch-up.
- Shared `Y.Map` and `Y.Array` types can model the existing JSON scene graph.
- Confirmed writes are ordered by the room (§3.3), so the design does not rely on Yjs's internal
  concurrent-map tie-break to decide a user-visible winner.
- Useful ecosystem servers exist (`Hocuspocus`, `y-durableobjects`, `y-partyserver`, `y-sweet`).
- Current benchmarks put Yjs among the fastest practical JS CRDTs and it has by far the largest
  production base; Automerge has richer history but is a heavier WASM model and slower for
  high-frequency structured updates.

Loro is a credible performance alternative, but its ecosystem and provider support are smaller.
Do not choose a CRDT only on benchmark numbers; Yjs is the lower-risk fit here.

One deliberate consequence: the room is the authority for **confirmed document actions**. Yjs
still syncs the resulting state, but a client's unconfirmed draft is not written to the shared
document. This is what makes "last confirmed wins" deterministic instead of depending on CRDT
client-id tie-breaks or browser clocks.

### 2.2 Realtime host: Cloudflare Workers + Durable Objects (recommended)

Run one **Durable Object per project room**:

- The DO accepts hibernatable WebSockets (`ctx.acceptWebSocket`), so idle connections stay open
  without duration charges.
- A Yjs document, the last GitHub blob SHA, the last-saved scene digests and the per-user
  presence state live in DO SQLite storage.
- An alarm performs GitHub autosave, conflict checks and session expiry/TTL cleanup.
- R2 stores temporary image assets by checksum; the `.umler` snapshot can inline them when it is
  written to GitHub.
- `y-partyserver` or `y-durableobjects` can provide the Yjs socket protocol, or implement the
  small `y-protocols/sync` + `y-protocols/awareness` message loop directly in the DO.

Why not only Vercel Functions? As of October 2026 Vercel WebSockets are generally available and
run on Fluid Compute, so a WebSocket endpoint is possible without a separate socket server.
However, a connection is pinned to one function instance and is closed at the function duration
limit (300 s on Hobby, 800 s on Pro/Enterprise by default, 1,800 s in an extended beta). Each
reconnect is harmless for Yjs, but it adds reconnect churn and requires Redis to coordinate
presence and room state across instances. That is viable, especially for a first presence-only
phase, but a Durable Object gives a cleaner long-lived room with built-in storage and hibernation.

Alternatives:

| Option | Fit | Trade-off |
|---|---|---|
| **Cloudflare DO + R2** | Best long-lived room, hibernation, cheap idle, SQLite cache, alarms | Second deployment target; DO/Yjs protocol work |
| **Hocuspocus 4 on Fly/Railway/Render + Redis + S3** | Mature Yjs server, open source, Node/TS, auth/database hooks | Operate a service and Redis; Redis extension is pub/sub, not persistence |
| **Vercel WebSocket Functions + Upstash Redis** | Single platform, GA WebSockets | 5–13 min connection ceiling, Redis pub/sub and persistence still required |
| **Liveblocks / Y-Sweet / PartyKit** | Fastest to ship, managed presence/storage | Vendor, data location, custom GitHub autosave still needed; Y-Sweet + S3 is closest to this design |
| **Hocuspocus on Vercel WebSocket Function** | Keeps Node server code | Still bound by Vercel connection duration; not ideal for long rooms |

**Recommendation:** start with Cloudflare DO + `y-partyserver`/`y-durableobjects`; keep the client
on a standard Yjs provider so the host can be swapped for Hocuspocus later.

### 2.3 Auth and permissions

Add a GitHub App (not just the existing OAuth App) for server-side writes:

- GitHub App permissions: **Contents: read/write**, **Metadata: read**, optionally
  **Pull requests: read/write** if PR mode is used.
- The server mints an installation access token (valid 1 h) and caches it. Installation tokens
  never reach the browser.
- Users still sign in with the existing GitHub OAuth device flow to identify themselves and to
  prove repository access. The Vercel API checks the repository and the user's permission, then
  mints a short-lived **collab JWT** (owner/repo/branch/path, user identity, `edit`/`view`,
  expiry) signed with a server secret. The Worker verifies the JWT on connect and reconnect.
- Users with read permission may join in viewer mode (no document updates accepted); write
  permission is required to edit.
- Room key: a stable hash of `owner/repo/branch/path`. Renaming or moving the file starts a new
  room; the old room is allowed to expire.

The GitHub App installation adds an onboarding step. If that is unacceptable in the first
release, a fallback is to let one authorized participant publish with their own OAuth token
("leader save"), but that is less reliable and leaks a user token into the session owner's
browser flow. It should not be the production design.

---

## 3. Document model

### 3.1 Project room

Start with **one Y.Doc per project**, not one per scene:

- `Y.Map project`: title, description, last active scene (optional), schema version.
- `Y.Map scenes`: sceneId → nested `Y.Map` scene manifest:
  - `meta` (`title`, `diagramKind`, timestamps, tags)
  - `canvas`, `layout`, `theme`
  - `content` (nodes, edges, assets metadata)
- `Y.Array sceneOrder`: scene ids for a deterministic order.
- `Y.Map assets`: assetId → metadata (`fileName`, `mimeType`, dimensions, checksum, storage key).
  Bytes are **not** put in the Y.Doc. Store them in R2/object storage; inline them into the
  `.umler` JSON when snapshotting to GitHub.

A project is tens of scenes and at most a few MB of JSON, so the initial sync is acceptable. If
scenes become very large, move scene content into **Yjs subdocuments** (one per scene, lazy-loaded
on scene switch). Subdocument support is uneven across providers; treat that as a performance
phase, not the first implementation.

Scene structure mapping:

| SceneDocument | Yjs type |
|---|---|
| `meta`, `canvas`, `layout`, `theme` | `Y.Map` (nested) |
| `nodes` | `Y.Map<nodeId, Y.Map>` |
| `edges` | `Y.Map<edgeId, Y.Map>` |
| `sections`, `rows`, labels, waypoints, parameters | `Y.Array<id>` for order + `Y.Map<id, Y.Map>` for values |
| free text (names, types, labels, comments) | string value in a confirmed LWW field register |
| numbers, booleans, enums, frames | primitive values in a confirmed LWW field register |
| assets | metadata in Yjs, bytes in object storage |

Use ids, never array indices, as the identity of rows/labels/waypoints. Reordering is then a
`Y.Array` move rather than delete/recreate.

### 3.2 Adapting the existing snapshot-based editor

Do **not** rewrite the edit functions or the canvas state shape. Add a collaboration adapter
between the existing `SceneDocument` state and the room:

1. **Local edit is optimistic.** React state changes as today, so typing/dragging stays
   responsive. The local value is a draft until the action is confirmed.
2. **Confirmation produces field targets.** On confirmation, the adapter compares the previous
   confirmed scene with the current draft and computes a list of target writes:
   - primitives/fields: one value per field;
   - text: the whole committed string (not a character stream);
   - id-keyed arrays: insert/delete/move by id;
   - frames: `x`, `y`, `width`, `height` as one `frame` target;
   - removed fields/nodes/edges: delete targets;
   - unknown fields are preserved.
3. **The room is the sequencer.** Send `{ actionId, baseSeq, targets }` to the room. The room
   validates the actor's edit permission, applies the targets to its authoritative Y.Doc in one
   transaction, assigns `seq = ++roomSeq`, and broadcasts the resulting Yjs update plus
   `{ actionId, seq, actor, targets }`. Clients do **not** write document state directly into
   the shared Y.Doc; that is what makes "last confirmed" the actual server order.
   Transport-wise, keep Yjs sync for server-to-client catch-up and add a small `confirm` message.
   The room rejects client-originated document updates; it accepts only awareness and confirmed
   actions from clients.
4. **Remote update:** read the authoritative Y.Doc, materialize a `SceneDocument`, and set React
   state with an `applyingRemote` flag. The adapter and history must ignore that materialization
   as a local edit; it is not dirty and must not be pushed back or undone locally.
5. **Editing lock:** while a field input is focused and dirty, a remote update to that field must
   not replace the text under the user's cursor. Keep the local draft, show a small
   "X updated this field" badge, and let the user's next confirmation win. If they blur without
   changing anything, adopt the remote value.
6. **Revision/timestamps:** do not feed `revision` and `updatedAt` through the action diff as
   normal fields. Materialize them from the room sequence or assign them only when the server
   snapshots to GitHub. This prevents remote reapplications from marking the project dirty.
7. **High-frequency interactions:** keep the existing preview/commit split.
   - Dragging/resizing: update local preview at frame rate, broadcast the preview through
     awareness, and confirm the final frame(s) on pointer-up.
   - Typing: do **not** stream each character into the shared document. Confirm the whole field
     on `Enter`, `blur`, or 300–500 ms of idle time. This is what makes overlapping text edits
     resolve as last-confirmed rather than interleaved characters.
   - Chips, checkboxes, selects and colour pickers confirm immediately.
8. **Undo/redo:** keep a per-user action log. Undo only a user's own latest confirmed action if
   it is still the current winner for its targets; otherwise skip it and show a brief "changed
   by another user" notice. Do not blindly replay old values over a newer confirmation.
9. **Scene switching:** switching a scene is local UI state; publish it through awareness. The
   project manifest is shared, so scene create/delete/rename/duplicate is a confirmed action.

This adapter is the main integration risk. A snapshot-diff layer is less invasive than rewriting
edits, but its diff rules and confirmation boundaries need thorough tests.

### 3.3 Overlapping actions: the last confirmed action wins

The room applies confirmed actions in arrival order. A confirmation is "last" when the room
assigns it the highest sequence for that target. This deliberately does not use client wall
clocks: a browser with a wrong clock must never win.

**Target granularity**

| Action | Target key |
|---|---|
| Text field | `nodes/<id>/name`, `rows/<id>/name`, `labels/<id>/text`, `comments/<id>/body`, … |
| Object position/size | `nodes/<id>/frame` (all four values together) |
| Edge terminal | `edges/<id>/markers/source` or `markers/target` |
| Edge style/label | `edges/<id>/style/stroke`, `edges/<id>/labels/<id>/text`, … |
| Row order | `nodes/<id>/sections/<sid>/order` |
| Theme/style property | `theme/<property>`, `nodes/<id>/header/textStyle/<property>` |
| Multi-object drag | one frame target per object, all stamped with the same action `seq` |

A later action for the same target replaces the earlier value. Actions for different targets
merge normally. A multi-target action (paste, multi-object drag) resolves independently per
target, so another user's unrelated edit is never lost.

```text
Alice: name = "OrderService"  ──confirm──►  room assigns seq 41  ──broadcast──►  all clients: OrderService
Bob:   name = "OrderGateway"  ──confirm──►  room assigns seq 42  ──broadcast──►  all clients: OrderGateway
```

Bob's later confirmation wins. Alice's field flips to `OrderGateway` with a notice; there is no
merge dialog and no duplicate scene copy.

**Examples**

- Alice changes a class name to `OrderService`; Bob changes the same name to `OrderGateway`
  two seconds later. Bob's confirmation reaches the room last; every client ends on
  `OrderGateway`, and Alice sees a subtle "Name updated by Bob" notice.
- Alice drags a table while Bob resizes it. The action target is the whole frame, so whichever
  pointer-up is confirmed last wins the frame; there is no half-position/half-size state.
- Alice edits a row's `type` while Bob edits the same row's `name`. Different target keys, so
  both changes survive.
- Alice confirms a text field while Bob is still typing in the same field. Bob's later
  confirmation wins; Alice's field flips to Bob's value with a notice. Bob's input is never
  yanked mid-typing by Alice's earlier confirmation because of the editing lock.
- A row is deleted while another user has its name focused. The delete action wins; the late
  name confirmation targets a missing row and is rejected, with the input closing and a
  "row was deleted" notice.

**What last-confirmed-wins is not**

- It is **not** a merge dialog. Overlapping field actions never open the GitHub/local/remote
  picker.
- It is **not** character-level text merging. `Y.Text` interleaving is intentionally rejected
  for normal labels and fields because it does not have a single "last confirmation". If
  character-level co-editing of a long note is wanted later, model that note as a separate
  explicitly collaborative text field with its own policy.
- It is **not** a client-clock LWW. A delayed packet with an old timestamp cannot beat a newer
  confirmed action; the room sequence is authoritative.

**Offline/reconnect edge case**

Actions created while disconnected are drafts. On reconnect, if their target changed since the
action's `baseSeq`, do not silently replay them: show a short review prompt ("Apply my pending
change?") or discard them. This keeps the online rule exact without allowing an offline tab to
clobber newer work it never saw. If silent replay is desired later, it is a deliberate product
decision, not an accident of the CRDT.

### 3.4 Scene deletion semantics

Scene deletion is an action too. Use a `deleted` tombstone / removal entry in `scenes` and
`sceneOrder`; do not let a late remote update resurrect a deleted scene. A delete action wins over
a later edit to the deleted scene's missing targets (the targets are rejected). If two users
change a scene while a third deletes it, the scene-level GitHub merge rules are the model: edits
win over deletions in an **offline/GitHub merge**, but in a live room the room order decides and
the affected users get a notice. The room should not silently resurrect a deleted scene and then
push it back to GitHub.

---

## 4. Presence, cursors and top bar

Use Yjs **Awareness** (ephemeral, not part of the document):

```ts
{
  user: { id, login, name, avatarUrl, color },
  sceneId: "scene_uml_class_payments",
  cursor: { x: 123.4, y: 56.7 } | null, // world coordinates
  editing?: { fieldPath: "nodes/node_1/name" } | null, // focused draft, no text payload
  selection: { nodeIds: [], edgeIds: [] } | null,
  dragging?: { nodeIds: [], frames: {} } | null, // ephemeral drag preview
  viewport?: { x, y, zoom } // optional follow mode
}
```

- Send **world** coordinates, never screen pixels; each client applies its own camera/zoom.
- Throttle cursor updates to ~30–50 ms; stop while the pointer leaves the canvas; clear on scene
  switch.
- Awareness states expire after ~30 s and are removed on disconnect; also send an explicit
  removal on `beforeunload`/provider destroy to avoid ghost avatars.
- Colour is deterministic from the user id, with accessible contrast.

Top bar:

- **Project collaborators:** avatar stack + count from every awareness state in the room.
- **Per scene:** group the same states by `sceneId`; show the current scene's avatars/badges
  prominently and other scenes' counts in a hover/dropdown.
- Clicking an avatar could later focus that user's viewport or selection; not required for MVP.
- A read-only viewer is shown with a "viewing" marker.

Render remote cursors in the existing SVG stage as an overlay inside the camera transform. Also
render ephemeral drag ghosts from `dragging.frames` so remote movement is smooth without writing
every pointer move into the CRDT.

---

## 5. Room lifecycle and GitHub synchronization

### 5.1 Join

1. Browser requests `/api/collab/token` with the GitHub session; Vercel checks repo permission
   and returns a short-lived JWT.
2. Browser connects to `wss://collab…/room/<roomKey>?token=…`.
3. Room cold start:
   - if DO SQLite has a cached Y.Doc snapshot/update log, load it;
   - otherwise fetch the `.umler` file from GitHub via the installation token, validate and
     deserialize it, then initialize the Y.Doc;
   - if both exist, compare the cached last SHA with the remote SHA and reconcile (below).
4. Client syncs the Y.Doc and awareness. A late joiner receives the current state, not history.

### 5.2 Autosave to GitHub

- **Snapshot debounce:** 60–120 s after the last document change, with a minimum interval of
  60–120 s between commits; always snapshot on the last participant leaving and before TTL
  eviction.
- Serialize writes per room; the Contents API requires the current **blob** SHA. A stale SHA
  returns `409` and must not be blindly retried (`PUT` commits even identical content).
- Store `lastPushedSha` and `lastPushedSceneDigests` in DO storage.
- No empty commits: compare the serialized bytes/commit digest with the last push.
- Commit message includes project title and, optionally, active collaborators.
- Installation tokens are app-attributed commits. If per-user attribution is required, use the
  Git Data API to create a commit with an explicit author (more work), or publish on behalf of
  the last editor using their user token (not recommended for security).

### 5.3 External edits while a room is live

GitHub has no lock. Poll the file SHA every 20–30 s, and optionally accept a GitHub webhook:

- Remote SHA unchanged: continue.
- Remote SHA changed:
  1. fetch and deserialize the remote project;
  2. run the existing pure `mergeProjectScenes` three-way merge with the room's last-pushed
     scene digests;
  3. scenes changed only remotely are imported into the Y.Doc (as scene replacements);
     scenes changed only in the room stay;
  4. scenes changed on both sides are a conflict: pause autosave, show a sticky "GitHub changed"
     banner, and let the existing merge picker choose local/remote/keep both;
  5. after resolution, update the Y.Doc, resume autosave, and commit.

This reuses the scene baseline/merge work rather than building a second conflict system. The
server must never overwrite a changed remote file without this reconciliation.

### 5.4 Cache expiry

- DO storage or Redis TTL: 4 h after the last participant leaves (configurable).
- On TTL alarm: if dirty, attempt a final snapshot; keep the GitHub SHA/digests; then delete the
  cached Y.Doc and assets.
- Next join after expiry starts from GitHub. Unsaved room edits are not durable after TTL, which
  is explicit in the product ("server cache, GitHub is the source of truth").

### 5.5 Assets

- Upload images through an authenticated room endpoint; store bytes in R2 keyed by checksum with
  the same room TTL.
- Yjs holds only asset metadata.
- When snapshotting to GitHub, fetch referenced bytes and inline them into the existing `.umler`
  asset map, preserving the current file format.
- Do not put image bytes in Yjs or Redis; it bloats updates and makes presence/reconnect heavy.

---

## 6. Client integration points

| Area | File / component | Work |
|---|---|---|
| Editor state | `src/app/App.tsx` | Add a collaboration session hook; wrap scene updates with the diff adapter; skip local dirty/history on remote origin |
| Undo | `src/app/use-scene-history.ts` | Replace with a per-user confirmed-action log; undo only the user's still-current winner |
| Canvas | `src/canvas/CanvasStage.tsx` | Awareness cursor overlay; publish cursor world coords; remote drag ghost overlay |
| Top bar | `src/app/Toolbar.tsx` / `AppMenuBar.tsx` | Project/scene collaborator avatar groups |
| GitHub merge | `src/model/github-project.ts` | Reuse `mergeProjectScenes`, `conflictingScenes`, `sceneDigestMap` server-side for external edits |
| Persistence | `src/model/persistence.ts` | Materialize Y.Doc → project JSON for snapshots; keep schema validation |
| Auth | `api/github/oauth/*` | Add `api/collab/token` on Vercel; GitHub App private key stays server-side |
| Local cache | `src/app/project-storage.ts` | Optionally add `y-indexeddb` for offline reload; keep it separate from the room cache |
| New module | `src/collab/` | Y.Doc schema, diff adapter/materializer, provider setup, awareness types |

Add dependencies: `yjs`, `y-protocols`, a provider (`y-partyserver`, `y-durableobjects`, or
`@hocuspocus/provider`), and optionally `y-indexeddb`.

---

## 7. Security and operational rules

- Never send GitHub installation tokens or App private keys to the browser.
- Collab JWT is short-lived, room-scoped and permission-bearing; refresh on reconnect.
- Reject document updates from viewers; enforce message size and update-rate limits.
- Validate/normalize project JSON at load and before every GitHub write; a malformed room must
  not reach GitHub.
- Limit room size and connections per user/repo; add a kill switch to disable collaboration and
  fall back to the current single-writer save path.
- Log room joins/leaves, GitHub commits, 409s, conflicts and TTL flushes; never log tokens or
  full document contents.
- Temporary project data lives in DO/Redis/R2 only for the TTL window. Document this in the UI.
- If end-to-end encryption is required later, the server can relay Yjs updates and still cache
  ciphertext, but server-side GitHub snapshots need a client-side publisher or an encrypted
  project format.

---

## 8. Rollout plan

### Phase 0 — feasibility spike (2–4 days)

- Yjs document for **one scene**, `y-durableobjects`/`y-partyserver` room, two browsers.
- Diff adapter for nodes/edges/frames only; text fields temporarily LWW.
- Remote cursors from awareness.
- No GitHub writes yet; verify convergence, reconnect and DO hibernation.

### Phase 1 — usable live scene + GitHub autosave (1–2 weeks)

- Full scene schema including rows/sections/labels/waypoints; whole-field confirmed LWW text.
- Project manifest (scene list) read-only or last-writer-wins; active scene is local.
- GitHub App auth, collab token endpoint, room JWT.
- Autosave every 1–2 min and on last leave; 409/external-edit reconciliation using the existing
  merge helpers.
- Top bar project + scene presence.
- Feature flag; keep the current non-collaborative mode as fallback.

### Phase 2 — collaborative project management (2–3 weeks)

- Scene add/delete/rename/duplicate/reorder in Yjs; deletion tombstones.
- Assets via R2 and `.umler` inlining.
- Conflict banner for external edits and for edit-vs-delete scene cases.
- Undo parity over the confirmed-action log; offline reconnects.
- Room TTL/flush alarms, metrics and admin kill switch.

### Phase 3 — hardening (2+ weeks)

- Subdocuments if initial sync or memory is a problem; per-scene room sharding.
- Capacity tests, latency tests, large projects, asset limits.
- Optional branch/PR publishing mode instead of direct branch writes.
- Multi-region/multi-instance testing; Redis/DO failover.

Rough total: **4–8 weeks** for a production-quality rollout, depending mostly on how much text
binding and undo parity is required.

---

## 9. Test plan

- **Same-field confirmation:** two clients edit the same text field/row name/theme property and
  confirm in a known order; both replicas end on the later server sequence, regardless of client
  clock skew or packet arrival order.
- **Editing lock:** a remote confirmation arrives while a user is still typing in that field; the
  input is not yanked, a notice appears, and the user's later confirmation wins.
- **Distinct fields:** concurrent edits to the same table/row but different fields both survive.
- **Frames and multi-object actions:** concurrent move/resize of one object resolves the whole
  frame to the latest confirmation; a multi-object drag resolves each object independently.
- **Deletion races:** a delete confirmed after a field edit wins; a late field confirmation for a
  deleted row/scene is rejected and the editor shows a notice.
- **Offline pending actions:** on reconnect after the target changed, the client prompts instead
  of silently clobbering newer work.
- **Convergence:** all replicas materialize identical scenes after replays, reconnects and
  server restarts.
- **Snapshots:** materialize → JSON → deserialize → validate equals the collaborative state.
- **Presence:** cursors track zoom/pan; leave removes avatars; scene switch moves the badge;
  ghost drags do not enter the document.
- **Reconnect:** kill the socket, reload a tab, hibernate the DO; state and awareness recover.
- **GitHub:** autosave creates one commit per window; no empty commits; stale SHA returns a
  visible conflict; external edit during a session merges or pauses; TTL flush leaves GitHub
  correct.
- **Permissions:** viewer cannot write; revoked user cannot reconnect; token expiry refreshes.
- **Scale:** 10+ concurrent users, 20+ scenes, large class/ER tables, image assets.
- **Failure:** invalid remote JSON, deleted remote file, DO restart, R2 outage; editor must not
  lose local work silently.

---

## 10. Open decisions

1. **Host:** Cloudflare DO vs Hocuspocus + Redis vs Vercel WebSocket + Redis. Recommendation:
   DO first, client on a standard Yjs provider.
2. **One project doc vs per-scene subdocuments.** Start with one doc; profile before splitting.
3. **Text model:** resolved as whole-field confirmed LWW. Character-level `Y.Text` interleaving
   is rejected for normal labels and fields because it has no single "last confirmation" winner.
   A future long-note editor could opt into a separate explicitly collaborative text policy.
4. **Scene deletion policy.** Edits win over deletions in the existing merge; decide whether the
   room shows a conflict banner or silently resurrects.
5. **Commit strategy:** direct writes to the bound branch vs a per-session branch + PR. Direct
   writes keep the current UX; a branch avoids overwriting main while a session is live.
6. **Attribution:** App-attributed commits vs Git Data API commits with author metadata.
7. **Assets:** inline into `.umler` on each snapshot vs change the format to external asset
   references.
8. **Offline:** `y-indexeddb` local persistence and replay on reconnect, or online-only sessions.

---

## 11. Implemented slice

This repository now contains a working first slice:

| Area | Location |
|---|---|
| Room server | `server/collab/server.ts` |
| Redis snapshot store | `server/collab/redis.ts` |
| Blob asset store | `server/collab/blob.ts` |
| Protocol and awareness types | `src/collab/protocol.ts` |
| Per-room administrator key derivation | `src/collab/room-key.ts` |
| Structural diff/apply and replica sequencing | `src/collab/patch.ts` |
| React collaboration bridge | `src/collab/use-collaboration.ts` |
| App, top-bar and cursor integration | `src/app/App.tsx`, `src/app/Toolbar.tsx`, `src/canvas/CanvasStage.tsx` |
| Administrator enablement dialog | `src/app/CollabUnlockDialog.tsx` |
| GitHub-permission token endpoint | `api/collab/token.mjs` |
| Tests | `scripts/test-collab.ts` |

### Run locally

```bash
npm run collab:server   # ws://127.0.0.1:1234, file cache in .collab-cache/
npm run dev
```

Open two tabs at `http://127.0.0.1:5173/?collabRoom=devtest`. Query-string rooms are enabled in
development only; a bound GitHub project uses `owner/repo@branch:path` as its room.

For GitHub-backed rooms set `VITE_COLLAB_URL` (client), `COLLAB_SECRET` (Vercel Function and
server), and deploy the room server behind TLS (`wss://`). The token endpoint verifies GitHub
repository push permission and returns a 12-hour room-scoped HMAC token. The room rejects
tokenless connections when `COLLAB_SECRET` is set.

### Administrator enablement

GitHub-backed rooms are locked unless the room server has an administrator code. The browser
derives `HMAC-SHA256(administratorCode, roomId)`, sends only that per-room key, and stores it for
one project. The server compares it with its own derivation; the raw code never leaves the
browser. Collaborators enter the same code once on their own browser.

Set `COLLAB_ADMIN_CODE` on the room server (a long random value). The local
`npm run collab:server` script loads `.env.local`, so the same value drives local testing. If it is
absent, rooms are open and the server reports `required: false` at `/unlock`; this is intended for
local development only. The unlock check is independent of the GitHub JWT: production rooms
normally require both a permitted GitHub account and the administrator key.

### Redis and Blob

- **Redis** (`UMLER_STORAGE_KV_REST_API_URL` / `UMLER_STORAGE_KV_REST_API_TOKEN`) receives a full
  room snapshot every 5 seconds while dirty, plus on last leave and shutdown. It never receives
  cursor updates or per-action commands, keeping usage far below the 500k-action free tier for
  normal sessions.
- **Blob** (`BLOB_READ_WRITE_TOKEN`) receives image bytes larger than `COLLAB_BLOB_MIN_BYTES`
  (default 4 KiB). The cached project keeps asset metadata and a checksum reference; the room
  hydrates the data URL from Blob when restored. Upload failures fall back to inline data URLs, so
  Blob is an optimisation, not a correctness dependency.
- One room process remains the authoritative sequencer. Redis is snapshot storage, not a
  cross-instance ordering service, so multiple replicas still need a shared sequencer.

### Protocol

- `join` carries the user, active scene and an optional project seed. The first connection seeds
  an empty room; later connections receive the cached project.
- Local edits are debounced for **240 ms of idle time** and sent as id-keyed field/array patches
  (`set`, `delete`, `insert`, `remove`, `reorder`, `replaceArray`).
- The room applies each action in receipt order, increments `seq`, broadcasts the action to every
  client including the sender, and persists a temporary JSON cache.
- Clients apply actions in `seq` order and resync if a sequence gap appears. An action's `seq`
  decides same-field winners; client clocks never do.
- `presence` carries `sceneId`, world-space cursor, selection and the currently edited field path.
  The server broadcasts only that user's presence; join/leave sends the full user list and leader.
- The first connected editor is the leader. Auto-save to GitHub is gated to the leader client;
  manual save remains available. Leadership transfers when the leader disconnects.
- A compact indicator in the footer status bar opens the participant menu: **Leave session**
  (this tab only), **Rejoin**, and **Disable on this browser**. Leaving does not end the room for
  other participants.
- Clicking a participant in that menu enters **View as**: the observer follows that participant's
  active scene and world-space viewport centre, keeps their own zoom, and continues to see the
  participant's cursor. A manual canvas pan or a manual scene pick exits the mode.
- A live drag-to-select rectangle is published as transient presence and drawn for every
  collaborator in the same scene in their colour; the collaborator's cursor keeps its name label.
  It disappears when the drag is released; the resulting selection is not mirrored.
- A room stays live while at least one tab is connected. After the last participant leaves, the
  file/Redis snapshot remains for `COLLAB_TTL_HOURS` (default **4 hours**) so it can be rejoined;
  the cleanup pass runs every 10 minutes. GitHub remains the durable copy.

### Current limits / next steps

These are deliberate first-slice boundaries, not silent behavior:

1. **Editing lock is not implemented yet.** A remote confirmation can replace text under a
   focused input. The user's later confirmation still wins; the next step is to hold remote
   patches for the focused path and show an "updated by X" badge.
2. **Undo is local-snapshot based.** Remote changes are not added to local history, but an undo
   can still revert the local present scene. Full per-user action-log undo is Phase 2.
3. **Image bytes still travel inline over the WebSocket** in the seed and patches. Large assets are
   stripped from Redis/file snapshots and stored in Blob, but a newly inserted image is still sent
   as base64 to peers. Moving the transport itself to Blob metadata plus a fetch is the next step.
4. **The room is a single Node process.** Redis improves restart recovery but is not a shared
   sequencer; do not run multiple replicas behind a load balancer without a Durable Object or
   equivalent ordering service.
5. **GitHub publishing is client-side.** A leader tab must be online for the 2-minute autosave.
   The cache survives restarts for the TTL but is not itself the durable writer.
6. **Joining an existing room replaces the local project** (with a toast). Unsaved local changes
   are not merged into the room before joining.
7. **Tokens are checked on connect**, not continuously; a revoked user can keep an existing
   socket until reconnect. Token refresh/revalidation is hardening work.
8. **No end-to-end encryption.** The room server sees project JSON and image bytes.
9. **Blob storage is temporary.** Assets are deleted when the room expires. If the Blob store is
   private, the server still reads through its read/write token; a public store relies on
   unguessable per-room paths and should not hold sensitive material.
10. **The administrator key is per browser.** A collaborator must enter the code once on each
    browser/profile; it is not written into the project file.

### Verification

`npm run test:collab` covers patch round trips, same-field last-wins, distinct-field merging,
row reordering, server sequencing, presence, leader transfer, cache restart, JWT room scoping,
administrator-key derivation and rejection, Redis snapshot recovery, and Blob asset
compact/hydrate round trips, sender-side presence updates, view-center camera helpers, and live
marquee relay (56 assertions). It is part of `npm run check`.

Manual browser verification: two tabs at `?collabRoom=devtest` show each other in the top bar,
sync a header rename, resolve the same field to the last tab that confirmed, move remote cursors,
and show `+N elsewhere` when a collaborator switches scene.

## 12. References

- Vercel WebSockets (GA October 2026, connection duration limits, Redis for cross-instance state):
  <https://vercel.com/docs/functions/websockets>,
  <https://vercel.com/changelog/websocket-support-is-now-generally-available>,
  <https://vercel.com/kb/guide/do-vercel-serverless-functions-support-websocket-connections>
- Cloudflare Durable Objects WebSockets + hibernation + alarms + SQLite:
  <https://developers.cloudflare.com/durable-objects/best-practices/websockets>,
  <https://developers.cloudflare.com/durable-objects/api/state>,
  <https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle>
- Yjs awareness: <https://docs.yjs.dev/getting-started/adding-awareness>,
  <https://docs.yjs.dev/api/about-awareness>
- Yjs shared types / nested maps and arrays:
  <https://docs.yjs.dev/getting-started/working-with-shared-types>
- Yjs awareness permissions and transient cursor state:
  <https://www.tag1.com/blog/yjs-deep-dive-part-3>
- Yjs providers / servers: <https://yjs.dev/>, <https://tiptap.dev/docs/hocuspocus>,
  <https://github.com/napolab/y-durableobjects>,
  <https://github.com/cloudflare/partykit/tree/main/packages/y-partyserver>,
  <https://github.com/jamsocket/y-sweet>
- Hocuspocus Redis scaling and persistence hooks:
  <https://tiptap.dev/docs/hocuspocus/server/extensions/redis>,
  <https://tiptap.dev/docs/hocuspocus/server/hooks>
- CRDT benchmarks (Yjs / Automerge / Loro):
  <https://kizakicorp.github.io/crdt-benchmarks>
- GitHub App installation tokens:
  <https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation>
- GitHub Contents API (blob SHA, 409, serial writes):
  <https://docs.github.com/en/rest/repos/contents>
