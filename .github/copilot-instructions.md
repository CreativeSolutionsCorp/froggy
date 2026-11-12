# Repository Instructions

- Keep TypeScript strict in both packages.
- Never add brokerage connectivity, order placement, or trading automation.
- Keep provider credentials in `server/.env`; never expose them to the Expo bundle.
- Treat AI results as analysis, not financial advice. Include reasoning and the exact source data for each suggestion.
- Never invent provider endpoints, response fields, package APIs, model IDs, or market data. Verify integrations against official documentation or installed package sources; record unsupported features in `STATUS.md` instead of mocking them.
- Verify Expo APIs against the installed SDK documentation and market/AI interfaces against official provider documentation before changing integrations.
- Use SDK-compatible Expo modules and a development build for native functionality. Store the app access token in SecureStore and non-secret settings/briefings in AsyncStorage.
- Run lint, typecheck, and Jest tests for both workspaces after each phase, and record the actual results in `STATUS.md`.
