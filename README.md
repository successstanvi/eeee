# WePlay UID Lookup API — Vercel (Node.js)

This version replaces Python + Selenium with Node.js + Puppeteer Core and the
`@sparticuz/chromium` package. Chromium is supplied as an npm dependency, so
there is no separate browser account and no Playwright browser-download command
during the install step.

## GitHub root layout

- `README.md`
- `api/index.js`
- `package.json`
- `vercel.json`

## Deploy

1. Upload these files to the repository (keep the `api` folder).
2. Import the repository into Vercel.
3. Select Node.js; Vercel installs dependencies from `package.json`.
4. Deploy and check `/health`.
5. Test `/lookup?uid=92661060`.

## Endpoints

- `GET /health`
- `GET /lookup?uid=92661060`
- `POST /lookup` with JSON `{"uid":"92661060"}`

## Performance / limits

Node.js avoids Python/Selenium startup and dependency setup overhead, and the
handler blocks images, fonts, media and common analytics requests. The actual
lookup still launches Chromium and loads WePlay, so it cannot be instantaneous.
Vercel's function bundle size, memory, runtime and plan-specific duration limits
may still affect deployment. This package has not been deployed against your
Vercel account; inspect build and runtime logs if it fails. WePlay can change its
page selectors or block automation. Add authentication and rate limiting before
making this endpoint public.
