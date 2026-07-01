---
Project: workspace-mgr
Created: 2026-06-30 22:09
Modified: 
Status: Open
Note:
---
# Concept
## Purpose
- Create new plugin based on https://github.com/s1m4ne/obsidian-workspace-plus with code that is modern and easily maintainable
- Optimize code for security, efficiency, reliability, redundancy, and other criteria common for software reliability & security 

## Scope
Platforms: Obsidian
User base: public
Distribution: Github, public, MIT license

## Features
Identical to current plugin with adjustments below:
- Change where plugin stores session data from `~/{vault}.workspace-plus-plus/sessions.json` to `{vault}/.obsidian/plugins/workspace-mgr/sessions
- In plugin settings provide an option to select color (via color picker) for session name in status bar (`.status-bar .status-bar-item .wpp-status-name`)
- Implement changes identified in previous Claude & Gemini sessions, see Assessment of current plugin section below
- Push new plugin to https://github.com/jsglazer/workspace-mgr
	- Create README based on obsidian-workspace-plus README
	- Note that my new plugin is derived from obsidian-workspace-plus 
	- Create MIT license

## Reference projects
https://github.com/s1m4ne/obsidian-workspace-plus

## AI Concept Review
### AI Interview

#### Captured concept
- **Purpose**: Create a modern, maintainable, secure, and reliable Obsidian workspace management plugin based on `obsidian-workspace-plus` that solves the manual syncing limitation of the original plugin.
- **Scope**:
  - **Platforms**: Obsidian (both Desktop and Mobile).
  - **User base**: Public.
  - **Distribution**: GitHub (https://github.com/jsglazer/workspace-mgr) under the MIT License, with a README derived from `obsidian-workspace-plus`.
- **Must-have Core (v1)**:
  - Replicate the full feature set of `obsidian-workspace-plus` exactly.
  - Relocate the session storage path to `{vault}/.obsidian/plugins/workspace-mgr/sessions/` to allow automatic syncing via native Obsidian Sync.
  - Add a plugin settings option with a color picker to customize the session name color in the status bar (targeting CSS selector `.status-bar .status-bar-item .wpp-status-name`).
  - Ensure the plugin loads at least as fast as the incumbent, with zero data loss or sync conflicts.
- **Nice-to-have**: Proactively optimized JSON session storage format determined by efficiency and performance benchmarks.
- **Non-goals**: No new/custom features outside the replicated original feature set and the specified storage/color changes.
- **Proposed Language/Runtime**: TypeScript (using Obsidian plugin API, ES6+ features), linted with ESLint/Prettier, and built using esbuild.

#### Reference leads
- `obsidian-workspace-plus` (https://github.com/s1m4ne/obsidian-workspace-plus)

#### Handoff to audit
The project aims to replicate `obsidian-workspace-plus` on desktop and mobile, migrating storage to `{vault}/.obsidian/plugins/workspace-mgr/sessions/` to resolve the current manual sync pain under native Obsidian Sync. The audit should focus on:
1. **Storage Architecture**: Determine whether a single combined JSON file or individual session files inside the `sessions/` directory is more efficient, faster, and conflict-free under native Obsidian Sync.
2. **Modernization Path**: Propose a structured approach to transition the ~5,600 lines of ES5-transpiled prototype JS code into modern, clean TypeScript, ensuring the 83 existing unit tests are migrated or adapted to guarantee identical behavior.
3. **Data Integrity & Speed**: Ensure file writes/reads on both desktop and mobile are fully atomic and performant to meet the developer's "zero data loss" and "instant load" criteria.

### AI Audit

### Verdict
- **Feasibility (solo, local-first):** High
- **Automated-testability:** Hybrid — Core business logic and multi-file storage synchronization are 100% headless testable; UI overlays and native Obsidian workspace layout operations require manual visual QA.
- **Recommendation:** Build new project
- **Single biggest risk:** Race conditions and file lock contentions when multiple devices running native Obsidian Sync modify and write to the same metadata/session index concurrently.
- **Confidence:** High — The reference repository has been fully cloned and audited, and a transition to a multi-file session storage structure directly addresses the primary sync limitation.

### 1. Prior Art & Repo Alignment
- The exact feature set of `obsidian-workspace-plus` (Workspace++) will be replicated. However, the storage architecture will be redesigned to resolve the manual sync limitation. [VERIFIED via source code audit and web search]
- Build new project. There is no existing repository under the developer's Obsidian plugins that is adjacent; this will be pushed to the new repository [workspace-mgr](https://github.com/jsglazer/workspace-mgr).

### 2. High-Risk Technical Hurdles
- **Hardest challenge:** Designing a conflict-free sync merge algorithm for the session list order and active session ID. If two devices modify the active session or order concurrently, the plugin must resolve this gracefully without deleting sessions or getting stuck in reload loops.
- **Brittle surface:** Obsidian's layout serialization/deserialization (`app.workspace.getLayout()` / `app.workspace.changeLayout()`) is not part of the stable public API and can produce device-specific UI states. Synced workspace layouts must be loaded defensively to prevent rendering errors on different form factors (e.g., Desktop vs. Mobile).
- **Latency & Mobile I/O:** Frequent auto-saving of layouts can cause disk I/O bottlenecks. Writing large layout JSONs on mobile devices can cause frame drops and lag unless writes are debounced and performed asynchronously.

### 3. Testability & Automation (critical)
- **Hardest to mock/isolate:** Obsidian's actual `Workspace` layout rendering and window focus events. These depend on the Electron/mobile runtime and cannot be tested headlessly.
- **Headless verdict:** ~85% of the codebase can be verified via headless unit tests (including all session CRUD, file persistence, sync merge strategies, and settings state). The remaining ~15% (overlay switcher views, status bar DOM color elements, and actual layout restoration) requires manual visual QA.
- **Sandbox hazards:** Writing tests that manipulate actual vault config directories. All test runs must be isolated to memory-based mocks or temporary directories to avoid polluting the host Obsidian vault.

### 4. Forward Constraints (feeds the pipeline)
- **Builder constraints (for Opus 4.8):**
  - **Multi-File Storage Schema:** Partition session storage: save individual sessions to `{vault}/.obsidian/plugins/workspace-mgr/sessions/{session_id}.json` and the session index to `sessions/manifest.json`.
  - **Auto-Discovery Scan:** On startup, scan the `sessions/` directory for any session JSON files not registered in `manifest.json` (e.g., newly synced from another device) and auto-merge them into the index.
  - **Composition Design:** Do not patch the plugin prototype dynamically. Implement strict composition: isolate operations into typed classes (`SessionService`, `PersistenceService`, `SwitcherOverlay`) injected with the plugin instance.
  - **Serialization & Queueing:** Implement a promise queue to serialize all filesystem writes, preventing concurrent file writes from interleaving.
- **Deterministic test requirements (the backstop):**
  - **Auto-Merge Unit Tests:** Unit tests verifying that orphan files found in the `sessions/` directory are correctly reconstructed into the session list.
  - **Sync Merging Logic:** Headless unit tests verifying the merge behavior when local and external session modified timestamps differ.
  - **Debounce Timer Tests:** Unit tests verifying that rapid save invocations within the debounce window result in exactly one file write.
- **Reviewer criteria (for Gemini Flash, enforced by reading):**
  - **Read-Check:** Confirm that the core session business logic contains zero imports from the `obsidian` module to keep it fully unit-testable.
  - **Read-Check:** Verify that all DOM elements created by overlays register their event listeners using Obsidian's auto-cleanup registry (`registerDomEvent`) or implement a robust cleanup process on unload.
  - **Read-Check:** Confirm that no filesystem operations write outside of `{vault}/.obsidian/plugins/workspace-mgr/`.

### 5. Complementary Features
- **Duplicate-on-Conflict Rename:** If a session file has a newer modified time but has diverging changes, duplicate it and append `(Conflict - <Timestamp>)` instead of silently overwriting.
- **Dynamic CSS Registration:** Inject settings-controlled status bar colors using Obsidian's `registerAndAddStyle` utility, avoiding manual DOM queries.

### Machine-readable constraints (mandatory)

<!-- PIPELINE-CONSTRAINTS:BEGIN -->
```yaml
recommendation: "Build new project"
feasibility: "High"
hurdles:
  - "Designing a conflict-free sync merge algorithm for the session list order and active session ID when modified concurrently on multiple devices."
  - "Obsidian's layout serialization/deserialization is unstable and device-specific, which can cause layout corruption when synced between desktop and mobile."
  - "Disk I/O latency on mobile devices during frequent workspace layout auto-saves, which can cause UI lag if not debounced."
