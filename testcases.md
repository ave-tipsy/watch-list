# Watch List test cases

Manual test cases for the application. Each case: **Steps** → **Expected result**.
IDs follow the pattern `TC-<section>-<number>`.

Before running section 1 (user modes), the configuration is changed via
`ALLOW_REGISTRATIONS` in `docker-compose.yml` plus a container
rebuild/restart. The remaining sections can be run in either mode unless
stated otherwise.

---

## 1. User modes

| ID | Steps | Expected result |
|----|------|----------------------|
| TC-USR-01 | `ALLOW_REGISTRATIONS=false`, open `/` | Redirects to `/entries` with no login form |
| TC-USR-02 | In the same mode, open `/login`, `/register`, `/logout` directly | All redirect to `/entries` |
| TC-USR-03 | `ALLOW_REGISTRATIONS=true`, open `/` with no session | Redirects to `/login` |
| TC-USR-04 | Register a new user (username ≥3 chars, password ≥4 chars) | Account created, auto-logged in, redirected to `/entries` |
| TC-USR-05 | Register with a username shorter than 3 chars / password shorter than 4 / mismatched passwords | Form returns with a clear error, no account is created |
| TC-USR-06 | Register with an already-taken username | Error "this user already exists" |
| TC-USR-07 | Log in as an existing user with the wrong password | Error "invalid username or password", login not performed |
| TC-USR-08 | Log in as an existing user with correct credentials | Successful login, redirected to `/entries` |
| TC-USR-09 | Log out ("Log out" in the header) | Session ended, a further request to `/entries` redirects to `/login` |
| TC-USR-10 | User A adds a title, user B tries to open `/entries/<id>` for A's title directly | 404 "Not found" |
| TC-USR-11 | User B tries `POST /entries/<id>/delete` on someone else's entry | 404, A's entry is not deleted |
| TC-USR-12 | Restart the container in multi-user mode | All users are logged out (in-memory sessions), title data is intact |
| TC-USR-13 | Multi-user mode: register, log out, log in with a wrong password, log in with the right password | `docker logs` shows one line each for `[auth] register`/`logout`/`login failed`/`login`, with IP and username, no password |
| TC-USR-14 | 10+ failed login attempts from the same IP in a row | After the 10th — `[auth] rate-limited` in the logs, further attempts don't produce new `login failed` entries until the window expires |

---

## 2. Adding a title — general field logic

| ID | Steps | Expected result |
|----|------|----------------------|
| TC-ADD-01 | Open the list, click ➕ | A dialog opens with a single "Link or title" field |
| TC-ADD-02 | Paste a full URL (`https://...`) and submit | Recognized as a URL, provider parsing kicks in |
| TC-ADD-03 | Paste a URL without a protocol (`anilist.co/anime/1/...`) | Also recognized as a URL (the protocol is inferred) |
| TC-ADD-04 | Enter plain text with no dots/domain structure ("Naruto") | Recognized as a title, the entry is created right away with no source |
| TC-ADD-05 | Submit the form with an empty field | Dialog reopens with "Enter a link or a title", no entry is created |
| TC-ADD-06 | Add a link that's already in the list | Dialog reopens with a notice "Already in the list: <title> — status "…"", no duplicate is created |
| TC-ADD-07 | Click "Cancel" in the dialog | Dialog closes without submitting the form |
| TC-ADD-08 | Click outside the dialog (on the backdrop) | Dialog closes |
| TC-ADD-09 | Add a title manually (no link) | The card shows the source as "manual", same in the table/card view |
| TC-ADD-10 | Add a link already in the list, then refresh the browser page | No "resubmit form?" warning — the page just reloads with the list instead, the add dialog doesn't reopen on a further refresh |
| TC-ADD-11 | Add a title manually with a name matching (case/whitespace-insensitive) an existing one | Dialog reopens with a warning "Looks like a similar title already exists: <title> — status "…". Add anyway?", the "Add" button changes to "Add anyway" |
| TC-ADD-12 | In the TC-ADD-11 state, click "Add anyway" | The entry is created despite the name match |
| TC-ADD-13 | Add a title by link whose fetched title only slightly differs from an existing one (e.g. "Title" vs "Title Season 2") | Same similar-title warning as TC-ADD-11, with the same link kept in the field for resubmission; above the warning, a separate line reads "Adding: <fetched title>" |
| TC-ADD-14 | The title matches several already-added titles at once | The warning lists all matches (each linking to its own entry with its status), not just the first one found |
| TC-ADD-15 | Open the add dialog, type a title that triggers the "Looks like it already exists…" warning, close the dialog (click outside/"Cancel"), reopen it and type a completely different title | The button says "Add" again, the warning doesn't appear without an actual reason — the old state doesn't stay "stuck" |
| TC-ADD-16 | TC-ADD-11 state (similar title added **manually**, no link) | No "Adding: …" line above the warning — the input field itself already shows the typed name, no need to repeat it |

---

## 3. Providers — direct links

