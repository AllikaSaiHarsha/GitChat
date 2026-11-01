# GitChat — Security Audit Report

**Target:** `D:\realtime-chat-app` (GitHub: `AllikaSaiHarsha/GitChat`, private) · **Source ref:** commit `c9afa25` (main, in sync with origin, CI green)
**Audit date:** 2026-10-17 · **Method:** Cloudflare `security-audit` skill, profile `quick` (bounded pass) · **Run id:** `gitchat-run-1`
**Posture at audit time:** read-only — no application code, configuration, git state, or running process was modified; your running servers were not touched.
**Post-audit update (2026-10-17):** you approved and applied the full remediation (P0–P3) and authorized bounded local validation of the six leads. All six were demonstrated by execution against `c9afa25` and are now **confirmed**; every fix in §9 is applied and pushed. See §11 for the commit map, validation evidence, and the owner-observable residue.

---

## 1. Executive summary

This was a full read-only review of the GitChat codebase (`client/`, `server/`, `.github/`, dotfiles), executed through the installed Cloudflare `security-audit` skill (see §3–§4). The app is a small single-process Node/Express + Socket.IO chat with a React SPA, rooms, memberships, admin management, and session resume.

**Verdict in one line (at audit time):** the core authentication/authorization architecture is sound where it is applied, but the socket-event layer has two small authorization gaps (confirmed, low severity), the app's availability posture rests on unvalidated but well-evidenced crash paths, and two deployment/install-time preconditions (JWT secret fail-open, lockfile integrity metadata) need one owner-observed fact each before they can be closed. **Post-audit update (2026-10-17):** all six leads were subsequently demonstrated by bounded local execution and promoted to confirmed (**3 HIGH, 1 MEDIUM, 2 LOW**), and the full P0–P3 plan was applied and pushed — the crash paths, JWT fail-open, socket quotas, canonicalization mismatch, and lockfile metadata are fixed; only the owner-observable deployment/data facts and deployment-layer decisions remain open (§11).