builder_constraints:
  - "Store sessions in individual files: {vault}/.obsidian/plugins/workspace-mgr/sessions/{session_id}.json, and session indices in sessions/manifest.json."
  - "Perform a directory scan on startup to discover and auto-merge orphan session files not registered in manifest.json."
  - "Avoid prototype patching; use strict composition with isolated typed classes (SessionService, PersistenceService) injected with the plugin instance."
  - "Queue all file writes through a Promise-based serialization queue to prevent overlapping write operations."
deterministic_tests:
  - "Unit-test the directory scanner to verify it auto-merges unregistered session files."
  - "Unit-test the sync merge logic for conflicting modified timestamps of local/external sessions."
  - "Unit-test the write queue and debounce timer using fake timers."
reviewer_criteria:
  - "Confirm zero obsidian module imports in core session management and merge business logic."
  - "Verify all DOM event listeners in overlays utilize Obsidian's registerDomEvent or are manually cleaned up on unload."
  - "Confirm no filesystem writes bypass PersistenceService or write outside the plugin's vault directory."
```
<!-- PIPELINE-CONSTRAINTS:END -->

---
# Architecture
Languages: 

# Assessment of current plugin
## Claude
**Verdict: Functionally solid and well-tested, but the source code style is not modern — it's hand-written in an ES5 idiom despite using a modern build pipeline.**

**What's good (modern/optimized):**
- Build tooling: esbuild bundler, tree-shaking enabled, correctly externalizes Obsidian/CodeMirror/Electron.
- Testing: 83 passing tests using Node's native `node:test` runner (no Jest/Mocha bloat). Good coverage across session CRUD, sync, status bar, settings.
- Zero `innerHTML`/`outerHTML` usage anywhere — avoids the #1 Obsidian plugin review rejection reason (XSS risk).
- Modular structure: ~17 separate `plugin/methods/*.js` files mixed into the prototype rather than one giant class.
- Document-level event listeners (drag, search overlay) correctly paired with cleanup.
- CI has provenance attestation (`attest-build-provenance`) on releases.

**What's not modern / could be optimized:**
1. Zero ES6+ syntax in ~5,600 lines of source: no `class`, no `let`/`const` (1,373 `var` declarations), no arrow functions, no `async`/`await`, no template literals. Code is written in a hand-rolled TypeScript-ES5-transpiler-output style (`_super`/prototype pattern), even though esbuild targets `es2018` which fully supports all of those features.
2. Heavy Promise-chaining instead of async/await: `persistence.js` alone has 62 `.then()` calls across 968 lines.
3. Two monolithic files: `overlays.js` (1,385 lines) and `persistence.js` (968 lines).
4. Heavy raw `addEventListener` use (79 calls) vs `registerDomEvent` (2 calls) — bypasses Obsidian's recommended auto-cleanup idiom, though not necessarily leaking since most are scoped to destroyed overlay elements.
5. No lint/format tooling (no ESLint, Prettier, tsconfig) and CI doesn't run the test suite — `release.yml` only builds and publishes on tag push; the 83 tests aren't gating merges.
6. One moderate `npm audit` finding: esbuild ≤0.24.2 has a known dev-server request-forwarding advisory (dev-only dependency, low real-world risk).
7. Plain JS rather than TypeScript — no compile-time type safety across a dozen interacting `plugin/methods/*.js` files that mutate shared plugin state.

## Gemini
- **ES5 Prototype Architecture**: Built entirely in legacy ES5 JavaScript using prototypes, CommonJS module systems (`require`/`module.exports`), and variables (`var`), rather than modern ES6+ features (`const`/`let`, arrow functions, `class`, or ES import/export modules). No TypeScript compiler is used, lacking static typing.
- **Monolithic Language Dictionaries**: Utilizes a single static `i18n.js` file exceeding 7,600 lines (~670 KB) to store all language translations, which harms maintainability.
- **Dynamic Prototype Extension**: Dynamically patches the central class prototype by passing it to `attachPluginMethods(WorkspacePlusPlus)`, injecting methods dynamically at runtime, which obfuscates function definition paths and hinders clean unit testing.
- **Sync Architecture Conflict**: Uses `.workspace-plus-plus/sessions.json` at the vault root, causing silent sync failures under native Obsidian Sync.
