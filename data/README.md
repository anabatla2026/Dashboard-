# Data folder

Drop your secondary sales `.xlsx` export(s) here. The server watches this
folder locally and always serves whichever file was modified most recently —
see the root `README.md` for details.

This folder's `.xlsx` file **is committed to git** — the Vercel deployment
has no persistent disk, so the API reads the data straight out of the
deployment bundle. To update the live data on Vercel: replace the file here,
commit, and push — Vercel redeploys automatically. Locally, the running
server still picks up a replaced file within about half a second without a
restart.