- **2 confirmed findings** (both LOW): the socket `typing` event lacks the membership check its sibling handlers enforce; reactions are keyed globally by `messageId` and cross room boundaries.
- **6 independently verified leads — all since validated and fixed:** JWT secret falls back to a public literal when unset (**confirmed HIGH**); one malformed authenticated request killed the shared process in bounded execution (4 REST routes, **confirmed HIGH**) and malformed socket events did too (6 variants, **confirmed HIGH**); no rate limit or quota on any Socket.IO event (**confirmed MEDIUM**); stats authorized a normalized room but aggregated the raw selector (**confirmed LOW**, mechanism demonstrated); 159 lockfile entries pinned neither URL nor digest (**confirmed LOW**, regenerated to 0 missing). Evidence and severities: §11.2.
- **0 rejected candidates**; **21 hardening notes**; every audit-time runtime/deployment-dependent conclusion was blocked only by the absence of an OS-enforced sandbox on this host, with exact bounded validation plans recorded — all six were subsequently resolved by owner-approved bounded local execution (§11.2).
- **Not applicable after search:** no AI/LLM integration of any kind, no Cloudflare/cloud/deployment configuration, no webhooks/uploads, no cookies (CSRF N/A), no session IDs (session fixation N/A).
- **Skill-native artifacts** (ledger, findings, validation plans, hunter notes) are outside the repo under `C:\Users\sai68\security-audit-skill\gitchat\run-1\` (see §6).

---

## 2. Architecture and trust boundaries

**Components (all in-repo):**

| Component | Where | Notes |
|---|---|---|
| REST API (Express 4.22.3) | `server/app.js` | Auth (register/login/me), rooms (list/create/join/leave), members (list/add/remove), messages (history), stats (activity) |
| Realtime (Socket.IO 4.8.4) | `server/socket.js` | Events: `join_room`, `send_message`, `typing`, `toggle_reaction`, `leave` |
| Auth | `server/auth.js` | JWT HS256, 7-day expiry, secret from `JWT_SECRET`; bcryptjs cost 10 |
| Data | `server/rooms.js`, `server/db.js`, `server/models/` | Optional MongoDB (mongoose); otherwise in-memory fallback stores |
| SPA | `client/src/` (React + Vite 5 at audit time; upgraded to Vite 8 post-audit — §9/§11) | Token in `localStorage` (`chat_token`); markdown messages rendered by react-markdown 9.1.0 |
| CI | `.github/workflows/ci.yml` | push(main)+PR; `contents: read`; `npm test` + `npm run build` |

**Trust boundaries crossed by the audit:** unauthenticated → authenticated (register/login/join REST; socket handshake `io.use`); authenticated → room member (`isMember`); member → admin (`isAdmin`); member → other rooms' data (the isolation boundary: messages, members, stats, reactions); repo → CI/installer (lockfiles, workflow); browser → origin (`localStorage` token exposure).

**Environment facts verified:** there is **no deployment layer in the repository** (no Docker/IaC/serverless/Cloudflare config; local dev scripts only), **no AI/LLM code or provider keys**, **no cookies anywhere**, **no URL fetches to user-controlled addresses** (no SSRF surface), and **no file uploads**. The user's framing of an "AI chat app" does not match the code — every AI-specific check in the request is formally not applicable and was confirmed by search, not assumed.

---

## 3. Scope and methodology (tools used)

- **In scope:** `client/`, `server/`, `.github/`, `README.md`, `.gitignore` at `c9afa25`. **Out of scope:** `.agents/` and `skills-lock.json` (installed audit tooling), `node_modules/`, `dist/`, `.git/`.
- **Constraints honored:** read-only; no app/config/git changes; no deploys; no network; **no execution of application code** (no sandbox exists on this host, so the skill's execution permission was withheld); your running servers were never started, stopped, or sent traffic.
- **Method:** the Cloudflare audit skill's staged workflow — reconnaissance → deterministic coverage units → parallel hunters against companion attack-class guides → one post-wave coverage critic → one fresh independent verifier per candidate (quick profile merges its Phase 3 and Phase 5) → skill-validated final records → reports.
- **Tools:** ripgrep/glob/read over source; `git log`/`git status --ignored` for secrets & hygiene; Node-based JSON parsing of lockfiles (exact counts); the skill's own `validate-coverage-ledger.cjs` / `validate-findings.cjs` validators (invoked through a Windows-adapted runner, logic unchanged); grep checks for `dangerouslySetInnerHTML`/`innerHTML`/`eval`/`postMessage`/`rehype-raw`.
- **Taxonomy mapping:** skill verdicts map to your requested confidence terms as **confirmed → confirmed** and **needs_validation → unverified** (source-grounded, exact blocker recorded). Per the skill's contract, unverified records carry **no severity** — the P0–P3 plan in §9 ranks them by remediation priority instead.

---

## 4. Skill status and checks completed

- **Skill discovered and used:** `.agents/skills/security-audit/` (installed, recorded in `skills-lock.json`). Its workflow, report schema, and both validators were followed. No AGENTS.md exists in the repository (checked).
- **Coverage:** 24 deterministic units — **10 covered** (clean), **10 closed with candidates**, **2 deferred** (critic-accepted gaps, not hunted in quick profile), **2 out of scope**. One coverage critic ran; it accepted both hunter-flagged gaps and requested no reassignment.
- **Verification:** 8 unique candidates → 8 fresh independent verifiers (one each; merged Phase 3+5) → **8 final records: 2 confirmed, 6 needs_validation, 0 rejected at audit time**; post-audit all 6 leads were validated and promoted — the current `findings.json` state is **8 confirmed, 0 needs_validation, 0 rejected** (§11.2).
- **Validators:** final state passes the skill's own `coverage-ledger` **PASS** and `findings` **PASS**.
- **Budget:** 16 of 18 planned agent sessions used (4 recon + 3 hunters + 1 critic + 8 verifiers); 2 unused.
- **Disclosed adaptations (do not affect results):** validators invoked via a Windows-compatible runner calling their exported pure functions (the shipped CLI is POSIX-guarded); agents returned bounded JSON results persisted to their own scratch directories for transport; findings were mechanically assembled from verifier records; static repository inspection was the only permitted observation.

**Area-by-area check ledger (your A–H request):**

| # | Area | Outcome |
|---|---|---|
| A | Authn/authz (IDOR, session fixation, token leakage) | **Checked.** `requireAuth` on all non-anonymous REST routes; socket handshake verifies JWT; `isMember`/`isAdmin` gates verified on messages/members/join; member-management routes admin-gated; no session IDs (stateless JWT → session fixation N/A); token never placed in URLs; two socket-layer authz gaps confirmed (§5.1–5.2); stats authorization discrepancy lead (§5.5); JWT secret fail-open lead (§5.3) |
| B | AI chat security | **Not applicable — verified absent.** No AI SDK/provider/model/tool-calling/prompt code anywhere; no AI keys; nothing to test for prompt injection, cross-user AI leakage, or AI cost abuse |
| C | XSS / rendering | **Checked, clean** on the render path (react-markdown 9, no raw-HTML pass-through, URL protocol filtering, no dangerous DOM APIs); one deferred note (remote image auto-loads) and one hardening note (no CSP) |
| D | API/backend | **Checked.** No SQL/NoSQL object-injection path found (typed params); no SSRF surface (no outbound fetches); CORS pinned to `CLIENT_URL`; rate limiting only on register/login/join (leads §5.4, §5.6); no webhooks; error leakage limited to an intentional register enumeration message + login timing oracle (hardening 1); malformed-input crash leads (§5.4, §5.6) |
| E | Cloudflare-specific | **Not applicable — verified absent.** No wrangler/Pages/Workers/Functions config, no `_headers`/`_redirects`, no Cloudflare API usage or DNS/TLS config in the repo. (The "Cloudflare" element of this audit is the provenance of the audit skill.) If you deploy behind Cloudflare/a proxy later, the deferred rate-limiter trust-proxy item (§8) becomes directly relevant |
| F | Dependencies / supply chain | **Checked.** All 198 resolved lockfile URLs → `registry.npmjs.org`; no aliases/`file:`/`git+` specifiers; **integrity-metadata gap lead** (§5.8); CI read-only token, no secrets, static inputs (hardening 16, 17, 18, 21) |
| G | Data protection | **Checked.** Passwords bcrypt cost 10; no secrets in git history (only `.env.example` placeholders); DB failure path logs no secrets/Uri; token storage/usage disciplined (cleared on 401, cross-tab reload) but `localStorage` exposure noted (hardening 19); no uploads exist; message text capped at 1000 chars |
| H | Browser/deployment hardening | **Checked/Noted.** No cookies (CSRF N/A); HTTPS and response headers are deployment-layer facts absent from the repo; no `build.sourcemap` configured (Vite default: no production source maps); SPA loads only first-party, non-executable resources; anti-framing/CSP missing → hardening 14 |

---

## 5. Findings

Severity labels are used **only** for confirmed records, per the audit skill's contract. Leads are labeled **unverified** with their exact blocker; their priority ranking appears in §9. **Post-audit update (2026-10-17):** the six leads (§5.3–§5.8) were demonstrated by bounded local execution and are now confirmed — each heading records the outcome and severity, with evidence in §11.2. The §5.3–§5.8 bodies below are the audit-time text.

### 5.1 CONFIRMED — `typing` socket event has no room-membership check (severity: LOW)

- **What:** the `typing` handler broadcasts to a client-supplied room without the `isMember` check every sibling handler enforces.
- **Where:** `server/socket.js:159-161` (handler: `(room||'general').trim()`, then `socket.to(cleanRoom).emit('user_typing', {...})`), contrasted with `server/socket.js:97` (`join_room`), `:141` (`send_message`), `:170` (`toggle_reaction`); `server/rooms.js:87-92` (`isMember`); client render `client/src/components/Chat.jsx:150,448`; installed socket.io 4.8.4 `server/node_modules/socket.io/dist/socket.js:270,970`, `dist/broadcast-operator.js:174`, `dist/in-memory-adapter.js:125,259-266`.
- **Attack scenario:** any registered account (registration is open) connects with a valid JWT and emits `typing {room:'<private-room>', isTyping:true}` without ever being a member; every member currently connected to that room sees `<attacker username> typing`.
- **Impact:** transient, UI-only unauthorized write into a private room's realtime stream; attacker's own username (no impersonation); no persisted state.
- **Evidence:** bounded static observation (no sandbox to run live): the handler path contains no membership call; socket.io broadcast excludes only the sender and never requires sender membership; the default adapter delivers to the room's sockets. Confidence: `medium` (path fully source-verified; live delivery unexecuted).
- **False-positive possibilities:** none found — the sibling-handler contrast and the vendored library behavior are unambiguous; only real-world observability is unproven.
- **Minimal remediation:** require `await isMember(cleanRoom, username)` before emitting (mirror `server/socket.js:141`).

### 5.2 CONFIRMED — reactions keyed globally by `messageId`; cross-room inject/read/evict (severity: LOW)

- **What:** `toggle_reaction` authorizes only the caller-chosen room, never binds the message to that room, and stores reactions in one process-global map keyed by `messageId`; history merging and eviction are room-agnostic.
- **Where:** `server/socket.js:165-193` (handler), `:13` (global `reactionStore`), `:17-21` (`summarizeReactions` no room arg), `:44` (merge into whichever room owns the id), `:177` (global 500-entry eviction), `:72-83` (`evictFromRoom` only unsubscribes); `server/rooms.js:89` (`#general` open); client `Chat.jsx:100`, `MessageRow.jsx:166`.
- **Attack scenario:** a user — including a member **removed** by an admin (accounts and their 7-day JWTs are never revoked, and learned message ids stay valid) — joins `#general` and emits `toggle_reaction {room:'general', messageId:'<id from private room B>', emoji}`. Room B's members see the attacker's reaction on their next history load; the attacker's own echo returns the full reactor list (other rooms' member names); 500 events with fresh ids evict the globally oldest live reaction entries across all rooms.
- **Impact:** spurious reaction visible to private-room members; reactor-username readback for known ids; up to 500 live in-memory reaction entries erasable; state resets on restart. No message text is read or altered.
- **Evidence:** bounded static observation: no `messageId`-to-room binding or existence check anywhere in the event path; store/eviction keyed by `messageId` alone; merge is room-agnostic. Confidence: `high` (deterministic, independent of database mode/deployment).
- **False-positive possibilities:** none found in source; the only unexecuted step is booting the server.
- **Minimal remediation:** after `isMember(cleanRoom, username)`, require `messageId` to identify an existing message **of that room**, and scope the store per room with a per-room cap (concrete code sketch in `findings.json` → `code_changes`).

