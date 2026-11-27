# Files: opening, saving and tabs

This page covers the start screen, opening and saving drawings, autosave, accounts and signing in, working with several drawings in tabs, starting new drawings and templates, a drawing's units and file information, sharing and embedding drawings, and the desktop app. Bringing in other formats is covered in [Importing, exporting and printing](import-export.md).

## The start screen

Rodeo opens on its start screen, a card over the editor, until a drawing is open. **Window › Home Screen** brings it back over a drawing (**Back to drawing** or <kbd>Esc</kbd> returns).

Its first column starts work:

- **Open file…** opens a drawing, and a file dropped anywhere on the window opens too. It takes Vectorworks, Revit, AutoCAD, SketchUp, Rhino and Archicad files among others: see [Importing, exporting and printing](import-export.md).
- **New drawing** and **From template…** start one. **Open from Cloud…** is there once you are signed in.
- **Recent** lists the drawings opened lately from this computer and, when you are signed in, from the cloud. Before there are any, four lines say what Rodeo does.

Its second column shows what Rodeo can be:

- **Work like the app you know** has a picture of each layout of [Work Like](workspace.md#work-like): Rodeo's own, Archicad, AutoCAD, Illustrator, Revit, Rhino, SketchUp and Vectorworks. A click puts that layout on, and the editor behind the card rearranges itself. It is the same choice as **View › Work Like**, and is left out on a phone, which keeps Rodeo's touch layout.
- **Create a free account** is there while you are not signed in: what an account adds, **Continue with Google** and **Continue with email**. See [Your account](#your-account).
- **What's new** takes its place once you are signed in: the three newest releases, and **See all** for the whole list.

The links along the foot open What's new, the user guide, the gallery, the converter, the desktop app's downloads, feedback and donations, and the list at their end changes the interface's language.

## Opening and saving

### Open, Save and Open Recent

Open a `.vwx` file with **Open** or by dropping it on the window. **Open** also opens DWG files and Revit and Archicad projects as new drawings, as described in [Importing, exporting and printing](import-export.md). **Save** writes back to the same file where the browser allows it (Chrome/Edge File System Access API); otherwise it downloads a copy. In the desktop app, **Save** always writes back to the same file.

Files saved by Vectorworks 2020 or later open as they are. A file saved by Vectorworks 2018 or 2019, or in the Vectorworks 2013, 2016 or 2017 format, opens converted to the current format, in the file's units, and **Save** asks where to write, so the original file stays as it was. That includes a file a newer Vectorworks exported for one of those versions.

- **Vectorworks 2018 and 2019:** the drawing comes in whole, 2D and 3D, with its images, worksheets and textures. Only the data attached to objects (record fields, plug-in settings) and wall and slab styles aren't read yet.

- **Vectorworks 2017:** the drawing comes in whole, 2D and 3D: lines, shapes, text, dimensions, dashed line types, groups, symbol definitions, plug-in objects as drawn, meshes, extrudes and solids, layers, sheets with their viewports, and classes.
- **Vectorworks 2016:** lines, polygons, polylines, symbols, plug-in objects as drawn, layers and classes, and extrudes and sweeps in 3D.
- **Vectorworks 2013:** its 2D only: lines, shapes, text, symbols, plug-in objects as drawn, layers, sheets and classes.

**Limits:** images, worksheets, textures and the data attached to objects (record fields, plug-in settings) aren't read from the 2013, 2016 and 2017 formats. This is checked on four drawings exported for Vectorworks 2018 (each draws the same as the same drawing exported for 2022), two files saved by Vectorworks 2019, one drawing exported for Vectorworks 2017 (it draws the same as the same drawing exported for 2021, in every layer and in 3D), three files saved by Vectorworks 2016 and one saved by Vectorworks 2013. No file saved by Vectorworks 2014 or 2015 has been tested: one laid out as one of those formats opens the same way, and any other is refused with the year it was saved in and the reason. None of the 2016 files holds a rectangle, oval, arc, text, dimension or viewport, so in a 2016 file those are read as Vectorworks 2013 wrote them where the record fits that layout and left out where it doesn't. Files from before 2013 are refused with the year they were saved in. A file cut short, such as one only partly downloaded, is refused with a message saying so.

### When a file doesn't open

When a file won't open, a card over the drawing says why in a line and asks for the file. Give your email under **Email me when it opens**, then **Send file**: the file goes to the Rodeo team, and when a fix lands that opens it, you get an email. Everyone whose file failed the same way hears at once. Only the Rodeo team sees the file, and it's deleted after 90 days. A file too large to send can't go with it, but **Tell me** still puts you on the list. **Not now** closes the card; each file is asked about once on a device.

**File › Open Recent** lists the drawings opened or saved that way (the browser keeps their file handles, not the drawings). **File › Revert** reopens the saved file.

If opening or saving stops partway, try the command again. A save that fails leaves the file as it was and your changes unsaved, so keep the drawing open until a save goes through. When **Save** downloads a copy, changes you make while it is being written stay unsaved, and the next save includes them.

### Save a Copy As… and Save All

**File › Save a Copy As…** writes the drawing as it stands to a new file, while the window goes on working on its own.

**File › Save All** saves every open drawing with unsaved changes, asking where for one never saved.

### Autosave

While a drawing has unsaved changes, a copy of it is kept in the browser every 5 minutes, one for each open drawing, those in background tabs too. The copies are offered back when Rodeo starts after a crash or a closed tab, and a recovered drawing opens with its changes unsaved: save it to keep them. **Edit › Preferences…** sets how often, or turns it off.

Saving or closing a drawing removes its copy, and a copy no one recovers is deleted after seven days. Another Rodeo window that is still open keeps its own copies.

**Limits:** in the browser, drawings over 150 MB are not copied, since writing one out takes as much memory again. The desktop app copies drawings of any size; see [The desktop app](#the-desktop-app).

### Restore a cloud version

**File › Version History** lists the saved versions of a cloud drawing. Choose **Restore** on an older version to make a new current version from it. Once the restore succeeds, everyone in the live session reloads that version.

If the restore is refused because there is no room on the owner's plan, or the server cannot save it, the current version and pending live edits stay intact. Make room or resolve the error before trying again.

## Your account

### What an account adds

Rodeo works without an account: opening, drawing, saving to your computer, importing and exporting need none. A free account adds drawings kept in the cloud that open on any device, a version history for each, share links and embeds, editing together with comments, and the AI agents, AI renders, cloud renders and voice commands (those are paid for as they are used). Files you open stay on your computer unless you save them to the cloud.

### Signing in

**Sign in** is at the end of the top bar and on the start screen. In a [Work Like](workspace.md#work-like) layout without the top bar it is at the end of the menu bar or title bar, where those applications have theirs. Signing in for the first time makes the account; there is no password.

- **Continue with Google** signs in with a Google account.
- **Email me a sign-in link** sends a link that works once, for 15 minutes.

Signing in never costs you the drawing that is open. With a drawing open, Google's pages open in a small window of their own, and the editor signs in by itself when that window is done. An emailed link opens in a new tab, and the tab you asked from signs in too, as long as the link is opened in the same browser. Whatever asked you to sign in (saving to the cloud, sharing, an agent) then carries on. With no drawing open, the page goes to Google and comes back signed in.

### The offer to save to the cloud

When you are not signed in and have worked on a drawing for a while (a few changes, or a few minutes), a card over the foot of the drawing offers **Save to Cloud**. Taking it asks you to sign in and then saves the drawing, as **File › Save to Cloud…** does. **Not now** or its × puts the offer off for a week, and it shows at most once a visit.

**Limits:** the sign-in window needs pop-ups allowed for Rodeo; where the browser refuses it, the page goes to Google instead, and the browser asks before leaving a drawing with unsaved changes. A link opened in another browser, or in a private window, signs in there and not in the tab that asked.

## The desktop app

### Getting it

The desktop app is the whole editor in a window of its own, for macOS, Windows and Linux. It needs no browser and no account, and it works with the network off.

Downloads are on the project's releases page at [github.com/rodeobuild/rodeo/releases](https://github.com/rodeobuild/rodeo/releases). Look for the release titled "Rodeo desktop". Each installer has a `.sha256` checksum file to compare the download against, to check that it arrived whole.

- **Mac:** a `.dmg`, for Apple Silicon and Intel Macs alike.
- **Windows:** a setup `.exe`.
- **Linux:** a `.deb` and an AppImage.
- **Any browser:** `Rodeo-<version>-web.zip`, the same editor as a plain folder. Unzip it and serve the folder with any static file server.

The builds are not signed yet, so the first launch needs one step. On a Mac, right-click **Rodeo** in Applications and choose **Open**, or allow it in **System Settings › Privacy & Security**. On Windows, when SmartScreen stops the app, choose **More info**, then **Run anyway**.

### What works with no connection

With the network off, the app opens, edits and saves `.vwx` drawings, shows them in 3D, renders them (Realistic, Path Traced and Render Image), runs scripts and imports every format the web editor imports. Python is inside the app, so Run Script needs no download.

Some features run on rodeo.build and are not in the app: sign-in and cloud drawings, editing together, share links and embeds, agents, AI Render and cloud renders, the Gallery, and voice transcription. Their menu rows are hidden, or greyed out with the reason. **Help › Rodeo on the Web…** opens rodeo.build in your browser.

**File › Import › Import Site Context…** and the place search in Sun Study work when you are online. Without a connection they are greyed out with the reason "This needs an internet connection".

### Files in the app

**File › Open…** and **File › Save As…** use the system's own file dialogs. **Save** writes back to the same file, and no temporary copy is left beside it.

**File › Open Recent** and the start screen list recent files with the folder each one is in. The app keeps that list itself.

Double-click a `.vwx` file to open it in Rodeo, or choose **Open With › Rodeo**. Rodeo offers itself for the formats it reads and takes none of them over from another app.

Drop a file on the Rodeo window to open it. Every export and download asks where to save the file.

### Autosave in the app

The app keeps its autosave copies in a folder on the computer. They are streamed from the drawing, so a drawing of any size is copied, and the 150 MB limit of the browser does not apply. A drawing of 256 MB or more is copied at most every 15 minutes.

After a crash, the copy is offered when Rodeo next starts.

### Updates

Nothing installs itself. **Help › Check for Updates…** looks for a newer version and offers its download page.

**Help › Check for Updates Automatically** is on by default. With it on, Rodeo makes one quiet check a week while you are online, and shows a note if a newer version is out. Turn it off and the app never contacts the network by itself. An older version keeps working.

**Limits:** the builds are not signed yet, so the first launch needs the step under Getting it. Print saves a PDF to print from, and there is no print dialog. <kbd>⌘Q</kbd> and the window's close button ask about unsaved changes. Quitting from the Dock, logging out and a forced quit do not, and the autosave copy is offered at the next start, by default at most 5 minutes old. On a Mac the 3D view draws at up to 60 frames a second. The Windows and Linux builds are new and have been tested less than the Mac one. The first time the app reopens a recent file from Desktop, Documents or Downloads, macOS asks whether it may, and an unsigned build is asked again after each update.

## Sharing and embedding

### Editing together

A cloud drawing shared with editors is edited live: everyone's changes, and their agents', show as they are made. Changes to different things all stand, wherever they are in the drawing, so an agent can build while you move things elsewhere. Two people or agents adding classes, symbols or names at the same moment both keep theirs. A class both add under one name becomes one class holding what each put in it; a name both give to different things gets "(2)" on the later one.

Only two changes to the same thing at the same moment clash, such as two renames of one class: the later one is undone, with a message saying so.

Should a change from someone else fail to apply here, editing together stops with a message: keep a copy of your work and reopen the drawing. A file uploaded over a cloud drawing from outside its live session is refused if someone edits it live meanwhile; reopen the drawing to see their changes first.

**Limits:** when a change of yours is made again because someone else's came first, Undo can't take it back, nor what you did before it. A Rodeo page open since before an update stops editing live and asks to be reloaded.

### Share links

**File › Share › People and Links…** on a cloud drawing you own or edit makes public view-only links. Anyone with the link sees the drawing in 2D and 3D in their browser without an account. With **Allow download** they can also download it, or **Edit a Copy** as a drawing of their own. Pasted into Slack, Discord, iMessage, X or LinkedIn, a link shows the drawing's name, who shared it and a picture of it. **Revoke** turns a link off at once.

### Previews

Each link has a still picture and, when its embed starts in 3D, a turning one. Rodeo makes them from what you see the first time a link's panel opens with the drawing open, or when you press **Make Preview**; **Update Preview** makes them again after the drawing changes, and the dialog says when it has.

### Embedding a drawing

Under a link, **Embed and preview** sets how an embed starts: in 2D or 3D, on a layer or sheet, fitted or from the view you see now, turning slowly, light or dark, and with full, minimal or no controls. Copy the **Embed** code (an iframe) into a web page, the **Web component** (`<rodeo-viewer>`, which sizes itself to the page), the **Viewer link** for Notion's /embed block, or **Markdown** (a picture that opens the drawing, for READMEs). An embed has 2D and 3D, Fit, Turn, Full screen and **Open in Rodeo**, and works on phones.

### Opening a file from a web address

`https://rodeo.build/?url=` followed by a file's address opens a public drawing in any format Rodeo reads, such as `https://rodeo.build/?url=https://github.com/you/house/blob/main/house.vwx`. `https://rodeo.build/?embed&url=…` shows it in an embed. Your browser fetches the file, not Rodeo's server, so the site must allow it, as raw files on GitHub do.

**Limits:** previews don't update by themselves when the drawing changes. An embed loads the whole editor, so its picture shows first and the drawing a few seconds later. In 2D an embed pans and zooms but doesn't select. WordPress needs a plug-in that allows Rodeo's embeds, and Notion and Medium show a link card until they list Rodeo as a provider. Files opened from an address must be under 300 MB, and nothing an embed changes is saved.

## Tabs

Each drawing opened goes in a tab of its own, so you can work on several at once. A strip of tabs shows over the drawing while one is open, and each comes back to the front as it was left (layer, class, selection, view and undo). A dot on a tab means unsaved changes.

- The **+** at the end of the strip starts a new drawing, or opens one (**New Drawing**, **New from Template…**, **Open…**, **Open Recent**).
- A click brings a tab to the front; a middle-click closes it; <kbd>←</kbd> and <kbd>→</kbd> move between tabs once one has the focus.
- **File › Close** or a tab's × closes one, asking first about unsaved changes, and about an agent at work in it.
- **File › Close All** closes them all (Cancel on one stops there).
- **Window › Drawings** lists them.
- **Window › Show Document Tabs** hides the strip.
- **Window › Home Screen** brings [the start screen](#the-start-screen) back over the drawing (Back to drawing or <kbd>Esc</kbd> returns).

Each drawing has an agent of its own in the Agents panel, and they work at the same time: see [The Agents panel](workspace.md#the-agents-panel). A tab shows what its agent is doing: a spinner while it works, an amber pause when it is waiting for the tab to come to the front, and a spark when it finished while you were in another tab (red if it stopped with an error).

## New drawings and templates

### New

**File › New** (New drawing on the start screen) starts a blank drawing, "Untitled 1": one design layer and the class None, in feet and inches where the browser's region measures in them and millimetres elsewhere (**File › Document Settings › Units** changes that).

Its lines, rectangles, polygons, polylines, arcs, text and groups are written from Rodeo's own records rather than copied from the drawing.

**Limits:** whether Vectorworks opens a drawing started this way is not yet confirmed.

### New from Template…

**File › New from Template…** opens a Vectorworks template (`.sta`, or any `.vwx`) as a new drawing in the same way, leaving the template as it was. **Save** asks where the new drawing goes.

### Save as Template…

**File › Save as Template…** writes the drawing as a `.sta` for that (**New from Template…**), while the window goes on working on its own file.

## Units and file information

### Units

**File › Document Settings › Units…** sets the length unit, from millimetres to miles or feet and inches, with its area and volume units. Nothing moves: lengths show and are typed in the new unit.

### File Info

**File › File Info…** lists the open file's name, size, the Vectorworks versions and build it names, its units and what it holds.

## The Gallery

### Publish to Gallery…

**File › Share › Publish to Gallery…** puts a cloud drawing in the public gallery at [rodeo.build/gallery](https://rodeo.build/gallery). Only the drawing's owner can publish it; a drawing that isn't in the cloud asks to be saved there first.

Give it a title, a description, up to six tags and the name to credit, choose a licence (CC BY 4.0 unless you choose CC BY-SA 4.0, CC BY-NC 4.0 or CC0) and a cover: the drawing, or the 3D view as it is on screen.

The gallery shows a snapshot of the version you publish, saved first if it has unsaved changes. Later changes stay private until you open the dialog again and choose **Publish This Version**. The same dialog changes the details, replaces the cover or unpublishes it.

Everything in the published version is public, hidden layers and classes too. Earlier versions, comments and the people you share the drawing with stay private.

### Browsing and forking

Anyone can browse the gallery without an account: search, pick a tag, and sort by Trending, Newest or Most forked. A drawing's page has a viewer (**Look round**), **Open in Rodeo** and **Download .vwx**.

**Fork** copies the drawing into your cloud drawings (signing in first if needed) and opens it. The original doesn't change. Your copy keeps its credit: the top bar shows **Fork of** and the original's title, and its credit and licence on hover. If you publish your fork, it can only use a licence the original's allows, and it shows in the original's remixes.

### Unpublishing and reporting

Unpublish from the dialog or the drawing's gallery page. Its page goes at once; forks people have already made stay theirs, with their credit. Deleting the drawing or your account unpublishes it too.

**Report this drawing** on a gallery page sends it to Rodeo's admins. A drawing that several people report is taken out of the gallery until an admin looks.

**Limits:** drawings over 100 MB can't be published. Forks count towards your plan's drawings and storage. Only the owner is credited, not others who edited the drawing.
