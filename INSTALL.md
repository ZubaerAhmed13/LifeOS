# LifeOS 4.0 Professional Core — PWA installation

This is the production release package for application version **4.0.0**. The service-worker cache build is **pwa1**; it is an application-shell cache identifier, not a second product version.

1. Serve this folder over HTTPS, or from `http://localhost` during local testing.
2. Open `index.html` in a browser with service-worker support.
3. Use the browser's **Install app** or **Add to Home Screen** action where available.
4. Keep normal LifeOS JSON backups. Browser/site-data controls can remove local IndexedDB data.

For GitHub Pages, publish the contents of this folder without changing the relative paths. LifeOS uses hash/local-state navigation and does not require server-side route rewriting.

When a new service worker is installed, LifeOS shows an update notification. Choosing **Update** creates a protected pre-update snapshot, sends `SKIP_WAITING`, waits for the new controller and reloads. IndexedDB records are never stored in Cache Storage.

Security note: JavaScript is fully externalized and the hosted Content Security Policy uses `script-src 'self'`. The current calendar and progress rendering still uses a limited set of inline geometry styles, so `style-src 'self' 'unsafe-inline'` remains necessary for this 4.0 release candidate.
