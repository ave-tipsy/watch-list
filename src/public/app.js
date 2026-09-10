// UI strings for the current locale, injected server-side as JSON (see header.ejs).
let I18N = null;
function tr(key, vars) {
  if (!I18N) {
    try {
      I18N = JSON.parse(document.getElementById('i18n-data')?.textContent || '{}');
    } catch {
      I18N = {};
    }
  }
  let str = I18N[key] || key;
  if (vars) for (const [k, v] of Object.entries(vars)) str = str.replaceAll(`{{${k}}}`, v);
  return str;
}

// Replaces a broken cover with a text placeholder instead of showing a
// "broken image" icon. On a title's page, the large cover also has a blurred
// backdrop of the same image (see .cover-blur-bg) — if the main image fails
// to load, the backdrop fails too (same src), so we remove it as well rather
// than leaving a broken icon behind the placeholder.
function handleCoverError(img) {
  const blurBg = img.previousElementSibling;
  if (blurBg?.classList.contains('cover-blur-bg')) blurBg.remove();
  const placeholder = document.createElement('div');
  placeholder.className = 'cover-placeholder';
  placeholder.textContent = tr('cover.none');
  img.replaceWith(placeholder);
}

// Swaps the content of the big cover block for a new image — used both for
// the URL preview ("Refetch") and for previewing a just-picked file.
// Recreates the same structure entry.ejs renders (blurred backdrop + full
// image on top, see .cover-blur-bg/.cover-main-img), otherwise the live
// preview before saving would look different from after a page reload.
// Always edit mode (the only place this is ever called from) — opening the
// cover fullscreen deliberately doesn't work here, same as for a saved cover
// in this same mode (see initCoverLightbox).
function setCoverPreview(src) {
  const box = document.getElementById('entry-cover-box');
  if (!box) return;
  box.innerHTML = '';

  const blurBg = document.createElement('img');
  blurBg.alt = '';
  blurBg.setAttribute('aria-hidden', 'true');
  blurBg.className = 'cover-blur-bg';
  blurBg.src = src;
  box.appendChild(blurBg);

  const img = document.createElement('img');
  img.alt = '';
  img.className = 'cover-main-img';
  img.src = src;
  img.onerror = () => handleCoverError(img);
  box.appendChild(img);
}

function initAddDialog() {
  const dialog = document.getElementById('add-dialog');
  if (!dialog) return;
  const openBtn = document.getElementById('add-open-btn');
  const cancelBtn = document.getElementById('add-cancel-btn');
  const carriedUrl = document.getElementById('add-carried-url');
  const queryInput = document.getElementById('add-query-input');
  const queryLabel = document.getElementById('add-query-label-text');
  const submitBtn = document.getElementById('add-submit-btn');

  // If the dialog is closed without submitting the form (click outside,
  // Escape, "Cancel") — don't carry the half-filled input into the next
  // open. Starting fresh is simpler and clearer than guessing what's still
  // relevant.
  function resetAddForm() {
    if (carriedUrl) carriedUrl.value = '';
    if (queryInput) {
      queryInput.value = '';
      queryInput.required = false;
      queryInput.placeholder = tr('add.queryPlaceholder');
    }
    if (queryLabel) queryLabel.textContent = tr('add.queryLabel');
    if (submitBtn) submitBtn.textContent = tr('common.add');
    dialog.querySelector('.error')?.remove();
    dialog.querySelector('.notice')?.remove();
    dialog.querySelector('input[name="confirm_duplicate"]')?.remove();
  }

  openBtn?.addEventListener('click', () => dialog.showModal());
  cancelBtn?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
  // 'close' fires on any close except form submission (that navigates to a
  // new page before the event could reset anything).
  dialog.addEventListener('close', resetAddForm);

  // The server asks to reopen the dialog with an error (duplicate / couldn't fetch data).
  if (dialog.dataset.reopen) dialog.showModal();
}

