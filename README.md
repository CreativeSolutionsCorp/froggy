# Market Coach

A personal Android research assistant for market analysis. It does not place trades and has no brokerage integration. AI output is analysis, not financial advice.

## Structure

- `app/`: Expo React Native client, built as an Android development build.
- `server/`: Express proxy for market data and Anthropic requests.

## Local setup

1. Copy `app/.env.example` to `app/.env` and set `SERVER_URL` to the reachable proxy URL. The mobile app asks for the shared token in Settings and stores it with Expo SecureStore; the token is not embedded in the bundle.
2. Copy `server/.env.example` to `server/.env` and set `POLYGON_API_KEY`, `ANTHROPIC_API_KEY`, and `SHARED_APP_TOKEN`.
3. Install dependencies from the repository root with `npm install`.
4. Start the proxy with `npm run start:server` and the Expo development client with `npm start`.
5. Build/install the Android development client with `npm run android` on a machine configured with Android Studio/SDK, or use an EAS development build.

The provider credentials are server-only. `SERVER_URL` is public configuration, not a secret. The shared app token is a personal-use access control, not a substitute for user authentication on an internet-facing deployment.

## Safety and acceptance checklist

- [ ] No brokerage SDK, order route, or trade automation exists anywhere in the app or server.
- [ ] All provider keys stay in `server/.env`; the Expo bundle does not include them.
- [ ] Briefing and coaching outputs include a disclaimer that the analysis is not financial advice.
- [ ] The app and server can run without exposing private credentials outside the backend.
- [ ] The local smoke test reaches `/health` on the Express server and responds with `{ "ok": true }`.

## Smoke test

Run the quick end-to-end server check from the repo root:

```bash
chmod +x scripts/e2e-smoke.sh
./scripts/e2e-smoke.sh
```

## Checks

Run `npm run lint`, `npm run typecheck`, and `npm test` from the root. Package-specific scripts are available from `app/` and `server/`.