### 5.3 CONFIRMED (post-audit validation) — JWT secret fails open to a public literal when `JWT_SECRET` is unset (severity: HIGH)

- **Post-audit status:** demonstrated by execution against `c9afa25` — a token HS256-signed with `dev-secret-change-me` authenticated as the victim (`/api/me` 200, `/api/rooms` 200); with a real secret set in-process the same token got 401 while a freshly issued genuine token worked. Fixed in `134d84d`: production now fails closed (`NODE_ENV=production` + no secret → register 500, forged token 401; `checkAuthConfig` refuses to boot). Residual owner check: §11.3 item 1.

- **What:** `getSecret()` returns `process.env.JWT_SECRET || 'dev-secret-change-me'`; signing and verification both use it; a missing variable produces only a one-time warning and the server starts normally.
- **Where:** `server/auth.js:11-18,35,39`; `server/index.js:9`; handshake `server/app.js:200-210`; `.env.example` documents the variable.
- **Attack scenario if a deployed instance is missing the variable:** anyone can HS256-sign `{username:'<victim>'}` with the public literal and obtain full account access via REST and sockets.
- **Impact ceiling:** full authentication bypass on any affected instance.
- **Blocker (exact):** whether any deployed instance runs with the variable unset/empty is a deployment fact not visible in the repo (no deployment descriptors; the local `.env` has a custom value — presence inspected, value not read). No sandbox to demonstrate token acceptance locally.
- **False-positive possibilities:** if every deployment sets a strong `JWT_SECRET`, nothing is exploitable — the defect is the fail-open behavior, not a proven bypass.
- **Minimal remediation:** fail closed (refuse to start without a strong secret); optionally warn loudly in dev only.
- **Next steps:** bounded local plan (boot without the variable, forge a token, expect 200) and owner check (audit instance environments + startup logs) are recorded in `NEEDS-VALIDATION.md` §1.

