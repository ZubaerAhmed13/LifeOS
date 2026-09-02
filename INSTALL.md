# LifeOS 4.5 — Rules, Automation & Planning Policies

## Run locally

Serve this directory over HTTP(S). For example:

```bash
python3 -m http.server 4173
```

Then open `http://localhost:4173/`.

## Static hosting

Upload the complete directory without changing relative file paths. GitHub Pages, Netlify, Cloudflare Pages, or another static host can serve it.

## Release identity

- App: 4.5.0
- Rule Engine: 4.5.0
- Rule schema: 1
- Intelligence Model: 4.4.2
- Calendar Engine: 4.3.0
- Forecast Model: 4.2.0
- Scheduler: 4.1.0
- Database schema: 16

## Rules execution model

LifeOS Rules are structured, deterministic, local-first domain rules. They do not execute arbitrary JavaScript, call remote automation services, or add telemetry.

Rules requiring application execution are evaluated while LifeOS is active or at the next supported application refresh. LifeOS does not claim guaranteed exact-time background execution while the browser or installed PWA is fully closed.

High-impact actions remain subject to the existing LifeOS domain engines, hard-constraint validation, execution policy, cross-tab locking, stale-revision protection, audit history, and confirmation where required.

## Standalone build

`LifeOS_4_5_Rules_Automation_Standalone.html` contains the same application CSS/JS logic as the release PWA. The release build verifies the embedded application source hash against `app.js` before certification artifacts are produced.
