# Watch List

> Pre-release `0.0.19` — core functionality works and is covered by the
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
necroave/watch-list:0.0.19` in `docker-compose.yml`):

```bash
docker run -d --name watch-list -p 3000:3000 \
  -v watch-list-data:/data \
  -e SESSION_SECRET="$(openssl rand -hex 32)" \
  -e ALLOW_REGISTRATIONS=false \
  necroave/watch-list:0.0.19
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
- **Metadata fetch, no API keys**: native APIs for aniliberty.top,
  myanimelist.net (via Jikan), shikimori.one/.io, and anilist.co; Open
  Graph/meta-tag scraping for any other site (imdb.com, kinopoisk.ru, …),
  with cleanup of typical title noise. Anti-bot/captcha pages are detected
  and never saved as data — you're asked for a manual title instead.
- **Duplicate detection** by exact source link and by fuzzy title match —
  asks for confirmation rather than blocking the add outright.
- Status (Planned → Watching → Watched/Dropped), a 1–10 rating, and a note
  — saved instantly on change. **Genres** as an editable chip/dropdown with
  suggestions from the rest of the list.
- **"🔄 Refetch"** re-pulls title/description/genres/cover from the source
  link at any time.
- Grid or table view, full-text search, sort by title or date — remembered per browser.
- **Covers are downloaded and stored locally**, so a card never depends on
  the source site staying up. Mismatched aspect ratios get a blurred
  background fill instead of a hard crop; click any cover to view it fullscreen.
- Creation/update dates shown on every view (entry page, grid, table).
- **Lists** (📁) — independent named sub-collections per account (up to
  128), each with its own backup export/import, for organizing or sharing a
  subset of titles. One un-deletable "Main" list always exists.
- **Settings** (⚙️): light/dark/system theme, RU/EN interface language,
  gzipped-JSON backup that merges rather than replaces.

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