### 5.4 CONFIRMED (post-audit validation) — one malformed authenticated request can kill the shared server process (4 REST routes) (severity: HIGH)

- **Post-audit status:** all four single malformed requests terminated the baseline child process in bounded execution (`exit -1073740791` = `0xC0000409`; fatal TypeErrors at `rooms.js:17` via `createRoom:162` / `joinRoom:193`, `app.js:74`, `app.js:143`). The fixed tree answers them with 4xx/5xx and keeps serving (fixed in `134d84d`).

- **What:** four authenticated REST handlers await async work on request-controlled values without type checks and without try/catch, while Express 4 never observes async rejections and no error middleware or process-level rejection handler exists.
- **Where:** `server/app.js:74` (array `?room=` outside the try), `:116-126` (create/join with non-string body fields → `server/rooms.js:16-17` `.toLowerCase` TypeError or bcryptjs rejection at `rooms.js:169,176,210`), `:143` (non-string `username` before the admin gate), `:214` (no error middleware); express 4.22.3 `server/node_modules/express/lib/router/layer.js:94-98`; `server/index.js:13` (single shared process).
- **Attack scenario:** any registered account sends one of four single malformed requests; under Node's default (≥15) the unhandled rejection terminates the process serving REST + all sockets + in-memory state.
- **Impact ceiling:** full availability loss / state reset per request while unhandled-rejection termination applies.
- **Blocker (exact):** process-terminal effect requires execution (no sandbox); deployed Node major and supervisor/restart policy are runtime facts outside the repo.
- **False-positive possibilities:** an operator-provided `--unhandled-rejections=warn`, a pre-15 Node, or a supervisor restart would downgrade this to error-log noise/short blips.
- **Minimal remediation:** wrap the four handlers (or adopt an async error wrapper + Express error middleware); add a process-level `unhandledRejection` handler and supervisor restart as defense in depth.
- **Next steps:** four-request local fixture; staging observation (exact requests, expected logs) in `NEEDS-VALIDATION.md` §2.

### 5.5 CONFIRMED (post-audit validation) — activity stats authorize a normalized room but aggregate the raw selector (severity: LOW)

- **Post-audit status:** demonstrated with a seeded non-canonical key — the same member of `team-room` received `days {"2026-10-17":1}` for `?room=Team Room!` (response echoed `"room":"Team Room!"`) while their canonical `?room=team-room` returned empty; the fixed tree canonicalizes every spelling (`team-room`, empty days). Fixed in `1056360`. Residual owner check: §11.3 item 2.

- **What:** the route checks membership against `normalizeRoomName(room)` but forwards the raw trimmed string to the aggregation.
- **Where:** `server/app.js:73-78`; `server/stats.js:17,22,26`; `server/rooms.js:16-22`; `server/socket.js:137-141`; `server/models/Message.js:9` (free-form `room` string).
- **Attack scenario if non-canonical stored room names exist:** a caller who is a member of the room the raw string normalizes to reads another key's aggregated activity counts (counts only, no message text).
- **Impact ceiling:** cross-room count disclosure; low.
- **Blocker (exact):** whether any stored `Message.room` differs from its own normalization (or any `Room.name` likewise) is a data-state fact; current writers store canonical keys, so only legacy/out-of-band rows realize the mismatch. Seeded-fixture read needs a sandbox.
- **False-positive possibilities:** if deployed data contains only canonical keys, the disagreement is unreachable.
- **Minimal remediation:** reuse the normalized value for the query (single canonicalization at the handoff).
- **Next steps:** seeded-fixture local plan; read-only owner check (`Message.distinct('room')` / `Room.distinct('name')` vs `normalizeRoomName`) in `NEEDS-VALIDATION.md` §5.

### 5.6 CONFIRMED (post-audit validation) — socket event handlers dereference unvalidated payloads (shared-process crash) (severity: HIGH)

- **Post-audit status:** all six malformed event variants killed the baseline process (`exit 0xC0000409`); all six were inert on the fixed tree (survival marker, exit 0). Fixed in `134d84d`.

