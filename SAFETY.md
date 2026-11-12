# Safety and usage policy

## Scope

Market Coach is a personal market research app. It is designed to analyze market structure, risk, and sentiment. It does not place orders, trade automatically, or connect to any brokerage account.

## Hard constraints

- No brokerage connectivity or order placement flows are included in the app or server.
- No automated trading automation is allowed anywhere in the repository.
- AI output is analysis support only and must not be presented as financial advice.
- Provider API keys stay in `server/.env` and never in the Expo app bundle or public configuration.
- The shared app token is used only for local personal access control and not as an authentication substitute for internet exposure.

## Data handling

- Public, non-secret configuration such as `SERVER_URL` may live in client config.
- Secret provider credentials remain on the server process only.
- Images captured from the camera are treated as optional local artifacts and are not sent anywhere without an explicit user action in the app flow.

## Risk communication

- The app should label all model output as research and analysis only.
- Every briefing and live coach response includes a disclaimer indicating that the output is not financial advice.
- Risk signals and stop/target suggestions are examples for research discussion only; they are not trade recommendations.

## Acceptance checks

- Confirm there is no brokerage SDK, webhook, or order route in the app or server.
- Confirm provider credentials remain server-side.
- Confirm model output includes a non-financial-advice disclaimer.
- Confirm local builds do not bundle secrets or tokens into the Expo package.
