# Design principles

> Seamless, wordless but straightforward, so that no one asks how: hide the words but do not
> eliminate them; use symbols, icons and tooltips.

What that means in Pharos:

- **A symbol leads.** A control shows its icon; its words move into its tooltip and its accessible
  name. They are never deleted.
- **Meaning without reading.** Someone who doesn't read the label still knows what a control does
  from its symbol and where it sits.
- **No instructions on screen** where a symbol and a tooltip do the job. A how-to or an explanation
  waits behind an (i) (`InfoTip`), or behind a click (`<details>`) when it is long.
- **One icon, one meaning,** everywhere in the app (the vocabulary below).
- **Nothing hidden that's needed.** A control that shows on hover also shows on keyboard focus, and
  on a touch screen it is either always there or in the item's ⋯ menu. A tooltip opens on hover
  (after a short wait), on keyboard focus (at once) and on a long press (touch); an (i) also opens
  on a tap.
- **Screen readers lose nothing.** The floating tooltip is `aria-hidden`; the same words are the
  control's accessible name (`label` matches its `aria-label`) and, for longer words, its
  description (`detail`, wired with `aria-describedby`). Tests query by those names.

One component does it: `Tooltip` and `InfoTip` in `apps/web/src/catalog/tooltip.tsx`. Never a raw
`title=` on a control.

## Checks for a screenshot

A reviewer can apply each one to a picture of a page (light and dark, 1200 px and 390 px):

1. **Text-only button** where an icon would carry it (a repeated action: new, edit, delete, copy,
   history, options). Primary calls to action on an empty page may keep a word next to the icon.
2. **A sentence of instructions** on screen ("Drag … to …", "Type or paste …", "Set X and restart
   …") that could sit behind an (i).
3. **Two icons for one meaning,** or one icon for two meanings (check against the vocabulary).
4. **A hover-only control** with no focus path, or one a touch screen can't reach.
5. **An icon-only control with no tooltip** (hover it: words must appear, in the same dark chip).
6. **A notice longer than one line** at 1200 px whose key words could lead with the rest in a
   tooltip, or a status sentence where "Paused", "Off" or "Failed" would do.
7. **A section heading without its symbol** in Settings, or a description paragraph under a
   heading.
8. **Words that were deleted rather than moved:** every fact in the before shot must still be one
   hover, tap or focus away in the after shot.
9. **A tooltip that is clipped** by a scrolling row or the screen edge (it must sit 8 px inside).
10. **Overflow at 390 px:** a horizontal scroll, a tab row whose active tab is reduced to an icon
    because a word button took its room.
11. **Idle motion on chrome** (the logo, the sidebar): nothing moves unless something happened.
12. **A listed item that doesn't open on click** (a run chip, a desk row, a folder).

## Icon vocabulary

Lucide icons. One line each: icon → meaning.

- `Plus` → make something new (project, folder, section, view, block)
- `MoreHorizontal` (⋯) → this item's options menu
- `Pin` / `PinOff` → pinned, pin / unpin
- `Pencil` → rename or edit text
- `Trash2` → delete or remove (red in menus)
- `Archive` / `ArchiveRestore` → archived, archive / restore
- `X` → close, hide or dismiss (never delete)
- `History` → history of changes
- `Undo2` → undo the last change
- `RotateCcw` → reset to the default (a layout)
- `Info` → more words about this (the (i), `InfoTip`)
- `ChevronRight` → a group that opens and closes
- `ChevronDown` → more of the same row (overflow menu, select)
- `Inbox` → the desk (what waits on you)
- `Settings` → Settings
- `PanelLeftClose` / `PanelLeftOpen` → hide / show the sidebar
- `FolderGit2` → a sidebar folder (a repository that groups projects)
- `Layers` → a sidebar section
- `FolderOpen` → files and folders on disk (Files page, Settings folders)
- `LayoutGrid` → a board (a view of blocks), and editing its layout
- `Newspaper` → a report (page or document)
- `MessageCircleQuestion` → a question and its answer
- `BookmarkPlus` → keep an answer as a view
- `Scale` → a decision
- `ListChecks` → a task
- `FileText` → a sheet to review
- `Clock` → how long it has waited
- `Lock` → only you can do it
- `CircleCheck` → finished fine
- `AlertTriangle` → failed or partly done
- `Loader2` (spinning) → running now
- `RefreshCw` → refresh, or a newer version to load
- `Copy` / `Check` → copy / copied or done
- `Bot` / `User` / `Cog` → an agent / a person / Pharos itself
- `SquareTerminal` → the agent panel (your agent CLI beside the page, R17)
- `Crosshair` → point the agent at something on the page (the picker)
- `TextQuote` → point the agent at the selected words
- `EyeOff` / `Tags` / `BookOpen` → folder levels: hidden / details / contents
- `ShieldAlert` → limits of what Pharos can enforce
- `Palette`, `Database`, `Cable` → Settings: appearance, data, connecting an agent
- Dots: status colour (project status), sky dot → changed since you looked, purple halo → an
  agent working there now, amber dot on Settings → answering paused
