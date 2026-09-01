# Aptronix Service — Executive Dashboard

A single self-contained HTML file (data, styles, and logic all inline — no
build step, no backend). Works on desktop and mobile.

## Publish it on GitHub Pages

1. Create a new GitHub repository (public — GitHub Pages on a free personal
   account only serves public repos).
2. Upload `index.html` to the **root** of that repository.
   - Via the GitHub web UI: open the repo → **Add file → Upload files** →
     drop in `index.html` → **Commit changes**.
   - Via git:
     ```bash
     git clone https://github.com/<your-username>/<repo-name>.git
     cd <repo-name>
     cp /path/to/index.html .
     git add index.html
     git commit -m "Add dashboard"
     git push
     ```
3. In the repo, go to **Settings → Pages**.
4. Under **Build and deployment → Source**, choose **Deploy from a branch**.
5. Under **Branch**, select `main` (or whichever branch you pushed to) and
   folder `/ (root)`, then **Save**.
6. GitHub will publish it at:
   `https://<your-username>.github.io/<repo-name>/`
   This usually takes 1–2 minutes on the first deploy. A green checkmark
   in the **Actions** tab (or the Pages settings screen) means it's live.

## Updating it later

Whenever you make changes, just replace `index.html` in the repo the same
way (upload again, or `git add / commit / push`) — Pages redeploys
automatically on every push to the configured branch.

## Notes

- **No server, no auth.** Anyone with the link can view the page and, if
  they open browser dev tools, the underlying data — GitHub Pages on a
  public repo has no access control. Don't publish data you need to keep
  private this way.
- **Chart.js and Lucide icons load from a CDN** with automatic fallbacks
  (cdnjs → jsDelivr → unpkg). If a viewer is on a network that blocks all
  three, charts fall back to a text notice and nav icons fall back to
  plain glyphs — the dashboard itself still works.
- **Dark mode preference** is stored per-browser via `localStorage`, so it
  persists across visits on the same device but won't carry across
  devices.
- Fully responsive: sidebar becomes a slide-out drawer, tables scroll
  horizontally, and the filter bar reflows to one column below ~480px.
