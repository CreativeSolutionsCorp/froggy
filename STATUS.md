# Status

Updated: 2026-11-12

## Phase 1: Project setup

- [x] Created Expo SDK 58 blank TypeScript client in `app/`.
- [x] Initialized one Git repository at the workspace root; removed the generated nested app repository.
- [x] Added npm workspaces for `app/` and `server/`.
- [x] Added root ignore rules, package scripts, strict server TypeScript config, and app strict TypeScript config.
- [x] Added README and environment examples. Real `.env` files contain blank values and are ignored by Git.
- [x] Installed all project dependencies and ran lint, typecheck, and tests for both packages.

Verification results:

- Commands run successfully: `source "$HOME/.nvm/nvm.sh" && cd /home/jsb32479/new && npm run lint && npm run typecheck && npm run test`
- Result: all workspace lint checks passed, both package typechecks passed, and both Jest suites passed.
- App tests: 1 suite passed, 1 test passed.
- Server tests: 1 suite passed, 1 test passed.
- The initial environment lacked a Node/npm installation, so Node 22 was installed via nvm before dependency installation and validation.
- Expo Camera's current official SDK 58 documentation confirms Android support, permission handling, and JPEG base64 capture. Expo development builds support native modules and require `expo-dev-client` for the local workflow.

## Phase 2: Backend proxy

- [x] Added the server request/validation layer, auth checks, rate limiting, health checks, and basic briefing/coaching endpoints.
- [x] Added AI response schema validation and prompt builders.
- [x] Added a live Anthropic client wrapper with JSON extraction, validation, and retry handling for transient provider failures.
- [x] Added market-math and position-sizing modules with unit tests.
- [ ] NOT VERIFIED: the real Anthropic provider request path remains unverified because no live API call was executed from this environment.

## Phase 3: Data layer and risk math

- [x] Added a Polygon client with typed failures for rate limits, HTTP errors, empty results, and plan-restricted responses.
- [x] Added a pure risk-math module covering gap, ATR, average volume, relative volume, prior-day range, pivot levels, and simple moving averages.
- [x] Added position sizing logic and stop-loss proposal helpers with validation for invalid trade inputs.
- [x] Added hand-calculated unit tests for the formulas and edge cases.

## Phase 4: Data-backed briefings

- [x] `/api/briefing` now requires Polygon and Anthropic credentials and requests a previous-day Polygon aggregate before calling Claude.
- [x] Missing credentials, Polygon auth/plan errors, Anthropic auth failures, and malformed Claude output return explicit HTTP error codes.
- [x] Briefing schema rejects missing/zero setup levels and requires at least one complete setup.
- [x] The app shows server error text, validates successful responses before persistence, and filters invalid saved history.
- [x] Startup logs only yes/no credential presence; local server startup loads `server/.env` without printing values.
- [x] EAS Android preview build completed: `c17a49b6-1368-4da2-a231-a32837b6205a`.
- [ ] NOT VERIFIED: a real Polygon-plus-Claude `/api/briefing` call has not been executed; rotate the local provider credentials before live verification.
- [ ] NOT VERIFIED: the updated APK has not been installed; camera/live workflow has not been run on-device.

Verification results:

- Commands run successfully: `source "$HOME/.nvm/nvm.sh" && cd /home/jsb32479/new && npm run lint && npm run typecheck && npm test`
- Result: both workspaces passed lint and typecheck; app tests passed (1 suite, 3 tests); server tests passed (6 suites, 34 tests).
- Provider-call contract tests use injected fake clients; they verify request construction, successful response shape, error codes, and rejection of missing/zero setup levels.
- Zero defaults remain in the legacy quote display/endpoint and standalone empty-input math helpers; they are not used by `/api/briefing`.
- No live provider output or on-device behavior is claimed as verified.

## Environment notes

- Provider keys must remain server-side and must never be bundled into the Expo app.
- The new Android APK still requires a device install/run to verify the mobile workflow.
- Live Polygon and Anthropic calls remain NOT VERIFIED until credentials are rotated and a real request succeeds.
- This repository intentionally has no brokerage integration and contains no generated market or model data.