function initViewToggle() {
  const grid = document.getElementById('view-grid');
  const table = document.getElementById('view-table');
  const gridBtn = document.getElementById('view-grid-btn');
  const tableBtn = document.getElementById('view-table-btn');
  if (!gridBtn || !tableBtn) return;

  const KEY = 'watchlist:view';

  function apply(mode) {
    if (grid) grid.hidden = mode !== 'grid';
    if (table) table.hidden = mode !== 'table';
    gridBtn.classList.toggle('active', mode === 'grid');
    tableBtn.classList.toggle('active', mode === 'table');
  }

  let saved = 'grid';
  try {
    saved = localStorage.getItem(KEY) || 'grid';
  } catch {
    /* localStorage may be unavailable — stay on grid view */
  }
  apply(saved);

  gridBtn.addEventListener('click', () => {
    apply('grid');
    try { localStorage.setItem(KEY, 'grid'); } catch {}
  });
  tableBtn.addEventListener('click', () => {
    apply('table');
    try { localStorage.setItem(KEY, 'table'); } catch {}
  });
}

// Confirmation before an irreversible action (deleting a title/cover) —
// moved out of inline onclick so it works under a strict CSP with no
// 'unsafe-inline' in script-src.
function initConfirmButtons() {
  document.querySelectorAll('.js-confirm').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      if (!confirm(btn.dataset.confirm || tr('common.confirmFallback'))) e.preventDefault();
    });
  });
}

// Opens Google Images search in a new tab, without interfering with the
// normal link navigation (into edit mode).
function initGoogleImageLinks() {
  document.querySelectorAll('.js-open-google').forEach((el) => {
    el.addEventListener('click', () => window.open(el.dataset.googleUrl, '_blank', 'noopener'));
  });
}

// Status/rating are saved immediately on selection.
function initAutoSubmitSelects() {
  document.querySelectorAll('.js-auto-submit').forEach((el) => {
    el.addEventListener('change', () => el.form?.requestSubmit());
  });
}

// The 👁️ button on a title's page — opens the current cover at full size
// over the page, instead of just the small 260px-wide block.
function initCoverLightbox() {
  const dialog = document.getElementById('cover-lightbox');
  const img = document.getElementById('cover-lightbox-img');
  if (!dialog || !img) return;

  // .js-view-cover is the cover block itself on a title's page (viewing,
  // not editing — nothing to open there, the cover is already changed in place).
  document.querySelectorAll('.js-view-cover').forEach((el) => {
    el.addEventListener('click', () => {
      img.src = el.dataset.coverSrc;
      dialog.showModal();
    });
  });
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
}

// A broken cover (in the grid/table/title page) is replaced with a text
// placeholder instead of a "broken image" icon.
function initCoverFallbackImages() {
  document.querySelectorAll('.js-cover-fallback').forEach((img) => {
    img.addEventListener('error', () => handleCoverError(img), { once: true });
  });
}

function initTableRowLinks() {
  document.querySelectorAll('.table-row[data-href]').forEach((row) => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('a')) return;
      window.location.href = row.dataset.href;
    });
  });
}

