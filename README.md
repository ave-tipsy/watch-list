# Watch List

> Pre-release `0.0.23` — core functionality works and is covered by the
> test cases below, but the project isn't considered stable yet.

A self-hosted tracker for things you plan to watch, read, or come back to.
Paste any link and it fetches the title, description, cover, and genres —
works with anything that has Open Graph tags, plus deeper support for a few
anime databases.

## Quick start

```bash
docker compose up -d --build
```

Or the prebuilt image (swap `build: .` for `image:
necroave/watch-list:0.0.23` in `docker-compose.yml`):

```bash
docker run -d --name watch-list -p 3000:3000 \
  -v watch-list-data:/data \
  -e SESSION_SECRET="$(openssl rand -hex 32)" \
  -e ALLOW_REGISTRATIONS=false \
  necroave/watch-list:0.0.23
```

Open `http://localhost:3000`. Data (SQLite) lives in the `watch-list-data`
volume and survives rebuilds/restarts.

Synology (Container Manager): use
[docker-compose.synology.yml](docker-compose.synology.yml) — pulls the
image instead of building, stores data in `./data` next to the file.

Set `SESSION_SECRET` to a random string before running in production
(`openssl rand -hex 32`), or just leave it unset — the server generates and
persists one on first run.

Want a native Windows app instead of Docker? See [electron/](electron/).

## Environment variables

All optional — a garbage or non-numeric value falls back to the default.

| Variable | Default | Description |
|---|---|---|
| `ALLOW_REGISTRATIONS` | `false` | `false` — single-user, no login. `true` — multi-user, registration/login, one set of lists per account. |
| `SESSION_SECRET` | auto | Session cookie secret. Auto-generated and persisted next to the DB if unset — set explicitly only for a known/shared secret, always random. |
| `PORT` | `3000` | Port the server listens on; also used for the compose port mapping. |
| `DB_PATH` | `/data/watchlist.db` | SQLite file path. |
| `HTTPS` | `false` | `true` enables HTTPS if `SSL_CERT_PATH`/`SSL_KEY_PATH` are set and readable; otherwise falls back to http. |
| `SSL_CERT_PATH` / `SSL_KEY_PATH` | — | Certificate/key paths, used with `HTTPS=true`. |
| `MAX_COVER_UPLOAD_MB` | `10` | Max size for a cover uploaded from disk. |
| `MAX_COVER_FETCH_MB` | `20` | Max size for a cover downloaded from a link. |
| `MAX_BACKUP_MB` | `100` | Max size for an uploaded backup file. |
| `SESSION_MAX_AGE_DAYS` | `30` | Session cookie lifetime. |
| `FETCH_TIMEOUT_MS` | `8000` | Timeout for metadata/cover source requests. |
| `LOGIN_MAX_ATTEMPTS` / `LOGIN_WINDOW_MINUTES` | `10` / `10` | Failed logins per IP before rate-limiting, and the window (minutes) — multi-user mode only. |

## Features

- **Add by link or by name** — one field, the app figures out which.
- **Metadata fetch, no API keys**: native APIs for myanimelist.net (via
  Jikan), shikimori.one/.io, and anilist.co. For aniliberty.top, title/
  description/cover come from the release page's own Open Graph tags (its
  search API can't be queried by exact alias and used to mix up similar
  seasons/spin-offs), with the API used only to fetch genres. Any other
  site (imdb.com, kinopoisk.ru, …) falls back to Open Graph/meta-tag
  scraping, with cleanup of typical title noise. Anti-bot/captcha pages are
  detected and never saved as data — you're asked for a manual title instead.
- **Duplicate detection** by exact source link and by fuzzy title match —
  asks for confirmation rather than blocking the add outright, showing the
  resolved title being added alongside the existing similar one.
- Status (Planned → Watching → Watched/Dropped), a 1–10 rating, and a note
  — saved instantly on change. **Genres** as an editable chip/dropdown with
  suggestions from the rest of the list.
- **"🔄 Refetch"** re-pulls title/description/genres/cover from the source
  link at any time.
- A dropped connection or timeout to the source site retries once after a
  short pause before giving up — some sites (AniLibria's anti-DDoS
  protection, for one) hiccup occasionally. If fetching still fails, the
  real cause (network error, SSRF block, the source site's actual HTTP
  status, anti-bot detection) is logged to the container's stdout instead
  of being swallowed silently.
- Full-text search lives in the header next to the list switcher (with a
  one-click clear button), so its position never shifts as tabs/buttons
  change below it. Grid or table view, sort by title, date, or rating —
  remembered per browser; unrated titles always sort as lowest.
- **Covers are downloaded and stored locally**, so a card never depends on
  the source site staying up. Mismatched aspect ratios get a blurred
  background fill instead of a hard crop; click any cover to view it fullscreen.
- Creation/update dates shown on every view (entry page, grid, table).
- **Lists** (📁) — independent named sub-collections per account (up to
  128, up to 50 characters each — ellipsized in the header if longer, full
  name in a tooltip), each with its own backup export/import, for
  organizing or sharing a subset of titles. One un-deletable "Main" list
  always exists.
- **Settings** (⚙️): light/dark/system theme, RU/EN interface language,
  gzipped-JSON backup that merges rather than replaces.
- The running version is shown in small text under "Watch List" in the
  header.

## Security

- SSRF protection on every user-entered link: only http/https, private/
  local/link-local addresses blocked, re-checked through redirects and after DNS resolution.
- Strict CSP (no `unsafe-inline`), plus the standard clickjacking/sniffing/referrer headers.
- `SameSite=Lax` + `HttpOnly` session cookie; length limits on all input (see `src/limits.js`).
- Login rate-limiting in multi-user mode (10 attempts / 10 min per IP by default).
- Every entry/list is scoped to its owner at the query level — no cross-account access by id.
- Event logs go only to stdout (`docker logs`), no page-view logging, no log
  files on disk. The Electron build produces no logs at all.

## Known limitations

- Sessions are in-memory (multi-user mode) — a container restart logs everyone out.
- The old **anilibria.tv** domain is dead; use **aniliberty.top**.
- **Some AniLibria releases are unreachable from inside a Docker
  container**, even though the same request works fine outside one. This
  isn't a bug in this app: Docker containers have no IPv6 by default
  (IPv4 only), and aniliberty.top's IPv4 and IPv6 edges on Cloudflare lead
  to different backends — IPv4 sometimes redirects to a www mirror
  (fronted by a different provider, DDoS-Guard) that's simply missing
  some releases, while IPv6 goes straight to the full origin. Confirmed
  experimentally: the exact same request from the exact same IP gives a
  different result depending on whether it goes out over IPv4 or IPv6 —
  a mismatch on Cloudflare/AniLibria's side, not something a host/retry
  fallback in this app can fix. The (unreliable, ISP-dependent) workaround
  is giving the Docker daemon real IPv6 connectivity.
- Kinopoisk and sometimes IMDb block automated requests, falling back to manual entry.
- A site with no dedicated provider and no usable og tags needs a manual title.
- Requires JavaScript (add dialog, view/sort toggles, search).

## Development

```bash
npm install
npm run dev
```

Serves on port 3000, DB at `./data/watchlist.db`.

## More

- Test cases: [testcases.md](testcases.md)
- Windows desktop build (Electron), with instructions and prebuilt distributables: [electron/](electron/)
- Icons: [Twemoji](https://github.com/jdecked/twemoji) (CC-BY 4.0) — see [src/public/emoji/README.md](src/public/emoji/README.md)
