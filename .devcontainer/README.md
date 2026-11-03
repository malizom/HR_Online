# People Portal — demo in GitHub Codespaces

The terminal shows the **link** and **access code** once the codespace has started.

- **Share it:** Ports tab → right-click port 3000 → *Port visibility → Public*. Send the link and code.
- **Fresh data before a meeting:** run `bash .devcontainer/reset-demo.sh` (leave dates are re-based on today).
- **After a new version is merged:** run `bash .devcontainer/update-demo.sh` (pulls main, rebuilds, reseeds; same link and code).
- **Fixed access code:** add a Codespaces secret `DEMO_ACCESS_CODE` (GitHub → Settings → Codespaces), then rebuild.
- **Cost:** free within GitHub's monthly allowance for personal accounts. Stop the codespace after the meeting
  (it also stops itself after 30 minutes idle) so hours aren't used up.
- Names are from MVR's public team page; every leave record, document and figure is invented.
