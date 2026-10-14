# Browser smoke checks

The three Chromium tests load the built, unchanged App at `/#chat`. They exercise real React components and hooks with a mocked signed-in account, text execution completion, failed image jobs, an authoritative blocked wallet, wallet recovery, preserved draft input and a subsequent text send. No test harness replaces the product components.

All API responses come from Playwright routes. Unknown APIs and external origins are aborted; no model, payment, OSS or live backend is contacted. Requests are counted to reject duplicate image/text submissions. The local preview uses a closed backend destination as an additional boundary, and existing servers are never reused.

Run `node e2e/run-unit-tests.mjs`, `npm run build`, `npx playwright install chromium` and `npm run test:e2e`. Set `PLAYWRIGHT_BROWSERS_PATH` to a writable workspace directory when installing and running; the default runner path is `.migration/playwright-browsers`. CI uses Node 24, `npm ci`, all discovered `test:*` scripts except the separately invoked browser runner, production build and Chromium.

These checks validate browser recovery using mocked authoritative wallet/job responses. They do not validate real login credentials, provider settlement, SSE longevity, database migration or live deployment. The two failure cases cover a definite provider refusal and an unknown outcome awaiting reconciliation, both represented by the backend's terminal FAILED image job plus wallet state.
