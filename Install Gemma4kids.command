#!/bin/bash
# Removes macOS quarantine so the bundled Piper voice engine can run.
# Double-click this file once after dragging Gemma4kids to Applications.

APP="/Applications/Gemma4kids.app"

if [ ! -d "$APP" ]; then
  osascript -e 'display alert "Gemma4kids not found" message "Please drag Gemma4kids to your Applications folder first, then run this file again." as warning'
  exit 1
fi

xattr -dr com.apple.quarantine "$APP"
open "$APP"