- **What:** all four socket handlers destructure and string-method client payloads with no type checks; the synchronous `typing` handler throws, the async three reject; installed socket.io 4.8.4 dispatches listeners inside a bare `process.nextTick` with no try/catch, and no process-level handler exists.
- **Where:** `server/socket.js:90,136-138,159-166`; `server/rooms.js:17`; `server/node_modules/socket.io/dist/socket.js:685-698`, `dist/typed-events.js:18,68`, `dist/client.js:213`; `server/index.js:9`.
- **Attack scenario:** any authenticated socket emits `typing` (no payload), `{room:123}`, or other malformed variants; the escaped error reaches Node's defaults (uncaught exception aborts on all Node versions; unhandled rejection aborts on Node ≥15).
- **Impact ceiling:** same as §5.4 but reachable over the websocket layer.
- **Blocker (exact):** process outcome unobserved (no sandbox); Node version and supervisor policy are runtime facts.
- **False-positive possibilities:** supervisor restart, `--unhandled-rejections=warn`, or Node <15 would bound the effect to log noise/disconnects.
- **Minimal remediation:** validate payload types at the top of each listener (reject non-strings early); add listener-level try/catch or a process-level handler.
- **Next steps:** six-event local fixture (classify escape/exit); owner runtime/supervisor statement in `NEEDS-VALIDATION.md` §3.

### 5.7 CONFIRMED (post-audit validation) — no rate limit or quota on any Socket.IO event (severity: MEDIUM)

- **Post-audit status:** 50 of 50 burst `join_room` events were processed through the cost-10 bcrypt path on the baseline; the fixed tree admitted only the 5-event burst allowance (per-user token buckets). Fixed in `6e12a34`.

