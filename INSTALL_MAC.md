# Installing Gemma4kids on macOS

## Step 1 — Install the app

Open the `.dmg` file you downloaded and drag **Gemma4kids** into your
**Applications** folder.

## Step 2 — Open it the first time

Because this is an unsigned hackathon build, macOS Gatekeeper will not let you
open it with a normal double-click the first time. Do this instead:

1. In **Applications**, **right-click** (or Control-click) **Gemma4kids**.
2. Choose **Open**.
3. In the dialog that appears, click **Open** again.

After this first time, you can open it normally.

If you still see *"Gemma4kids can't be opened because Apple cannot check it for
malicious software"*, open **Terminal** (Cmd + Space → type `Terminal` →
Enter), paste the line below, press Enter, then try Step 2 again:

```
xattr -dr com.apple.quarantine /Applications/Gemma4kids.app
```

This only removes the internet-download quarantine flag so an unsigned app can
launch. It does not change any system settings and is reversed by re-downloading
the app.

---

## Known limitations on macOS

These are honest, current limitations of the macOS build. They do **not** affect
Windows or Linux, where these features work normally. Both are under active
troubleshooting and are not fixed in this submission build.

### Reading voice ("Read" button) — currently not working on macOS

The "Read aloud" feature does **not** work on macOS in this build. The bundled
Piper voice engine cannot load on macOS (it depends on a system audio library
that is not present on a clean Mac), and the macOS fallback path is also not
working yet. We are still troubleshooting this.

Read-aloud works as intended on **Windows and Linux**. On macOS, the rest of the
app — chat, code generation, editing, saving, opening in the browser, voice
input — works normally; only the spoken output of replies is affected.

### Microphone — repeated permission prompts on macOS

The microphone (voice input) works, but because this build is **unsigned**,
macOS may ask for microphone permission **several times** on first use. This is
a macOS limitation for unsigned apps (its privacy/TCC system re-asks for
unsigned binaries), not a bug in the app. Allow the microphone each time it
asks; once granted, voice input functions normally. A properly code-signed
build would remove the repeated prompts — that requires a paid Apple Developer
account and is out of scope for this submission.

---

## Troubleshooting

| Symptom | What to do |
|---|---|
| "Gemma4kids can't be opened because Apple cannot check it for malicious software" | Right-click the app → **Open** → **Open**; if it persists, run the `xattr` command above |
| Terminal says "No such file or directory" | The app isn't in `/Applications` — drag it there first, then re-run the command |
| "Read" button does nothing / no spoken reply | Known macOS limitation (see above) — read-aloud is not working on macOS in this build; use Windows/Linux for spoken replies |
| macOS asks for microphone permission repeatedly | Expected on unsigned builds — allow it each time; it works once granted |