| ID | Site / link | Expected result |
|----|----------------|----------------------|
| TC-PRV-01 | `aniliberty.top/anime/releases/release/<id>-slug` | Title/description/cover come from the release page's own OG tags; genres come from a separate AniLibria API request by that id |
| TC-PRV-02 | `aniliberty.top/anime/releases/release/<slug>/episodes` (no numeric id) | Title/description/cover come from the same page's OG tags; the id for genres is resolved via AniLibria search by alias |
| TC-PRV-02a | Links to different seasons/spin-offs with similar slugs (e.g. `.../erandeiraremasen`, `.../erandeiraremasen-2nd-season`, `.../erandeiraremasen-ryoushu-no-youjo`), none with a numeric id | Each link yields its own season's title/cover/description/genres — they don't collapse into the same (first) search result |
| TC-PRV-02b | Link with no numeric id, while AniLibria's API is unreachable/erroring | Title/description/cover still come through (from the page's OG tags), genres are an empty string, no crash |
| TC-PRV-02c | An AniLibria link with `www.` where that exact page 404s/fails on `www` but works without it | Data still comes through — automatic fallback to the other host variant (and vice versa: without `www` → with `www`, if needed) |
| TC-PRV-03 | `myanimelist.net/anime/<id>/<slug>` | Data via Jikan (title_russian/english, synopsis, genres, cover) |
| TC-PRV-04 | `myanimelist.net/store/manga/...` (not `/anime/`) or another unrecognized path | The provider doesn't match → falls back to generic og-tag scraping |
| TC-PRV-05 | `shikimori.one/animes/<id>-slug`, `shikimori.io/animes/z<id>-slug`, `shikimori.me/animes/...` | All three domains are recognized, data comes from the Shikimori API |
| TC-PRV-06 | Shikimori: a title whose API `image.original` is the `missing_*` placeholder | The cover is additionally fetched via the page's og:image; if that's also missing, there's no cover |
| TC-PRV-07 | Shikimori: description contains BBCode (`[i]...[/i]`, `[b]...[/b]`) | The saved description has no tags, just plain text |
| TC-PRV-08 | `anilist.co/anime/<id>/<slug>` | Data via the AniList GraphQL API, HTML tags in the description are stripped |
| TC-PRV-09 | `imdb.com/title/<id>/` | Only the page's og tags; if IMDb returns an empty response (anti-bot) — "couldn't fetch data", manual entry |
| TC-PRV-10 | `kinopoisk.ru/film/<id>/` | Only og tags; if Kinopoisk returns a captcha page — no data is filled in, manual entry |
| TC-PRV-11 | A link to any other site (e.g. `yummyanime.tv`, `world-art.ru`) | Data only from that same page's og tags — **no** call to AniLibria/MAL/Shikimori/AniList for lookup |
| TC-PRV-12 | A link to an unknown site with no og:title at all | `ok:false` → the add dialog asks for a manual title, the link is kept in a hidden field |

---

## 4. Title cleanup and anti-bot detection

| ID | Scenario | Expected result |
|----|----------|----------------------|
| TC-CLN-01 | og:title like `"Title смотреть на Sitename"` | Title cleaned to `"Title"` |
| TC-CLN-02 | og:title like `"Title смотреть аниме онлайн бесплатно Sitename \| Brand2"` | Cleaned to `"Title"` (truncated at the first "смотреть", case/variant-insensitive) |
| TC-CLN-03 | og:title like `"Category - Title"` (one-word prefix, e.g. `"Anime - Maiden Blood"`) | The one-word prefix is stripped, leaving `"Maiden Blood"` |
| TC-CLN-04 | og:title like `"Title — Movie"` / `"Title — Film"` (one-word suffix) | The suffix is **not** stripped — kept in full, since suffixes are usually part of the real title |
| TC-CLN-05 | og:title with a dash inside the title itself, both sides multi-word (e.g. `"Otome Game World Is Tough for Mobs 2"`) | The title is left untouched |
| TC-CLN-06 | The word "смотреть" appears as part of another word (e.g. "смотрелка") | No false truncation occurs |
| TC-CLN-07 | The page serves HTML as `windows-1251` (`Content-Type: charset=windows-1251` or `<meta charset=...>`) | Cyrillic is decoded correctly, no `�` |
| TC-CLN-08 | The og-scrape lands on an anti-bot page with valid og tags (Cloudflare "Just a moment", a Yandex captcha, `/showcaptcha` in the final URL after redirects) | The result is marked as blocked and not used as title data |

---

## 5. Handling a failed metadata fetch

