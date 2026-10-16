# TidyDesk — Design Spec

Date: 2026-10-16
Status: Draft, awaiting review

## 1. Purpose

TidyDesk is a free, open-source Windows desktop app that:

1. Cleans junk and temporary files to free disk space.
2. Organizes a folder by sorting its files into category subfolders.
3. Finds byte-identical duplicate files and removes the extra copies.

Every action is recorded and can be restored for a limited time. The app ships as a Windows installer, built from a public GitHub repo.

### Success criteria

- A user can see how much space each junk category uses, clean it, and see the result.
- A user can organize a folder, review the plan first, and undo it in one click.
- Duplicates are found only by content (SHA-256), never by name alone.
- Nothing is removed without a review step, and every removal can be restored for 5 hours (configurable).
- The Dashboard shows a full history of what was deleted or moved, with restore buttons.
- `npm run dist` produces `TidyDesk-Setup-x.y.z.exe`, and pushing a `v*` tag publishes it to GitHub Releases.

### Non-goals (v1)

- macOS or Linux builds. The code stays portable, but only Windows is built and tested.
- Registry cleaning. It is risky and the gain is negligible.
- Code signing. The installer is unsigned, and the README documents the SmartScreen warning.
- Auto-update.

## 2. Stack

| Concern | Choice |
|---|---|
| Shell | Electron (latest stable) |
| Build tooling | electron-vite (Vite for main, preload and renderer) |
| UI | React 18, TypeScript, Tailwind CSS, lucide-react icons |
| Tests | Vitest (main-process logic, against real temporary folders) |
| Packaging | electron-builder, NSIS target |
| CI | GitHub Actions on `windows-latest` |

Electron was chosen over Tauri because the Rust toolchain isn't set up on this machine, and over a Python GUI because it gives the most modern look.

## 3. Architecture

```
Renderer (React)  ──window.tidy API──▶  Preload (contextBridge)  ──IPC──▶  Main (Node)
     ▲                                                                      │
     └──────────────── progress / history-changed events ◀──────────────────┘
```

- **Main process:** does all file-system work. The renderer has `contextIsolation: true`, `nodeIntegration: false` and `sandbox: true`.
- **Preload:** exposes a small, typed `window.tidy` API. Types are shared from `src/shared/types.ts`.

### Main-process modules (`src/main/`)

| Module | Responsibility |
|---|---|
| `disk.ts` | Free and total space per fixed drive. |
| `junk.ts` | Defines the junk categories, scans them for file lists and sizes, cleans the selected categories through the Safe Bin. |
| `organizer.ts` | `planOrganize(dir)` returns a list of moves. `applyOrganize(plan)` runs them and records history. |
| `duplicates.ts` | `findDuplicates(dir, minSize)`: groups by size, then by a 64 KB head hash, then by full SHA-256. |
| `safebin.ts` | `quarantine(files, meta)` moves files into the Safe Bin and creates a batch. `restore(batchId, files?)` and `purge(batchId)` act on a batch. `purgeExpired()` purges batches past their hold time. |
| `recyclebin.ts` | Lists Windows Recycle Bin items with their deletion dates and permanently deletes those older than the hold time, through PowerShell and Shell.Application. |
| `history.ts` | Append and read the activity log, kept in `%APPDATA%\TidyDesk\history.json`. |
| `scheduler.ts` | Runs `purgeExpired()` and the Recycle Bin sweep at startup and every 5 minutes. |
| `guards.ts` | `isProtectedPath(p)`: refuses `C:\Windows`, `Program Files*`, `ProgramData`, drive roots and the Safe Bin itself. |
| `settings.ts` | Settings stored as JSON in `%APPDATA%\TidyDesk\settings.json` (see §6.5). |
| `tray.ts` | Tray icon. Closing the window hides it to the tray, and the tray menu has Quit. |

Each module is pure logic plus `fs`, with no Electron imports except `tray.ts`, `index.ts` and IPC wiring. That makes them unit-testable.

## 4. Safe Bin (deletion model)

Every removal goes through the Safe Bin. Nothing else in the code calls `fs.rm` on user files.