// Verifies that a manually pasted cover URL actually leads to an image, and
// shows it right in the card immediately (without waiting for the form to be
// saved). The server makes the call (we send it the URL instead of loading
// it ourselves via `new Image()`) — the server's own fetch has none of the
// browser's restrictions, like auto-upgrading mixed content on an HTTPS page
// or a specific site's referrer filters: a URL the browser refuses to load
// directly often downloads fine server-side, whereas relying on the browser
// as the sole source of truth would lose working links for no reason.
function initCoverUrlCheck() {
  const btn = document.getElementById('cover-url-check-btn');
  const input = document.getElementById('cover-url-input');
  const status = document.getElementById('cover-url-status');
  const form = document.getElementById('edit-form');
  if (!btn || !input || !status || !form) return;

  btn.addEventListener('click', () => {
    const url = input.value.trim();
    status.className = 'cover-url-status';
    status.textContent = '';
    if (!url) return;

    status.textContent = tr('cover.checking');

    // Save immediately rather than waiting for the next "Save" click —
    // otherwise, e.g. "Refetch" on the source URL reloads the page via a
    // separate route that doesn't know about the not-yet-saved form field,
    // and the just-picked cover is silently lost.
    const entryId = form.action.split('/').filter(Boolean).pop();
    fetch(`/entries/${entryId}/cover-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cover_url: url }),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error('bad response');
        const data = await r.json();
        if (data.downloaded) {
          // Our own URL (same origin) — no more browser restrictions on
          // mixed content/referrer apply to it.
          setCoverPreview(`/entries/${entryId}/cover?v=${Date.now()}`);
          status.className = 'cover-url-status ok';
          status.textContent = tr('cover.loaded');
        } else {
          status.className = 'cover-url-status error';
          status.textContent = tr('cover.loadFailed');
        }
      })
      .catch(() => {
        status.className = 'cover-url-status error';
        status.textContent = tr('cover.loadFailed');
      });
  });
}

// Previews the selected local file right in the cover block, before the form
// is saved, plus drag-and-drop over a styled upload zone.
function initCoverFilePreview() {
  const input = document.getElementById('cover-file-input');
  const drop = document.getElementById('cover-file-drop');
  const label = document.getElementById('cover-file-label');
  const status = document.getElementById('cover-file-status');
  const form = document.getElementById('edit-form');
  if (!input) return;

  // Save immediately on file selection/drop, not just on the next "Save"
  // click — same reason as the URL cover (see initCoverUrlCheck): otherwise
  // the choice was lost if the user did something else on the page
  // afterward without explicitly saving.
  function saveFile(file) {
    if (!status || !form) return;
    status.className = 'cover-url-status';
    status.textContent = tr('cover.checking');

    const entryId = form.action.split('/').filter(Boolean).pop();
    const body = new FormData();
    body.append('cover_file', file);

    fetch(`/entries/${entryId}/cover-file`, { method: 'POST', body })
      .then(async (r) => {
        if (r.ok) {
          status.className = 'cover-url-status ok';
          status.textContent = tr('cover.loaded');
          return;
        }
        const data = await r.json().catch(() => ({}));
        status.className = 'cover-url-status error';
        status.textContent =
          data.error === 'NOT_IMAGE'
            ? tr('cover.errNotImage')
            : data.error === 'TOO_BIG'
              ? tr('cover.errTooBig', { max: data.maxMb })
              : tr('cover.loadFailed');
      })
      .catch(() => {
        status.className = 'cover-url-status error';
        status.textContent = tr('cover.loadFailed');
      });
  }

  function handleFile(file) {
    if (!file) return;
    if (label) label.textContent = file.name;
    setCoverPreview(URL.createObjectURL(file));
    saveFile(file);
  }

  input.addEventListener('change', () => handleFile(input.files && input.files[0]));

  if (drop) {
    ['dragover', 'dragenter'].forEach((evt) =>
      drop.addEventListener(evt, (e) => {
        e.preventDefault();
        drop.classList.add('dragover');
      })
    );
    ['dragleave', 'dragend'].forEach((evt) => drop.addEventListener(evt, () => drop.classList.remove('dragover')));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      drop.classList.remove('dragover');
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (!file) return;
      input.files = e.dataTransfer.files;
      handleFile(file);
    });
  }
}

// Sorts the grid and table (in the same order) by title or by date added.
// Clicking an already-active button flips the direction.
function initSort() {
  const titleBtn = document.getElementById('sort-title-btn');
  const dateBtn = document.getElementById('sort-date-btn');
  const ratingBtn = document.getElementById('sort-rating-btn');
  const grid = document.getElementById('view-grid');
  const tbody = document.querySelector('#view-table tbody');
  if (!titleBtn || !dateBtn || !ratingBtn || !grid) return;

  const KEY = 'watchlist:sort';
  const DEFAULT_DIR = { title: 'asc', added: 'desc', rating: 'desc' };

  function compare(key, dir, a, b) {
    let result;
    if (key === 'title') {
      result = (a.dataset.title || '').localeCompare(b.dataset.title || '', 'ru');
    } else if (key === 'rating') {
      // No rating counts as 0 — always below any rated title (1-10) when
      // sorting descending, per data-rating defaulting to "0" in the markup.
      result = Number(a.dataset.rating || 0) - Number(b.dataset.rating || 0);
    } else {
      result = new Date(a.dataset.added) - new Date(b.dataset.added);
    }
    return dir === 'desc' ? -result : result;
  }

  function apply(key, dir) {
    const cards = [...grid.querySelectorAll(':scope > .card')].sort((a, b) => compare(key, dir, a, b));
    cards.forEach((c) => grid.appendChild(c));

    if (tbody) {
      const rows = [...tbody.querySelectorAll(':scope > .table-row')].sort((a, b) => compare(key, dir, a, b));
      rows.forEach((r) => tbody.appendChild(r));
    }

    titleBtn.classList.toggle('active', key === 'title');
    dateBtn.classList.toggle('active', key === 'added');
    ratingBtn.classList.toggle('active', key === 'rating');
    titleBtn.title = key === 'title' ? tr(dir === 'asc' ? 'list.sortTitleAsc' : 'list.sortTitleDesc') : tr('list.sortByTitle');
    dateBtn.title = key === 'added' ? tr(dir === 'asc' ? 'list.sortDateAsc' : 'list.sortDateDesc') : tr('list.sortByDate');
    ratingBtn.title = key === 'rating' ? tr(dir === 'asc' ? 'list.sortRatingAsc' : 'list.sortRatingDesc') : tr('list.sortByRating');
  }

  let state = { key: 'added', dir: 'desc' };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (saved && saved.key) state = saved;
  } catch {
    /* use the default sort */
  }
  apply(state.key, state.dir);

  function onClick(key) {
    state = state.key === key ? { key, dir: state.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: DEFAULT_DIR[key] };
    apply(state.key, state.dir);
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
  }
  titleBtn.addEventListener('click', () => onClick('title'));
  dateBtn.addEventListener('click', () => onClick('added'));
  ratingBtn.addEventListener('click', () => onClick('rating'));
}

// List search: filters the already-rendered cards/table rows by the text
// stored in data-search (title, description, genres, source, note).
function initSearch() {
  const input = document.getElementById('search-input');
  const empty = document.getElementById('search-empty');
  const clearBtn = document.getElementById('search-clear-btn');
  if (!input) return;

  const cards = [...document.querySelectorAll('#view-grid .card')];
  const rows = [...document.querySelectorAll('#view-table .table-row')];

  function apply() {
    const q = input.value.trim().toLowerCase();
    let visible = 0;
    cards.forEach((c) => {
      const match = !q || (c.dataset.search || '').includes(q);
      c.style.display = match ? '' : 'none';
      if (match) visible += 1;
    });
    rows.forEach((r) => {
      const match = !q || (r.dataset.search || '').includes(q);
      r.style.display = match ? '' : 'none';
    });
    if (empty) empty.hidden = !q || visible > 0;
    if (clearBtn) clearBtn.hidden = !q;
  }

  input.addEventListener('input', apply);

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      input.value = '';
      apply();
      input.focus();
    });
  }
}

// Genre widget on the card: chips + dropdown (own input on top, then a
// scrollable list of already-used genres). Saves immediately on each change.
function initGenrePicker() {
  const picker = document.getElementById('genre-picker');
  if (!picker) return;

  const entryId = picker.dataset.entryId;
  const chipRow = document.getElementById('genre-chip-row');
  const addBtn = document.getElementById('genre-add-btn');
  const dropdown = document.getElementById('genre-dropdown');
  const newInput = document.getElementById('genre-new-input');
  const newAddBtn = document.getElementById('genre-new-add-btn');

  const options = dropdown ? [...dropdown.querySelectorAll('.genre-option')] : [];

  function currentGenres() {
    return [...chipRow.querySelectorAll('.chip-removable')].map((c) => c.dataset.genre);
  }

  // Hide already-added genres from the suggestion list and filter by input —
  // makes it easier to pick an existing tag and less likely to spawn
  // duplicate-typo genres.
  function refreshSuggestions() {
    const filter = newInput.value.trim().toLowerCase();
    const active = currentGenres();
    let anyVisible = false;
    options.forEach((btn) => {
      const genre = btn.dataset.genre;
      const visible = !active.includes(genre) && (!filter || genre.toLowerCase().includes(filter));
      btn.hidden = !visible;
      if (visible) anyVisible = true;
    });
    const list = dropdown.querySelector('.genre-dropdown-list');
    if (list) list.hidden = !anyVisible;
  }

  function makeChip(genre) {
    const chip = document.createElement('span');
    chip.className = 'chip chip-removable';
    chip.dataset.genre = genre;
    chip.textContent = genre;
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'chip-remove';
    rm.setAttribute('aria-label', tr('genre.removeAria', { genre }));
    rm.textContent = '×';
    rm.addEventListener('click', () => removeGenre(genre));
    chip.appendChild(rm);
    return chip;
  }

  async function persist(genres) {
    try {
      const res = await fetch(`/entries/${entryId}/genres`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ genres }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async function addGenre(genre) {
    const g = genre.trim();
    if (!g || currentGenres().includes(g)) return;
    const chip = makeChip(g);
    chipRow.insertBefore(chip, addBtn);
    refreshSuggestions();
    const ok = await persist(currentGenres());
    if (!ok) {
      chip.remove();
      refreshSuggestions();
    }
  }

  async function removeGenre(genre) {
    const chip = [...chipRow.querySelectorAll('.chip-removable')].find((c) => c.dataset.genre === genre);
    if (!chip) return;
    const next = chip.nextSibling;
    chip.remove();
    refreshSuggestions();
    const ok = await persist(currentGenres());
    if (!ok) {
      chipRow.insertBefore(chip, next);
      refreshSuggestions();
    }
  }

  chipRow.querySelectorAll('.chip-remove').forEach((btn) => {
    btn.addEventListener('click', () => removeGenre(btn.closest('.chip-removable').dataset.genre));
  });

  addBtn?.addEventListener('click', () => {
    dropdown.hidden = !dropdown.hidden;
    if (!dropdown.hidden) {
      refreshSuggestions();
      newInput.focus();
    }
  });

  newInput?.addEventListener('input', refreshSuggestions);

  document.addEventListener('click', (e) => {
    if (!picker.contains(e.target)) dropdown.hidden = true;
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') dropdown.hidden = true;
  });

  function submitNew() {
    if (!newInput.value.trim()) return;
    addGenre(newInput.value);
    newInput.value = '';
    dropdown.hidden = true;
  }
  newAddBtn?.addEventListener('click', submitNew);
  newInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitNew();
    }
  });

  options.forEach((btn) => {
    btn.addEventListener('click', () => {
      addGenre(btn.dataset.genre);
      dropdown.hidden = true;
    });
  });

  refreshSuggestions();
}

// Gear menu: theme picker (light/dark/system, stored client-side only) and the
// backup import file trigger. Language lives server-side (see /settings/lang)
// since it needs a page reload to re-render translated content anyway.
function initSettingsMenu() {
  const menu = document.getElementById('settings-menu');
  const dropdown = document.getElementById('settings-dropdown');
  if (!menu || !dropdown) return;

  const toggleBtn = document.getElementById('settings-toggle-btn');
  toggleBtn?.addEventListener('click', () => {
    dropdown.hidden = !dropdown.hidden;
  });
  document.addEventListener('click', (e) => {
    if (!menu.contains(e.target)) dropdown.hidden = true;
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') dropdown.hidden = true;
  });

  const THEME_KEY = 'wl-theme';
  const themeButtons = [...document.querySelectorAll('#theme-switch .settings-opt')];

  function applyTheme(pref) {
    const dark = pref === 'dark' || (pref === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.removeAttribute('data-theme');
    if (!dark) document.documentElement.setAttribute('data-theme', 'light');
    themeButtons.forEach((b) => b.classList.toggle('active', b.dataset.themeChoice === pref));
  }

  let savedTheme = 'auto';
  try {
    savedTheme = localStorage.getItem(THEME_KEY) || 'auto';
  } catch {
    /* localStorage unavailable — falls back to system preference */
  }
  applyTheme(savedTheme);

  themeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      applyTheme(btn.dataset.themeChoice);
      try {
        localStorage.setItem(THEME_KEY, btn.dataset.themeChoice);
      } catch {}
    });
  });

  // Live-follow the OS theme while "system" is selected and the page stays open.
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    let pref = 'auto';
    try {
      pref = localStorage.getItem(THEME_KEY) || 'auto';
    } catch {}
    if (pref === 'auto') applyTheme('auto');
  });

  const importBtn = document.getElementById('backup-import-btn');
  const importInput = document.getElementById('backup-file-input');
  const importForm = document.getElementById('backup-import-form');
  importBtn?.addEventListener('click', () => importInput?.click());
  importInput?.addEventListener('change', () => {
    if (importInput.files?.length) importForm?.requestSubmit();
  });
}

// List (a collection of titles within an account) — the switcher next to the
// gear icon. Switching/creating/deleting a list is a plain form-POST to
// /settings/list* (reloads the page, since it changes which entries are
// shown at all); this here only handles opening/closing the dropdown and a
// live input filter, like the genre dropdown.
function initListSwitcher() {
  const switcher = document.getElementById('list-switcher');
  const dropdown = document.getElementById('list-switcher-dropdown');
  if (!switcher || !dropdown) return;

  const toggleBtn = document.getElementById('list-switcher-btn');
  const input = document.getElementById('list-switcher-input');
  const rows = [...document.querySelectorAll('.list-switcher-option-row')];

  // Renaming — clicking ✏️ hides the normal row (switch/delete) and shows a
  // text-field form in its place, in the same row. The default list has no
  // rename form at all (it can't be renamed) — querySelector returns null,
  // hence the optional chaining.
  function stopRenaming(row) {
    const view = row.querySelector('.list-switcher-view');
    if (view) view.hidden = false;
    const form = row.querySelector('.list-switcher-rename-form');
    if (form) form.hidden = true;
  }
  function stopAllRenaming() {
    rows.forEach(stopRenaming);
  }

  toggleBtn?.addEventListener('click', () => {
    dropdown.hidden = !dropdown.hidden;
    if (!dropdown.hidden) {
      input?.focus();
      input?.select();
    } else {
      stopAllRenaming();
    }
  });
  document.addEventListener('click', (e) => {
    if (!switcher.contains(e.target)) {
      dropdown.hidden = true;
      stopAllRenaming();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      dropdown.hidden = true;
      stopAllRenaming();
    }
  });

  input?.addEventListener('input', () => {
    const filter = input.value.trim().toLowerCase();
    rows.forEach((row) => {
      row.hidden = filter !== '' && !row.dataset.listName.includes(filter);
    });
  });

  rows.forEach((row) => {
    const renameBtn = row.querySelector('.list-switcher-rename-btn');
    const cancelBtn = row.querySelector('.list-switcher-rename-cancel');
    renameBtn?.addEventListener('click', () => {
      row.querySelector('.list-switcher-view').hidden = true;
      const form = row.querySelector('.list-switcher-rename-form');
      form.hidden = false;
      const renameInput = form.querySelector('.list-switcher-rename-input');
      renameInput.focus();
      renameInput.select();
    });
    cancelBtn?.addEventListener('click', () => stopRenaming(row));
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initAddDialog();
  initViewToggle();
  initSort();
  initTableRowLinks();
  initCoverUrlCheck();
  initCoverFilePreview();
  initGenrePicker();
  initSearch();
  initConfirmButtons();
  initGoogleImageLinks();
  initAutoSubmitSelects();
  initCoverFallbackImages();
  initCoverLightbox();
  initSettingsMenu();
  initListSwitcher();
});