| ID | Steps | Expected result |
|----|------|----------------------|
| TC-FAIL-01 | Add a link that fails to fetch anything | Dialog reopens with a message and a required "Title" field, the original link is kept in a hidden field |
| TC-FAIL-02 | In this state, enter a title and submit | The entry is created with that title, `source_url` = the original link, no description/cover/genres |
| TC-FAIL-03 | In this state, submit the form with an empty title | Error "Enter the title", no entry is created |
| TC-FAIL-04 | Confirm that no failed add attempt **ever** creates an entry with the URL as its title | No entry in the database has `title` equal to a URL |
| TC-FAIL-05 | In the TC-FAIL-01 state (the "Title" field after a failed fetch for link A), enter another link B instead of a title | A new auto-fetch attempt is triggered for link B (instead of creating an entry with link B's text as the title) — on success, the entry is created with data fetched for B; on failure, the dialog reopens again in "Title" mode, but now with link B (not A) in the hidden field |
| TC-FAIL-06 | Repeat TC-FAIL-05 several times in a row (link B also fails, enter link C, and so on), then finally enter a plain title | The retry cycle continues for each new link; once a title (not a link) is finally entered, the entry is created with that title and `source_url` equal to the LAST link entered (not the first) |
| TC-FAIL-07 | The request to the source site fails with a network error (dropped connection/timeout) on the first attempt but succeeds on the second (simulated) | Exactly one retry after a pause — data comes through successfully, the user never sees an error |
| TC-FAIL-08 | The request to the source site fails with a network error on both attempts in a row | Same as TC-FAIL-01 — exactly 2 attempts total (not an infinite retry), then the usual failure message |
| TC-FAIL-09 | The source site responds with a plain HTTP error status (404, 403) with no network-level failure | No retry happens — a definite server response isn't retried, it's treated as a failure immediately, same as before |

---

## 6. Title card — read-only view

| ID | Steps | Expected result |
|----|------|----------------------|
| TC-VIEW-01 | Open a title that has a cover | The cover is shown (from the `/entries/:id/cover` blob or an external link) |
| TC-VIEW-02 | Open a title with no cover | A "No cover" placeholder with a button |
| TC-VIEW-03 | Click the button on the placeholder | Opens a Google Images search for the title in a new tab **and** switches the current page into edit mode |
| TC-VIEW-04 | Change the status in the dropdown | Saved immediately (no "Save" button needed), the page reloads with the new status |
| TC-VIEW-05 | Set/clear a rating | Saved immediately on selection |
| TC-VIEW-06 | Change status/rating without touching genres/cover/title | The other fields stay unchanged |
| TC-VIEW-07 | Enter a note and click 💾 in the header | The note is saved |
| TC-VIEW-08 | Click 🗑️ | A confirmation appears; on confirming, the entry is deleted and it redirects to the list |
| TC-VIEW-09 | Cancel the delete confirmation | The entry is not deleted |
| TC-VIEW-10 | Click ✏️ | Switches to edit mode |
| TC-VIEW-11 | The title was added by link | Text "Added by link: <domain>", the link is clickable and opens in a new tab |
| TC-VIEW-12 | The title was added manually (no link) | Text "Added manually, no link" |
| TC-VIEW-13 | A very long title with no whitespace | Wraps character by character, doesn't break the page layout |
| TC-VIEW-14 | A title with a cover, click the cover itself (not the placeholder) | The cover opens fullscreen in a lightbox over the page |
| TC-VIEW-15 | Click outside the image in the open lightbox (on the backdrop), or press Escape | The lightbox closes |
| TC-VIEW-16 | Open a title (view mode) | Below the description, shows "Added: DD.MM.YYYY · Updated: DD.MM.YYYY" |
| TC-VIEW-17 | Change status/rating/note, reopen the card | "Updated: …" reflects the current date, "Added: …" is unchanged |

---

## 7. Genres (dropdown widget)

Applies to both the read-only view and edit mode.

| ID | Steps | Expected result |
|----|------|----------------------|
| TC-GEN-01 | Open a title card | The genre dropdown is closed by default |
| TC-GEN-02 | Click ➕ next to the genre list | The dropdown opens: an input field on top, a list of already-used genres below (scrollable if there are more than ~5) |
| TC-GEN-03 | Click a genre from the suggestions list | The genre is added as a chip, saved immediately (background request), the dropdown closes |
| TC-GEN-04 | Type a new genre manually and press "+"/Enter | The genre is added as a chip, saved, the dropdown closes |
| TC-GEN-05 | Start typing in the input field while the dropdown is open | The suggestions list is filtered by substring (case-insensitive) |
| TC-GEN-06 | A title already has the genre "Fantasy", open the dropdown | "Fantasy" is absent from the suggestions list (already added) |
| TC-GEN-07 | Click × on a genre chip | The genre is removed, saved immediately |
| TC-GEN-08 | Click outside the dropdown while it's open | The dropdown closes |
| TC-GEN-09 | Press Escape while the dropdown is open | The dropdown closes |
| TC-GEN-10 | Disable the network/kill the server and try to add a genre | The optimistically added chip is rolled back when the request fails |
| TC-GEN-11 | Open a title's edit mode | The genre widget sits right under the title (same as in the view mode), not at the bottom of the form |

---

## 8. Editing a title

| ID | Steps | Expected result |
|----|------|----------------------|
| TC-EDIT-01 | Open `/entries/:id/edit` | The form is pre-filled with the current values |
| TC-EDIT-02 | Clear the "Title" field and save | The browser blocks submission (required field) |
| TC-EDIT-03 | Change the description and save | Description updated, other fields untouched |
| TC-EDIT-04 | Change "Source link" to a new URL and save | `source_url`/domain updated, shown on the view page |
| TC-EDIT-05 | Clear "Source link" and save | The source becomes empty, the card shows "Added manually" |
| TC-EDIT-06 | Paste invalid text into "Source link" (not a URL) | Saved as-is, the domain becomes empty, no 500 error |
| TC-EDIT-07 | Click "🔄 Refetch" with a valid source link | Title/description/genres/cover are overwritten with fresh data; status/rating/note are unchanged |
| TC-EDIT-08 | Click "Refetch" with an empty source field | Message "Enter a source link first", nothing changes |
| TC-EDIT-09 | Click "Refetch" with a link that returns no data (captcha/404) | Error message, **nothing in the entry changes** (verify via a direct DB query/reload) |
| TC-EDIT-10 | "Refetch" on a source with no cover (empty og:image) | The cover is left untouched (stays as it was, if any) |
| TC-EDIT-11 | Click "Cancel" (✖️) in the header | Goes back to the view page without saving changes |
| TC-EDIT-12 | Click 🗑️ directly from edit mode | Same behavior as TC-VIEW-08/09 |

---

## 9. Cover

| ID | Steps | Expected result |
|----|------|----------------------|
| TC-CVR-01 | Paste a valid image link into "Cover link", click "Refetch" | Shows a preview and the status "✓ Image loaded"; the large cover on the page updates with the live preview |
| TC-CVR-02 | Paste a broken link, click "Refetch" | Status "Couldn't load an image from this link", no preview shown |
| TC-CVR-03 | Paste a cover link and save the form (without clicking "Refetch") | The image is downloaded server-side and stored in the DB as a file (`cover_url` becomes empty, a blob appears) |
| TC-CVR-04 | The cover link points to a file larger than ~20 MB, or is unreachable | The download fails — saved as an external link (fallback), the entry is not broken |
| TC-CVR-05 | Pick a file via the dialog (button/click on the zone) | The filename is shown, the preview updates immediately |
| TC-CVR-06 | Drag an image file onto the upload zone (drag-and-drop) | The zone highlights on hover, the file is accepted the same way as via the dialog |
| TC-CVR-07 | Upload a file of an unsupported type (e.g. .txt) | Error "Only an image file can be uploaded…", the form isn't saved, the old cover isn't lost |
| TC-CVR-08 | Upload a file larger than 10 MB | Error about exceeding the size limit, the old cover isn't lost |
| TC-CVR-09 | Upload a file with a generic mimetype (`application/octet-stream`) but a `.png`/`.jpg`/etc. extension | The file is accepted (extension-based fallback check) |
| TC-CVR-10 | Upload a new file when a cover link was already set | The file wins: saved as a blob, the old link is cleared |
| TC-CVR-11 | **Regression**: upload a cover as a file, then save the form again changing only the title (the "Cover link" field stays empty, as it's rendered) | The uploaded cover does **not** disappear |
| TC-CVR-12 | Click ❌ over the current cover, confirm | The cover (both blob and link) is fully cleared, a placeholder is shown |
| TC-CVR-13 | Auto-add a title that has a default cover | The cover is downloaded and stored locally right away (`cover_url` empty, blob filled), not left as an external link |
| TC-CVR-14 | The cover from the source is in AVIF/WebP format | Downloaded and stored in its original format, opens correctly from the card page |
| TC-CVR-15 | The source has no cover at all (e.g. world-art.ru) | The entry is created with no cover, the placeholder + manual search button work as usual |
| TC-CVR-16 | Paste a plain `http://` (not `https://`) cover link, click "Refetch" — e.g. `http://www.world-art.ru/animation/img/13000/12241/1.jpg` | The image loads and the preview shows the same as for an `https://` link |
| TC-CVR-17 | Paste a working image link (verified directly via curl/server-side) that the browser itself couldn't load via `<img>` (mixed content on an HTTPS page, a site's referrer filter, etc.), click "Refetch" | The check hits the server (`POST /entries/:id/cover-url`) rather than loading the link directly in the browser — the server downloads the image, status "✓ Image loaded", the preview shows the already-saved copy (its own, `/entries/:id/cover`) |
| TC-CVR-18 | Paste a link that returns no image even to the server (404, not an image, etc.), click "Refetch" | Status "Couldn't load an image from this link" — this time rightly so, since the server couldn't either |
| TC-CVR-19 | A cover with a mismatched aspect ratio (e.g. a landscape og:image, 1200×630) — check the title page, the grid, and the table | The image is shown in full with no hard crop (`object-fit: contain`), with a blurred, scaled-up copy of the same image filling the background (lighter blur in the table than in the larger views) |

---

## 10. Entries list — grid and table

| ID | Steps | Expected result |
|----|------|----------------------|
| TC-LIST-01 | Toggle grid ↔ table | The view switches instantly with no reload, saved to localStorage and restored on the next visit |
| TC-LIST-02 | Grid: a title with 0 genres next to one with 5+ genres | Cards have the same height (space reserved for title and genres) |
| TC-LIST-02a | Grid: a title with 4 genres including one long word (e.g. a 19-character genre name) next to titles with short genres | The long genre is ellipsized but doesn't push chips onto a 3rd row — every card in the row has its date/source line at the same height, none has leftover empty space at the bottom |
| TC-LIST-03 | Grid: a title with 4+ genres | The first 3 chips are shown plus a "…" chip |
| TC-LIST-04 | Grid: a title with a rating | The rating badge sits top-right on the cover, on the same line as the status badge (which is top-left) |
| TC-LIST-05 | Grid: click the source domain at the bottom of the card | Opens the source link in a new tab, **without** navigating to the title's page |
| TC-LIST-06 | Grid: click the card's cover/title | Navigates to the title's page |
| TC-LIST-07 | Table: a very long title | Wraps to a second line if it fits; truncated with an ellipsis if there's not enough room (a `title` attribute carries the full text) |
| TC-LIST-08 | Table: the "Genres" column for titles with and without genres | Row height is consistent across the whole table |
| TC-LIST-09 | Table: the cover column | Narrow, doesn't stretch at the expense of the other columns |
| TC-LIST-10 | Table: click a row (not a link) | Navigates to the title's page |
| TC-LIST-11 | Table: click the source link in a row | Opens in a new tab, doesn't navigate to the title's page |
| TC-LIST-12 | The list is empty (freshly installed app) | An empty state is shown with a hint and an icon |
| TC-LIST-13 | Filter by status (tabs "Planned"/"Watching"/"Watched"/"Dropped") | The list and the counts in parentheses filter correctly |
| TC-LIST-14 | Grid: a title's card | The footer's bottom-left shows the date added (DD.MM.YYYY, tooltip "Date added"), the source domain stays on the right as before |
| TC-LIST-15 | Table | Has a "Date"/"Added" column showing the date added (DD.MM.YYYY), positioned before the source column |
| TC-LIST-16 | Table: a row with a very long title (wraps to 2 lines) next to a row with a short (1-line) title | Row height is consistent across the whole table, including the date column |

---

## 11. Search

| ID | Steps | Expected result |
|----|------|----------------------|
| TC-SRCH-01 | Type part of a title into the search box | The list (both grid and table) filters instantly with no reload |
| TC-SRCH-02 | Search by a word from the description | Finds matching titles |
| TC-SRCH-03 | Search by genre | Finds titles with that genre |
| TC-SRCH-04 | Search by source domain | Finds titles with that source |
| TC-SRCH-05 | Search by a word from a personal note | Finds the title |
| TC-SRCH-06 | Enter a query that matches nothing | "Nothing found" is shown |
| TC-SRCH-07 | Clear the search field manually (delete the text) | The list returns to its full view |
| TC-SRCH-08 | The list is empty (0 titles) | The search field is disabled |
| TC-SRCH-09 | The search field is empty | No clear button is shown inside the field |
| TC-SRCH-10 | Type any text into search | A clear (×) button appears inside the field |
| TC-SRCH-11 | Click the clear button while the field is non-empty and the list is filtered | The field clears instantly, the list returns to its full view, focus stays in the field, the clear button hides again |
| TC-SRCH-12 | Search lives in the header next to the list switcher (not in the status-tabs/sort toolbar) | Switching status tabs, or a different number of sort/view buttons, doesn't shift the search field or push it onto another line |
| TC-SRCH-13 | Switch between lists with very different name lengths (short ↔ long, ellipsized) | The search field stays in the same place at the same width — the header doesn't "jump" |

---

## 12. Sorting

| ID | Steps | Expected result |
|----|------|----------------------|
| TC-SORT-01 | Open the list for the first time (no saved settings) | Default sort is by date added, newest first |
| TC-SORT-02 | Click 📅 again (already active) | The direction flips (oldest first) |
| TC-SORT-03 | Click 🔠 | The list re-sorts by title (A→Z), Cyrillic and Latin sort correctly |
| TC-SORT-04 | Click 🔠 again | The direction flips to Z→A |
| TC-SORT-05 | Change the sort, reload the page | The choice is preserved (localStorage) |
| TC-SORT-06 | Change the sort, toggle grid/table | The order stays consistent in both views |
| TC-SORT-07 | Click ★ | The list re-sorts by rating, descending by default (highest first) |
| TC-SORT-08 | Click ★ again | Direction flips to ascending (lowest/unrated first) |
| TC-SORT-09 | ★ descending, some titles have no rating | Unrated titles sort strictly below any rated one (1–10), as a group at the very bottom |
| TC-SORT-10 | ★ ascending, some titles have no rating | Unrated titles sort strictly above any rated one, at the very top |
| TC-SORT-11 | Sort by ★, reload the page / toggle grid-table | Choice and direction persist (localStorage), order stays consistent in both views — same as TC-SORT-05/06 |

---

## 13. Docker / infrastructure

| ID | Steps | Expected result |
|----|------|----------------------|
| TC-DOCK-01 | `docker compose up -d --build` from scratch | The image builds with no errors, the container starts |
| TC-DOCK-02 | `docker compose ps` after startup | Status `healthy` within ~10–15 seconds |
| TC-DOCK-03 | Open `http://localhost:3000` | The app responds according to `ALLOW_REGISTRATIONS` |
| TC-DOCK-04 | Add titles, restart the container (`docker compose restart`) | All data and uploaded covers are preserved (volume) |
| TC-DOCK-05 | Rebuild the image (`--build`) after a code change | The new code takes effect, data in the volume isn't lost |
| TC-DOCK-06 | Switch `ALLOW_REGISTRATIONS` to `true`, recreate the container | Switches to multi-user mode, the old (single-user) entries stay under the `local` user |
| TC-DOCK-07 | Don't change `SESSION_SECRET` in production | The app still works (a generated default), but this is noted as a risk in the README |
| TC-DOCK-08 | `docker compose down && docker compose up -d` (no `-v`) | The DB volume isn't removed, data is intact |
| TC-DOCK-09 | `docker compose down -v` | The volume is removed, the next startup begins with an empty DB |

---

## 14. General / cross-feature regressions

| ID | Steps | Expected result |
|----|------|----------------------|
| TC-GEN2-01 | Full cycle: add by link → change status → set a rating → add a genre → write a note → edit the cover | All actions save independently, none overwrites another |
| TC-GEN2-02 | Add the same title twice from different sources (e.g. AniLibria and AniList) | Both entries are created as separate ones (dedup only matches an exact `source_url`) |
| TC-GEN2-03 | Title/description containing quotes, ampersands, HTML-like characters (`<`, `>`) | Escaped correctly on output, doesn't break the page layout |
| TC-GEN2-04 | A very long list (50+ titles) | The grid/table/search/sort stay responsive |
| TC-GEN2-05 | Open any page of the app | The current version (`v` + the value from `package.json`) is shown in small text under "Watch List" in the header, consistently on every page |

---

## 15. Security

| ID | Steps | Expected result |
|----|------|----------------------|
| TC-SEC-01 | Add/fetch a link to a private/local address (`127.0.0.1`, `169.254.169.254`, `192.168.x.x`, `10.x.x.x`, `localhost`) | The request isn't made (SSRF guard), the app behaves as on a failed fetch — asks for a manual title, no entry is created with that address as the source |
| TC-SEC-02 | Set a cover link pointing to a local/private address | The download doesn't happen, the cover isn't saved (fallback as for an unreachable link) |
| TC-SEC-03 | Add a link to a site that redirects to a private address (e.g. via a `location:` header to `127.0.0.1`) | The redirect is re-checked — the hop to the private address is blocked the same as a direct link to it |
| TC-SEC-04 | A link with a different protocol (`javascript:`, `ftp://`, `data:`) | Not recognized as an http(s) link, saved as plain title text (safely escaped on output) |
| TC-SEC-05 | A title/description/note/link longer than a reasonable limit (hundreds of thousands of characters) | The value is truncated to the maximum (see `src/limits.js`), the entry is saved with no 500 error, the DB doesn't bloat |
| TC-SEC-06 | Provide more than 30 genres, or a genre longer than 50 characters | The genre list is capped at 30 items, each capped at 50 characters |
| TC-SEC-07 | Open any page of the app, check the response headers | `Content-Security-Policy` (with no `unsafe-inline`), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin` are all present |
| TC-SEC-08 | Check the session `Set-Cookie` | `SameSite=Lax`, `HttpOnly` |
| TC-SEC-09 | In multi-user mode, enter a wrong password for the same username from the same IP 10+ times in a row | After the 10th failed attempt within 10 minutes — `429` and "Too many login attempts", further attempts are blocked until the window expires |
| TC-SEC-10 | User A and user B (multi-user mode): B tries to open/modify/delete A's entry directly by id (`GET`/`POST /entries/<id>/...`) | `404 Not found` everywhere, A's entry is unchanged |
| TC-SEC-11 | Upload a file disguised as an image by extension but that's actually an arbitrary large binary (>10 MB) | Rejected by size before it's ever saved |

---

## 16. Settings — theme, language, backup

| ID | Steps | Expected result |
|----|------|----------------------|
| TC-SET-01 | Open ⚙️ in the header | A panel opens with the "Theme", "Language", and "Backup" sections |
| TC-SET-02 | Click outside the panel / press Escape while it's open | The panel closes |
| TC-SET-03 | Select the ☀️ (light) theme | The page repaints light immediately, no reload |
| TC-SET-04 | Select the 🌙 (dark) theme | The page repaints dark |
| TC-SET-05 | Select 🖥️ (system), then change the OS theme while the tab is open | The page follows the system theme switch with no reload |
| TC-SET-06 | Pick a theme, reload the page / open another app page | The theme choice is preserved (localStorage), the page opens straight into the right theme with no flash of the other one |
| TC-SET-07 | Switch the interface language to EN | The page reloads, the whole UI (buttons, labels, error messages) is in English; title names/descriptions aren't translated |
| TC-SET-08 | Trigger any add-error (empty field, duplicate, etc.) with the English UI | The error message is also in English |
| TC-SET-09 | Switch the language back to RU | The UI returns to Russian |
| TC-SET-10 | "⬇️ Download" in the "Backup" section | Downloads a `watch-list-<active list>-<date>.json.gz` file — gzipped JSON of the **active list**'s titles, covers included as base64 |
| TC-SET-11 | "⬆️ Upload" and pick the file just downloaded (same list as the export) | The list's contents don't change, shows a notice "Added to list "X": 0, skipped (already present): N" — all titles are already there, no duplicates are created |
| TC-SET-12 | Delete one title, then upload an old backup (which still has it) into the same list | The deleted title is restored from the backup (cover/genres/status/rating/note included), the rest are skipped as already present |
| TC-SET-13 | Upload a file that isn't a backup from this app (a random file / a corrupt archive) | Shows the error "Couldn't read the backup file…", the list is unchanged |
| TC-SET-14 | Upload a backup exported from a different (someone else's) account | Titles are added to the **current** account's collection, into its active list — importing isn't tied to whoever originally exported it |
| TC-SET-15 | `HTTPS=true` with valid `SSL_CERT_PATH`/`SSL_KEY_PATH` set at container startup | The container log shows "started on port … (https, …)", the app responds over `https://` |
| TC-SET-16 | `HTTPS=true`, but the certificate/key can't be read (missing file, wrong path) | The log shows a warning and an explicit fallback to http, the container still starts and responds over `http://`, doesn't crash |
| TC-SET-17 | `HTTPS` unset or `false` (default) | The app comes up over plain http, as before |
| TC-SET-18 | `docker compose up -d` with no `PORT` variable (default) | The app is available at `http://localhost:3000`, as before |
| TC-SET-19 | `PORT=8080 docker compose up -d` (or `PORT=8080` in a `.env` next to the file) | The app is available at `http://localhost:8080`, the old port 3000 is unreachable; the container healthcheck uses the new port and reports `healthy` |
| TC-SET-20 | First startup with no `SESSION_SECRET` in the environment | The server generates a secret itself and stores it in `session-secret.txt` next to the DB (`0600` permissions); sessions work as usual |
| TC-SET-21 | Restart/rebuild the container (no `-v`) without changing `SESSION_SECRET` | The previously generated secret is unchanged (same file in the volume), active sessions aren't reset |
| TC-SET-22 | Set `SESSION_SECRET` explicitly in the environment | The given value is used, `session-secret.txt` is neither created nor used |

---

## 17. Lists

| ID | Steps | Expected result |
|----|------|----------------------|
| TC-LST-01 | First startup / an existing DB from before this feature | All titles sit in the "Main" list, which is also selected by default |
| TC-LST-02 | Open the 📁 dropdown on the left side of the header, next to the app name (separated by a vertical line) | Shows a name input field and a list of existing lists with their title counts; the active list is marked |
| TC-LST-03 | Type a new (not yet existing) name into the field and click "✓" | Creates (and switches to) a new, empty list |
| TC-LST-04 | Type into the input field while the dropdown is open | The list of existing names below is filtered by substring (case-insensitive) |
| TC-LST-05 | Click an existing list in the dropdown | Switches to it, the page's entries list updates to that list's titles |
| TC-LST-06 | Add a title (by link or manually) while in list A | The title only appears in list A; switching to list B doesn't show it |
| TC-LST-07 | Add a title with the same name in both list A and list B | Both are added with no duplicate warning — the name-match check only applies within a single list |
| TC-LST-08 | Add a title to list A by a link that's already present in list B (but not in A) | Added as new — dedup by `source_url` is also scoped to the current list only |
| TC-LST-09 | Open `/entries/<id>` directly for a title that's in another (not currently active) list | `404 Not found` — access by id is blocked regardless of both lists belonging to the same account |
| TC-LST-10 | Switch to the list that contains this id and repeat the request | Opens normally |
| TC-LST-11 | Genres: add a genre in list A, open the genre dropdown in list B | The genre from A is not suggested in B |
| TC-LST-12 | Click 🗑️ on a list in the dropdown | Asks for confirmation, naming the list and its title count |
| TC-LST-13 | Confirm deleting a list that is NOT active | The list and all its titles are deleted, the dropdown updates, the current (active) list and its titles are untouched |
| TC-LST-14 | Confirm deleting the ACTIVE list (not "Main") | The list is deleted, automatically switches to "Main" |
| TC-LST-15 | Cancel the delete confirmation | The list is not deleted |
| TC-LST-16 | "⬇️ Download" a backup while in list A | The downloaded file only contains list A's titles; the filename includes its name |
| TC-LST-17 | Switch to list B (or create a new one), upload the file from TC-LST-16 there | The titles from A are added into B; the hint next to "Upload" and the post-upload banner both explicitly name list B as the target |
| TC-LST-18 | Switching the UI language (RU/EN) while a non-empty list is active | The list's name in the dropdown isn't translated (it's user data, not interface text), everything else in the dropdown is in the selected language |
| TC-LST-19 | Create a new empty list (without adding anything to it), switch to another list, reopen the dropdown | The just-created empty list stays in the dropdown (with a count of 0) and can be switched back to — it doesn't disappear |
| TC-LST-20 | Click ✏️ on a list in the dropdown | The list row is replaced with a text input showing the current name, focused, text selected |
| TC-LST-21 | While renaming, change the name and click "✓" | The list is renamed, all its titles stay with it (nothing moves), the dropdown shows the new name |
| TC-LST-22 | Rename the currently active list | The name on the switcher button (📁) updates immediately |
| TC-LST-23 | Rename a list to a name already taken by another list | Shows the error "A list with this name already exists", both lists stay as they were |
| TC-LST-23a | Rename a regular list to "Main" (exact match with the default list's localized name; "Основной" on RU) | Same "A list with this name already exists" error — the rename doesn't go through, the dropdown doesn't end up with two identically-labeled entries |
| TC-LST-23b | Type "Main"/"Основной" into the new-list field and click "✓" | No new list is created — switches to the already-existing default "Main" instead |
| TC-LST-24 | While renaming, click "✕" or Escape, or click outside the dropdown | Returns to the normal row view with no changes saved |
| TC-LST-25 | Open the dropdown, find the "Main" entry | It has neither ✏️ nor 🗑️ next to it — under no circumstances, regardless of how many lists the account has |
| TC-LST-26 | Send `POST /settings/list/delete` with the default list's `list_id` directly (bypassing the hidden UI button) | The request does nothing, the list and its titles stay in place |
| TC-LST-27 | Send `POST /settings/list/rename` with the default list's `list_id` directly (bypassing the UI) | The request does nothing, the name doesn't change (still resolved from the localization) |
| TC-LST-28 | Delete every regular list, leaving only "Main" | Deletes with no issue, "Main" remains the only one and still has no ✏️/🗑️ buttons |
| TC-LST-29 | Switch the UI language (RU/EN) | The "Main" entry's label in the dropdown and on the switcher button (📁) changes with the language; regular (non-default) list names do not — they aren't interface text |
| TC-LST-30 | Create 127 regular lists (128 total together with the mandatory "Main" — the overall cap), try to create one more | Not created, shows an over-the-limit error; the existing lists are unaffected |
| TC-LST-31 | Enter a name longer than 50 characters (create or rename), bypassing the client-side `maxlength` (e.g. a direct `POST`) | The server truncates the name to 50 characters, the full text isn't stored |
| TC-LST-32 | Switch to a list with a long name (near/at the 50-character limit) | The header switcher button ellipsizes the name without stretching the header; the full name shows in a tooltip on hover |
| TC-LST-33 | Switch between lists with very different name lengths (short ↔ ellipsized) | The list-name block's width in the header doesn't jump around, the search field next to it stays put (see also TC-SRCH-13) |

---

## 18. Configurable limits and logging

| ID | Steps | Expected result |
|----|------|----------------------|
| TC-CFG-01 | Start the container with no `MAX_COVER_UPLOAD_MB` override, open a title's edit page | The hint under the cover upload reads "…up to 10 MB." |
| TC-CFG-02 | Set `MAX_COVER_UPLOAD_MB=1`, open a title's edit page | The hint reads "…up to 1 MB.", not the default 10 |
| TC-CFG-03 | With `MAX_COVER_UPLOAD_MB=1`, upload a 2 MB cover file | Rejected with a size error naming 1 MB specifically, not 10 |
| TC-CFG-04 | Set `MAX_COVER_FETCH_MB` below the size of a test image link, click "🔄" next to the cover link field | The auto-fetched cover is rejected as too large |
| TC-CFG-05 | Set `MAX_BACKUP_MB=1`, upload an export file larger than 1 MB in "Backup" | The upload is rejected with a file-size error |
| TC-CFG-06 | Set `SESSION_MAX_AGE_DAYS=1`, log in (multi-user mode), wait (or shift the clock) more than a day | The session expires earlier than the default 30 days — the next request requires logging in again |
| TC-CFG-07 | Set `FETCH_TIMEOUT_MS` to a small value (e.g. `1`), add a title by link to an external site | The request to the source site times out faster than usual, auto-fill doesn't succeed, but the app doesn't crash |
| TC-CFG-08 | Set `LOGIN_MAX_ATTEMPTS=2` and `LOGIN_WINDOW_MINUTES=10` (multi-user mode), enter a wrong password 3 times in a row from the same IP | After the 2nd failed attempt — blocked (`429`) sooner than the default 10 |
| TC-CFG-09 | Set any of the seven `CONFIG` parameters to a garbage/non-numeric value (e.g. `MAX_COVER_UPLOAD_MB=abc` or `0`) | The server starts normally, the parameter's default value is used, no error is shown and nothing crashes in the log |
| TC-CFG-10 | Don't set any of the seven `CONFIG` parameters | App behavior is identical to before they existed (all defaults match the old hardcoded values) |
| TC-CFG-11 | First container startup with no explicit `SESSION_SECRET` (single- or multi-user mode — doesn't matter) | The container log (`docker logs`) shows one line about a new `SESSION_SECRET` being generated, with the file path |
| TC-CFG-12 | Restart the same container (same volume) without changing `SESSION_SECRET` | The secret-generation line does NOT appear again — the secret is already saved and reused |
| TC-CFG-13 | Single-user mode (`ALLOW_REGISTRATIONS=false`), normal use (adding/editing/deleting titles) | The container log has zero `[auth] …` lines — there are no login events in this mode; the `[entries]`/`[list]`/`[backup]` lines about the actual changes are present (see TC-CFG-16 onward) |
| TC-CFG-14 | Launch the desktop app (Electron) from a terminal (not by double-click), rather than a GUI-launched `.exe` built via `npm run dist:win` | No log line appears in the terminal at all — neither from Electron nor the embedded server (`[auth]`, `[entries]`/`[list]`/`[backup]`, secret generation, etc. are all fully suppressed) |
| TC-CFG-15 | Inspect the filesystem after running the desktop app (aside from the DB itself and `session-secret.txt`, which are intentionally kept for data/session persistence) | No log files are created at all (no `electron-log`, no app-specific `.log` files) |
| TC-CFG-16 | Add a title (by link or manually) | Log shows `[entries] add id=<id> title="…"`, with IP (and `user=` in multi-user mode) |
| TC-CFG-17 | Save the full title edit form (title/description/cover/status/…) | Log shows `[entries] update id=<id> title="…"` |
| TC-CFG-18 | Change status/rating/note directly from the title card (without entering edit mode) | Log shows `[entries] status id=<id> fields=…`, where `fields` names exactly the changed fields |
| TC-CFG-19 | Change a title's genres via the card widget | Log shows `[entries] genres id=<id>` |
| TC-CFG-20 | Change the cover — via a pasted link, and separately via a file from disk | Log shows `[entries] cover id=<id> via=url` and `[entries] cover id=<id> via=file` respectively |
| TC-CFG-21 | Click "🔄 Refetch" on the source link (a repeat metadata fetch) | Log shows `[entries] refetch id=<id> title="…"` |
| TC-CFG-22 | Delete a title | Log shows `[entries] delete id=<id> title="…"` (the title as it was before deletion) |
| TC-CFG-23 | Upload a backup file via "⬆️ Upload" | Log shows `[backup] import list="…" added=N skipped=M` with the actual added/skipped counts |
| TC-CFG-24 | Create a new list, rename it, then delete it | Log shows, in order, `[list] create id=<id> name="…"`, `[list] rename id=<id> from="…" to="…"`, `[list] delete id=<id> name="…" entries=N` |
| TC-CFG-25 | Just open pages (entries list, title card, edit page) with no changes | No new log line appears — opening pages (GET) isn't logged, only actual changes (POST) are |
| TC-CFG-26 | Multi-user mode — perform any of the actions above while logged in | The log line includes `user="<account name>"` in addition to the IP |