- **Location:** one hidden folder per drive, `<Drive>:\.tidydesk-bin\<batchId>\`. Moving within the same drive is a rename, so it's instant.
  - If the bin can't be created on a drive (no permission), files from that drive fall back to the user-profile drive. That's a copy plus delete across drives, which is slower but still works.
- **Batch:** one user action (one clean, one duplicate removal). Its record holds:
  - `id`, `type` (`junk` | `duplicates`), `createdAt`, `expiresAt` (createdAt + hold time)
  - `items[]`: `{ originalPath, binPath, size }`
  - `status`: `held` | `restored` | `purged` | `partial`
- **Restore:** moves each item back to `originalPath`, recreating parent folders if needed. If a file now exists at that path, it restores as `name (restored).ext` and the item is reported. Restoring part of a batch (single files) is supported.
- **Purge:** permanently deletes the batch folder. It runs automatically when the batch expires, or when the user clicks **Delete now**.
- **Locked files:** files that can't be moved (in use or access denied) are skipped and counted. They are reported in the result and in history as `skipped`.

## 5. Windows Recycle Bin sweep

- The sweep **is on by default**, controlled by the setting `sweepWindowsRecycleBin`.
- It runs from the scheduler. It permanently deletes every item in the Windows Recycle Bin, on all drives, whose deletion date is more than `holdHours` ago. That includes items the user deleted outside TidyDesk.
- **How it works:** a PowerShell script uses `Shell.Application` on `Namespace(10)` and reads each item's `System.Recycle.DateDeleted`. For expired items it removes the `$R…` payload and its matching `$I…` metadata file.
- **Failure handling:** errors are logged and do not interrupt the app.
- **Disclosure:** a one-time notice on first run explains this behaviour and links to the toggle.
- **History:** each sweep that removed anything adds a history entry ("Recycle Bin: 37 items older than 5h permanently deleted, 1.2 GB").

## 6. Features

### 6.1 Junk Cleaner

| Category | Paths |
|---|---|
| User temp | `%TEMP%` |
| Windows temp | `C:\Windows\Temp` (only what the user's account can access) |
| Browser cache | Chrome, Edge, Brave: `…\User Data\*\Cache`, `Code Cache`, `GPUCache`. Firefox: `%LOCALAPPDATA%\Mozilla\Firefox\Profiles\*\cache2` |
| Thumbnail cache | `%LOCALAPPDATA%\Microsoft\Windows\Explorer\thumbcache_*.db` |
| Crash dumps & error reports | `%LOCALAPPDATA%\CrashDumps`, `%LOCALAPPDATA%\Microsoft\Windows\WER` |
| Windows Recycle Bin | Its current contents. Cleaning it empties it straight away (with confirmation) and does not go through the Safe Bin. |

- **Flow:** Scan, then a list of categories with sizes and checkboxes, then Clean, then a result card.
  - The result card shows "X GB moved to Safe Bin, freed in 5h", with **Free now** (purge immediately) and **Restore** buttons.
- **Scanning:** files modified in the last 1 hour are excluded so the cleaner doesn't break running programs. Browser caches are skipped (with a note) if that browser is running.

### 6.2 Folder Organizer

- **Scope:** the user picks a folder. Only top-level files move. Existing subfolders and hidden or system files are left alone.
- **Categories by extension:** Images, Documents, Spreadsheets, Presentations, Videos, Music, Archives, Installers, Code, Other.
- **Preview:** a table of file, category and destination. The user can untick rows.
- **Name clashes:** a clash at the destination is resolved as `name (1).ext`, `name (2).ext` and so on.
- **History:** applying the plan records an `organize` history entry with every `{ from, to }` pair.
- **Undo:** moves each file back and removes category folders that are now empty and were created by this action.
  - Organize entries never expire, because nothing is deleted.
  - Undo is available from the result screen and from the Dashboard.

### 6.3 Duplicate Finder

- **Scope:** the user picks a folder; subfolders are included. Files below `minDuplicateSize` (default 1 KB) are ignored, and protected paths are refused.
- **Matching:**
  1. Group files by size.
  2. Within each size group, hash the first 64 KB.
  3. Within each matching head-hash group, compute the full SHA-256 as a stream.
  4. Only files whose full hashes are equal count as duplicates.
- **Progress:** files scanned, bytes hashed, and a Cancel button.
- **Results:** one card per group, showing a thumbnail for images or an icon otherwise, plus path, size and modified date.
  - The oldest file is marked **Keep** by default and the user can change it. Each group must keep at least one file.
  - Bulk rules: keep oldest, keep newest, or keep shortest path.
- **Removal:** a confirmation dialog shows the count and the size to reclaim, then the files go to the Safe Bin as a `duplicates` batch.

### 6.4 Dashboard

- **Disk usage:** a ring per drive.
- **Quick stats:** reclaimable junk from the last scan, space currently held in the Safe Bin, and total space freed all-time.
- **Recent Activity timeline:** every history entry (junk, duplicates, organize, recycle-sweep) with time, counts and size.
  - Expanding an entry lists every file with its original path and its current location.
  - Held batches show a live countdown ("Restorable for 3h 12m"), **Restore all**, per-file **Restore**, and **Delete now**.
  - Organize entries show **Undo** until undone.
  - Purged entries show "Permanently deleted at …" and have no restore button.
- **Quick Clean button:** runs a junk scan with the default categories.

### 6.5 Settings

| Setting | Default |
|---|---|
| Theme (dark, light, system) | system |
| `holdHours` (Safe Bin and Recycle Bin sweep) | 5 |
| `sweepWindowsRecycleBin` | true |
| `minDuplicateSize` | 1 KB |
| `closeToTray` | true |
| `startWithWindows` | false |

## 7. History storage

- **File:** `%APPDATA%\TidyDesk\history.json`. It's written atomically (temp file then rename) and capped at the last 500 entries.
- **Large file lists:** for entries with more than 2,000 items, the file list is stored in a sidecar file, `history/<id>.json`.
- **Safe Bin batch records:** these live inside their history entries, so there is a single source of truth.
- **Corrupt file:** if `history.json` is corrupt, it's renamed to `history.corrupt-<ts>.json` and a fresh file is started. A Safe Bin folder with no record is never deleted automatically; it shows on the Dashboard as "Orphaned items" with Restore and Delete options.

## 8. UI and design

- **Layout:** a sidebar (Dashboard, Junk Cleaner, Organizer, Duplicates, Settings) and a content area. Dark theme first, with a light theme.
- **Style:**
  - Accent colour: indigo to violet gradient.
  - Glass-style cards (subtle borders, rounded-2xl).
  - Animated progress rings and bars.
  - Sizes shown as KB, MB or GB to one decimal place.
- **Window:** frameless with custom title-bar controls, 1100×720 by default, 900×600 minimum.
- **Accessibility:**
  - Every action is keyboard-reachable.
  - Focus rings are visible.
  - Status is never shown by colour alone.

## 9. Error handling

- **IPC results:** every IPC call returns `{ ok: true, data } | { ok: false, error }`, and the renderer shows errors as toasts.
- **Partial success is normal.** Results report counts for processed, skipped (in use) and failed (with reasons).
- **Protected paths:** guards reject them at IPC entry with a readable message.
- **Long operations:** these run asynchronously in the main process, send progress events at most 10 times a second, and can be cancelled.

## 10. Testing

Vitest unit tests run against real temporary folders:

- **organizer:** planning, collision naming, apply and then undo round-trip.
- **duplicates:** identical content with different names, same size with different content, and empty input.
- **safebin:** quarantine, restore (including a conflict at the original path), purge and expiry.
- **guards:** protected-path matrix.
- **history:** atomic write, the cap, and corrupt-file recovery.

`recyclebin.ts` and the junk path definitions are checked by hand on Windows, because they touch real system locations.

Before release, the app is launched with `npm run dev` and each feature is exercised. The installer is built with `npm run dist`, installed, launched and uninstalled.

## 11. Repo and release

- **Repo files:** `README.md` (features, screenshots, install, SmartScreen note, build from source), `LICENSE` (MIT), `.gitignore`, and `build/icon.ico` plus `icon.png`.
- **electron-builder (NSIS):**
  - Not one-click: the user can choose the install directory.
  - Desktop and Start Menu shortcuts, and an uninstaller.
  - The uninstall does not touch Safe Bin folders. The README explains how to remove them.
- **Release workflow:** `.github/workflows/release.yml` runs on a `v*` tag. It runs `npm ci`, the tests and `npm run dist`, then uploads `TidyDesk-Setup-*.exe` to the GitHub Release.