- **What:** the only rate limiter is an Express middleware on register/login/join; socket events never traverse it, so `join_room` for a locked room runs a cost-10 bcrypt compare per event with no throttle, and `send_message` has no event-rate bound (memory caps do not bound persistence or fan-out).
- **Where:** `server/app.js:43-50,124,195-210`; `server/socket.js:89-98,136-153,165`; `server/rooms.js:210`; bcryptjs 2.4.3.
- **Attack scenario:** one authenticated account floods `join_room` (each event re-computing bcrypt against a locked room's hash) or `send_message` (write + broadcast per event), degrading the single shared process.
- **Impact ceiling:** CPU/event-loop starvation of all users; durable message growth when MongoDB is connected.
- **Blocker (exact):** per-event cost/starvation unmeasured (no sandbox); upstream websocket caps, storage mode, and clustering are deployment facts.
- **False-positive possibilities:** an edge proxy/WAF websocket cap, clustering, or a very large CPU budget would absorb the effect.
- **Minimal remediation:** per-connection/per-user socket event token bucket (especially `join_room`), mirror the REST limiter scope.
- **Next steps:** 50-event timing fixture with before/after limiter; owner questions (proxy caps, `MONGO_URI`, topology) in `NEEDS-VALIDATION.md` §4.

### 5.8 CONFIRMED (post-audit validation) — 159 committed lockfile entries carry neither resolved URL nor integrity digest (severity: LOW)

- **Post-audit status:** exact recount confirmed 90/129 (server) + 69/228 (client) = 159 entries missing both fields at `c9afa25`; after the clean-room regenerations every entry carries both (0 missing, including all platform bindings). Fixed in `6e12a34`; re-applied for the Vite 8 lockfile in `5dd49ab`.

- **What:** both committed lockfiles are mixed state: client 69/228 and server 90/129 entries have **no** `resolved` and **no** `integrity` (357 total; 198 with both, 159 with neither, 0 with exactly one) — including direct dependencies (react, vite, express, socket.io…). CI runs `npm ci` on Node 24 with no npm pin.
- **Where:** `client/package-lock.json:2779,3235,2800`; `server/package-lock.json:346,21`; `.github/workflows/ci.yml:24,39` (recounted exactly during verification).
- **Attack scenario (if npm re-resolves such entries):** a manipulated registry response could substitute bytes for integrity-less packages at install time in CI or on developer machines.
- **Impact ceiling:** supply-chain substitution on install.
- **Blocker (exact):** what npm actually does for integrity-less entries (fail closed vs re-fetch metadata vs install registry-served bytes) is execution-dependent; npm major unpinned; no network available.
- **False-positive possibilities:** npm versions may fail closed or re-fetch metadata that includes integrity before accepting bytes — then the gap is a metadata-quality defect with no live exposure.
- **Minimal remediation:** regenerate both lockfiles with a single pinned npm version (`npm install` → verify all entries carry `resolved`+`integrity`), add `engines`/`.nvmrc`, and a CI audit step.
- **Next steps:** loopback-registry fixture; CI `loglevel=silly` inspection in `NEEDS-VALIDATION.md` §6.

---

## 6. Evidence and paths

- **This report** (human-facing): `D:\realtime-chat-app\SECURITY_AUDIT.md` — the only file created inside the repository.
- **Skill-native run directory** (outside the repo): `C:\Users\sai68\security-audit-skill\gitchat\run-1\`
  - `findings.json` — all 8 final records, schema-validated (the machine-readable source of truth; updated post-audit with execution records, conditions, severities, and remediation — §11 — and validators PASS).
  - `coverage-ledger.json` — 24 units with statuses, checks, reviewed paths.
  - `REPORT.md`, `FINDINGS-DETAIL.md`, `NEEDS-VALIDATION.md` — the skill's Phase 6 reports.
  - `hardening.json` — 21 retained hardening notes with attribution.
  - `verification/` — per-candidate inputs; `agents/*/scratch/result.json` — raw hunter/verifier/critic outputs; `run-metadata.json` — scope, budget accounting, adaptations.
- **Primary evidence highlights** (file:line): confirmed findings — `server/socket.js:159-161` (typing), `:165-193` + `:13,17-21,44,177` (reactions), `server/rooms.js:87-92`, client `Chat.jsx:150,448`; leads — `server/auth.js:11-18`, `server/app.js:74,116-126,143,214`, `server/rooms.js:16-17`, `server/stats.js:17,22,26`, `server/socket.js:90,136-138,159-166`, lockfiles + `ci.yml:24,39` as cited per finding.
- **Secrets check:** git history (4 commits through `c9afa25`) contains only `.env.example` placeholders; no key/cert files; ignored-file behavior verified.

---

## 7. Checks passed (verified controls)

1. **AuthN coverage:** `requireAuth` guards every non-anonymous REST route; the socket handshake (`io.use`) verifies the JWT once per connection and binds `socket.data.username` from the token.
2. **AuthZ gates:** `isMember`/`isAdmin` enforced on message history, `send_message`, `toggle_reaction`, `join_room`, and all member-management routes; `#general` open by explicit design.
3. **XSS rendering:** react-markdown 9.1.0 with no `rehype-raw` (raw HTML never becomes elements); default URL transform allows only http/https/irc/ircs/mailto/xmpp and neutralizes `javascript:`/`data:`/`vbscript:`; anchors get `rel="noopener noreferrer"`; **zero** occurrences of `dangerouslySetInnerHTML`/`innerHTML`/`document.write`/`eval`/`Function` in `client/src`.
4. **CSRF:** not applicable — the app sets **no cookies** anywhere; API auth is an explicit `Authorization` header, socket auth is a handshake payload.
5. **Session fixation:** not applicable — no server-side session IDs; stateless JWTs; the token is never accepted from URLs.
6. **CORS:** pinned to `CLIENT_URL` for REST and Socket.IO; no wildcard.
7. **Input validation:** username `^[a-zA-Z0-9_]{3,20}$`; password ≥ 6; message text trimmed/capped at 1000 chars; reaction emoji allowlist; room-name normalization + 30-char cap; in-memory stores capped (100 messages/room, 500 reactions).
8. **Password storage:** bcryptjs cost 10 for account and room passwords; credentials never logged.
9. **Rate limiting (partial, by design):** register/login/join failures limited (15-min window, default 20, successful requests skipped); unrated routes are recorded as leads/hardening.
10. **CI/CD:** `permissions: contents: read` for all jobs; no secrets/environments/write scopes; static action inputs; push+PR triggers only.
11. **Supply chain (sources):** all 198 resolved URLs are `registry.npmjs.org`; no alternate registries, aliases, `file:`/`git+` specifiers; scoped packages keep real scopes; lockfiles committed.
12. **Secrets hygiene:** `.gitignore` covers `.env`/`.env.local`/`.env.*.local`; history clean; DB fallback logs only error messages (never the URI).
13. **Token lifecycle:** stored token used only as header/socket auth, cleared on genuine 401, preserved on transient failures; cross-tab change triggers reload; logout clears + resets the socket; other localStorage keys are non-credential UI state.
14. **DOM surface:** SPA head loads only first-party, non-executable resources (no CDN/analytics/inline script); no production source maps configured.

---

## 8. Failed / unverified checks

- **Blocked by "no OS-enforced sandbox" (execution withheld):** every runtime-dependent step of the six leads — process-exit observation for §5.4/§5.6, token acceptance for §5.3, timing/starvation for §5.7, seeded cross-key read for §5.5, npm-install behavior for §5.8. Each has an exact bounded local plan and an owner-observable alternative (never send audit traffic to a deployment).
- **Deferred (critic-accepted, not hunted in the quick profile):**
  - `server/app.js#passwordLimiter` — express-rate-limit 8.7.1 key derivation under the default trust-proxy setting: an `X-Forwarded-For`-bearing request can make the limiter throw before any bucket increment (every register/login/join fails with 500 without consuming quota behind such a proxy), and behind an unconfigured proxy all clients share one key. Directly relevant if you front the API with Cloudflare/a proxy — keep this in mind when deploying.
  - `client/src/components/MarkdownBody.jsx#default img rendering` — react-markdown's default `img` rendering auto-loads arbitrary https images embedded in messages, disclosing each viewer's IP/User-Agent/referrer to the sender and acting as a read receipt.
- **Out of scope:** `node_modules/` installed trees and `skills-lock.json`; four companion attack-class guides excluded with source facts (no AI code; no cloud/IaC/container config; no desktop/mobile/IPC code; no memory-unsafe code).
- **Not tested by design:** your running servers and any live environment (nothing was executed or deployed); HTTPS/TLS, response headers, DNS, and edge behavior are deployment-layer facts that do not exist in this repository.

---

## 9. Remediation plan (P0–P3) — applied 2026-10-17

Small, surgical fixes. **Status (2026-10-17): applied in full and pushed to `main`.** Item → commit: 1–4 → `134d84d` (socket/REST guards, error containment, JWT fail-closed, `typing` membership gate, reactions bound to room); 5–7 → `6e12a34` (socket token buckets, extended API limiting, message-store index + Mongo stats aggregation, lockfile regeneration, `engines`/`.nvmrc`/Dependabot); 8 → `1056360`; 9 → `af905cb` (Actions SHA pinning), `e272efc` (`.env.*` ignore), `a01155a` (HS256 pinning, password caps, dummy-hash compares), `37f0359` + `e515360` (CSP/anti-framing headers, static-host `_headers`); 10 → `70db73c` (reactions persisted to MongoDB — revocation semantics unchanged and image loading kept direct, by decision); 11 → `7f03744` (`TRUST_PROXY`), plus `5dd49ab` (client toolchain upgraded to Vite 8 with a clean-room lockfile). Item 11's remaining pieces (host-specific header copy, websocket caps) are deployment decisions (§11.3 item 3). The six leads were validated in the same wave (§11.2).

**P0 — availability and core-boundary correctness (do first)**
1. Validate socket payload types at the top of each listener and add listener-level error containment; add a process-level `unhandledRejection`/`uncaughtException` handler plus supervisor restart (`server/socket.js`; `server/index.js`). *(Lead §5.6 — cheap, eliminates a plausible whole-server crash class.)*
2. Wrap the four REST handlers (or adopt a tiny async wrapper + Express error middleware) so malformed input yields 400s, not process death (`server/app.js:74,116-126,143`; error middleware before `:214`). *(Lead §5.4.)*
3. Make `JWT_SECRET` fail closed outside development: refuse to start when unset/placeholder (`server/auth.js:11-18`). *(Lead §5.3 — one-line posture fix with a high impact ceiling.)*
4. Fix the two confirmed gaps: `isMember` gate in `typing`; messageId-to-room binding + per-room reaction store (`server/socket.js:159-161,165-193`). *(Confirmed §5.1–5.2.)*

**P1 — abuse resistance and integrity preconditions**
5. Add a per-connection/per-user token bucket to socket events, especially `join_room` (stop bcrypt amplification) and `send_message` (`server/socket.js`). *(Lead §5.7.)*
6. Regenerate both lockfiles with one pinned npm/Node version so every entry carries `resolved`+`integrity`; add `engines`/`.nvmrc` and a CI `npm audit` step or Dependabot. *(Lead §5.8 + hardening 17–18.)*
7. Extend REST limiting to create/members/stats (or at least the write paths); add the compound `{room, createdAt}` index and aggregate stats in Mongo. *(Hardening 3, 7.)*

**P2 — defense in depth (small, low-risk)**
8. Single-source room canonicalization: use the normalized value for the stats query (lead §5.5) and align socket event room keys (hardening 13).
9. CSP (`script-src 'self'`) + anti-framing at the serving layer; SHA-pin GitHub Actions; extend `.gitignore` to `.env.*` (with `!.env.example`); add `algorithms:['HS256']` to `verifyToken`; password byte-cap; dummy-hash compares on login and locked-room join; keep `connectDb`'s no-URI logging. *(Hardening 6, 8, 12, 14–16, 20.)*

**P3 — product decisions**
10. Decide image-loading policy for rendered messages (block, proxy, or accept) and the reaction-store/revocation model (e.g., password rotation for rooms, token revocation if removal must be enforceable); consider per-room reaction scoping limits. *(Deferred img unit; hardening 5, 11.)*
11. When a deployment layer is chosen (possibly Cloudflare), attach: the security headers, the limiter trust-proxy configuration (deferred unit), websocket caps, and the P1 quota decisions.

---

## 10. Production-readiness verdict and limitations

**Verdict:** *Not production-ready as-is, but close to a defensible baseline for a small deployment.* The authentication and authorization architecture is sound where it is applied, XSS/CSRF/injection/secret-hygiene checks came back clean, and the confirmed gaps are low-severity, one-guard fixes. What stands between the current state and an acceptable public deployment is the P0/P1 set: contain the crash paths (§5.4/§5.6), fail the JWT secret closed (§5.3), add socket-layer quotas (§5.7), and repair lockfile integrity metadata (§5.8) — plus the one deployment fact in §5.3 and the data-state check in §5.5, which only you can observe. As a **local/demo application**, the current state is reasonable; as a **publicly reachable service**, it should not ship until P0 is done and the six leads are either validated-and-fixed or explicitly accepted with eyes open. **Post-audit update (2026-10-17):** P0 is done, the six leads were validated and fixed (three HIGH, one MEDIUM, two LOW — §11.2), and the P1 preconditions are repaired; what remains open is deliberately yours: the deployment-layer choices and the two owner-observable facts (deployment secret history, legacy room-name rows) in §11.3.

**Limitations of this audit (read before relying on any "clean" verdict):**
1. **No execution, by construction:** no OS-enforced sandbox exists on this host, so nothing was run — no server, no npm, no browser, no database, no HTTP request, no network. All runtime/deployment conclusions are `needs_validation` with exact blockers; the two confirmed records rest on complete static source paths (stated in their records). (The six leads were later validated by bounded local execution on your machine — §11.2.)
2. **Bounded pass (quick profile):** one hunter wave and one coverage critic; two accepted gaps are deferred, not searched (§8). A standard-profile run would hunt them.
3. **Scope limits:** `node_modules/`, `dist/`, `.git/`, and the audit tooling were out of scope; four attack-class families were excluded with source facts (§8).
4. **Single-review merge:** quick profile uses one fresh independent verifier per candidate (instead of the two-stage verification of the standard profile).
5. **Host adaptations:** validators run through a logic-equivalent Windows runner; agents' final results were persisted to scratch files and ingested — no semantic change.
6. **Point-in-time:** results describe commit `c9afa25` only. The working tree additionally contains `.agents/` and `skills-lock.json` (untracked; the audit tooling itself, out of scope).
7. **No live or production testing:** your running servers and any deployed environment were untouched, per your instruction. Every "next step" is a bounded, local, or owner-observed check — never audit traffic against a deployment.

---

## 11. Addendum — remediation applied and lead validation (post-audit, 2026-10-17)

### 11.1 Verification after the wave

- Server tests **29/29** (`npm test`, ephemeral ports); client `npm ci`, production build (Vite 8 / Rolldown, vendor chunks intact), `vite preview` header enforcement, and `npm audit` (**0 vulnerabilities**) all pass; `dist/_headers` is byte-identical to the pre-upgrade output.
- The audit skill's own validators pass on the updated run artifacts: **`coverage-ledger` PASS, `findings` PASS** — `findings.json` now holds **8 confirmed records, 0 needs_validation, 0 rejected**.
- The item-by-item commit list is in §9; every commit is pushed to `main` (`c9afa25` → `5dd49ab`).

### 11.2 Lead validation (bounded local execution, owner-approved)

Each fixture ran against a scratch copy of `c9afa25` (with fixed-tree controls) on loopback ephemeral ports with dummy data and `MONGO_URI` empty; your running servers were never touched.

| § | Lead | Demonstrated result | Severity | Fixed in |
|---|---|---|---|---|
| 5.3 | JWT fallback | Forged token (public literal) authenticated as the victim (`/api/me` 200, `/api/rooms` 200); with a real secret set → 401; current tree fails closed in production | **HIGH** | `134d84d` |
| 5.4 | REST crash | All 4 malformed requests killed the baseline (`exit 0xC0000409`; TypeErrors at `rooms.js:17`, `app.js:74`, `app.js:143`); fixed tree survives with 4xx/5xx | **HIGH** | `134d84d` |
| 5.5 | Stats raw-vs-normalized | Seeded key: same member received counts for `?room=Team Room!`, empty for `?room=team-room`; fixed tree canonicalizes both | LOW | `1056360` |
| 5.6 | Socket malformed events | 6/6 variants killed the baseline; 6/6 inert (survival, exit 0) after the fix | **HIGH** | `134d84d` |
| 5.7 | Socket rate limit absent | 50/50 burst events processed through cost-10 bcrypt on the baseline; fixed tree admitted the 5-event burst allowance only | MEDIUM | `6e12a34` |
| 5.8 | Lockfile metadata | Recount: 159 entries missing at `c9afa25`; 0 missing after regeneration | LOW | `6e12a34` / `5dd49ab` |

Exact commands, outputs, and controls are recorded in the run's `findings.json` `execution` blocks. Severity method: likelihood × demonstrated impact, overall ≤ impact (the skill's rule); the three HIGH ratings rest on a demonstrated full authentication bypass or whole-process kill, with open registration making the triggering account one free request away.

### 11.3 Owner-observable residue (the only open items)

1. **Deployment secret history (§5.3):** if any instance ever ran without `JWT_SECRET` before `134d84d`, tokens forged with `dev-secret-change-me` were accepted for any account — rotate that instance's secret (this invalidates outstanding tokens) and treat sessions issued before the fix as untrustworthy. After deploying the fix, a production start with no secret refuses to run — that is the "closed" state to verify in startup logs. (The dev-mode warned fallback is retained by design.)
2. **Legacy room-name rows (§5.5):** read-only check — compare `Message.distinct('room')` (and `Room.distinct('name')`) against `normalizeRoomName` output. Only pre-fix or out-of-band rows can differ; no security migration is required, but normalizing them (or acknowledging them) settles the stats-consistency question.
3. **Deployment-layer decisions (§9 item 11):** pick the host — Cloudflare Pages / Netlify consume the generated `dist/_headers` as-is; a Vercel deployment needs the same header block copied into `vercel.json` with the real API origin (deferred until a target and a real `VITE_SERVER_URL` exist); set `TRUST_PROXY` to match the chosen proxy; apply websocket caps at the edge.
4. **Persistence reminder:** set `MONGO_URI` on the server host for durable data; without it the app intentionally uses in-memory stores that reset on restart.

No audit traffic should be sent to any deployment to close these items; every check above is read-only or local.
