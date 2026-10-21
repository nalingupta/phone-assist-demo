#!/usr/bin/env bash
# Builds artifact.html: the same page as index.html with the CSS and JS inlined,
# in the form the claude.ai Artifact tool wraps (no doctype/head/body of its own).
set -e
cd "$(dirname "$0")"
for f in data.js ai.js voice.js tts.js app.js; do
  if grep -q '</script' "$f"; then echo "$f contains </script>, cannot inline" >&2; exit 1; fi
done
{
  echo '<title>Phone Assist Demo</title>'
  echo '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;500;600;700&display=swap">'
  echo '<style>'; cat styles.css; echo '</style>'
  echo '<div id="app"></div>'
  echo '<script src="https://cdnjs.cloudflare.com/ajax/libs/htm/3.1.1/preact/standalone.umd.js"></script>'
  for f in data.js ai.js voice.js tts.js app.js; do echo "<script>"; cat "$f"; echo "</script>"; done
} > artifact.html
echo "wrote artifact.html ($(wc -c < artifact.html) bytes)"
