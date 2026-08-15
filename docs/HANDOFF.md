# Handoff — installed Forge build

Operator-facing notes for handing the installer to someone else. This file
is not part of the one-page guide the recipient sees — see
`docs/INSTALL-GUIDE.md` for that.

## Before you send anything

- **Never send the installer without `docs/INSTALL-GUIDE.md`.** The two are
  a pair; the recipient needs the guide to get past the Windows warning
  screen and reach a first reply unassisted (AC27e).
- Walk through the install yourself on a machine that has never had this
  project's dev checkout or its dev tooling on it, and confirm the guide's
  step 2 (the warning-screen wording) matches what that machine actually
  shows, before you hand the installer over (AC27b). If that machine offers
  no way past the warning at all, do not send the installer — treat that as
  a blocker and come back to whoever built Forge.

## What the recipient should know, that the guide doesn't say

- **Conversations from the development browser build do not appear in the
  installed app.** They are different, separately stored copies — signing
  in and chatting in one does not carry history into the other. If you have
  been testing Forge yourself in a browser, don't expect that history to
  show up for the person you hand the installer to (AC27i).
- The installed app is separate from, and does not interfere with, any
  developer setup on the same PC — the two can run side by side.

## If the recipient reports a problem

Ask them to click **Save troubleshooting file** on whatever screen they're
stuck on and send you the file it produces, along with what they were doing
when it happened.
