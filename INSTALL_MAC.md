# Installing Gemma4kids on macOS

## One-time setup (takes 30 seconds)

Gemma4kids includes a built-in reading voice that speaks Gemma's replies aloud.
Because the app is not yet distributed through the Mac App Store, macOS needs a
one-time permission before the voice engine can run.

**Do this immediately after installing, before you open the app for the first time.**

### Step 1 — Install the app

Open the `.dmg` file you downloaded and drag **Gemma4kids** into your
**Applications** folder.

### Step 2 — Unlock the voice engine

1. Press **Cmd + Space**, type **Terminal**, press **Enter**.
2. Copy and paste the line below into the Terminal window, then press **Enter**:

```
xattr -dr com.apple.quarantine /Applications/Gemma4kids.app
```

3. Close Terminal.

### Step 3 — Open the app

Double-click **Gemma4kids** in your Applications folder. The reading voice will
work straight away.

---

## Why is this step needed?

macOS applies a "quarantine" flag to every app downloaded from the internet.
For unsigned apps this flag also blocks child processes — including the
offline voice engine bundled inside Gemma4kids. The command above removes
that flag from the app bundle. It does not change any system settings and
can be reversed by deleting and re-downloading the app.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Gemma4kids can't be opened because Apple cannot check it for malicious software" | Right-click the app → **Open** → **Open** in the dialog |
| Reading voice silent after following steps above | Make sure you typed the command exactly and pressed Enter; then quit and relaunch the app |
| Terminal says "No such file or directory" | The app may be in a different location — drag it to `/Applications` first |
