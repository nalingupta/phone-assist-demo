#!/usr/bin/env bash
# Builds artifact.html: the same page as index.html with the CSS and JS inlined,
# in the form the claude.ai Artifact tool wraps (no doctype/head/body of its own).
# The prompt files, tools.md, kb/*.md and scenarios/*.md are inlined as window.PROMPT_FILES.
set -e
cd "$(dirname "$0")"
for f in data.js ai.js voice.js tts.js app.js; do
  if grep -q '</script' "$f"; then echo "$f contains </script>, cannot inline" >&2; exit 1; fi
done
prompt_files() {
  node -e '
    const fs = require("fs");
    const read = (f) => { try { return fs.readFileSync(f, "utf8"); } catch (e) { return ""; } };
    const prompts = {};
    for (const n of ["system_prompt", "phone_assist_workflow", "phone_assist_guidance", "phone_assist_best_reply", "chat", "caller", "support_agent"]) prompts[n] = read(`prompts/${n}.md`);
    const folder = (d) => fs.readdirSync(d).filter((f) => f.endsWith(".md")).sort().map((file) => ({ file, text: read(`${d}/${file}`) }));
    const json = JSON.stringify({ prompts, tools: read("tools.md"), kb: folder("kb"), scenarios: folder("scenarios") }).replace(/</g, "\\u003c");
    process.stdout.write(`window.PROMPT_FILES = ${json};`);
  '
}
{
  echo '<title>Phone Assist Demo</title>'
  echo '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;500;600;700&display=swap">'
  echo '<style>'; cat styles.css; echo '</style>'
  echo '<div id="app"></div>'
  echo '<script src="https://cdnjs.cloudflare.com/ajax/libs/htm/3.1.1/preact/standalone.umd.js"></script>'
  echo "<script>"; prompt_files; echo "</script>"
  for f in data.js ai.js voice.js tts.js app.js; do echo "<script>"; cat "$f"; echo "</script>"; done
} > artifact.html
echo "wrote artifact.html ($(wc -c < artifact.html) bytes)"
