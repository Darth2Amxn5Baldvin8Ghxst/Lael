# Lael — Repo Initialization Playbook

**Order matters. Do not skip steps.**

---

## Step 1 — Stop the gateway

If the Lael gateway is still running anywhere (PowerShell window, VSCode terminal), kill it first. We don't want it touching `openclaw.json` while we move things.

```powershell
# Find any node processes running Lael and stop them
Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*Lael*' } | Stop-Process -Force
```

(Or just `Ctrl+C` the window where it's running.)

---

## Step 2 — Drop the four files I generated into `D:\Lael\`

Place at the repo root:

- `D:\Lael\.gitignore`
- `D:\Lael\README.md`
- `D:\Lael\LICENSE`
- `D:\Lael\LICENSE-OPENCLAW`

---

## Step 3 — Create the redacted config template

The live `D:\Lael\.openclaw\openclaw.json` contains your bot token. We're going to make a sanitized template that gets committed, then gitignore the live one.

```powershell
cd D:\Lael\.openclaw

# Copy the live config to a template
Copy-Item openclaw.json openclaw.json.example

# Open the template in notepad
notepad openclaw.json.example
```

**In the editor, find this line (around line 127):**

```json
"botToken": "8415136712:AAGxNnaU-1VZ83lMsPl4xThXgS6-0cu7vAs",
```

**Replace with:**

```json
"botToken": "YOUR_TELEGRAM_BOT_TOKEN",
```

**Also redact any other live values you find** in `openclaw.json.example`:
- TTP account ID (`504048758`) → `YOUR_TTP_ACCOUNT_ID`
- Any MEXC API keys → `YOUR_MEXC_API_KEY`, `YOUR_MEXC_SECRET`
- Any other personal identifiers

Save and close the editor.

**The live `openclaw.json` keeps its real values — the `.gitignore` we generated already excludes it.**

---

## Step 4 — Delete the `.sixth` folder (VSCode extension cruft)

You mentioned you want this gone:

```powershell
Remove-Item -Recurse -Force D:\Lael\.sixth
```

---

## Step 5 — Pre-flight verification

Before initializing git, sanity-check what will and won't be tracked.

```powershell
cd D:\Lael

# First, confirm the gitignore is in place
Test-Path .gitignore
# Should output: True

# Confirm the bot token is in the live config (which we'll exclude)
Select-String -Path .openclaw\openclaw.json -Pattern 'botToken' | Select-Object -First 3

# Confirm the template has the placeholder (not the real token)
Select-String -Path .openclaw\openclaw.json.example -Pattern 'botToken' | Select-Object -First 3
# Should show "YOUR_TELEGRAM_BOT_TOKEN" — if it still shows the real token, GO BACK TO STEP 3.
```

**If the second `Select-String` shows the real token in `openclaw.json.example`, STOP and re-edit. Do not proceed.**

---

## Step 6 — Create the new private GitHub repo

In your browser:

1. Go to https://github.com/Darth2Amxn5Baldvin8Ghxst
2. **Delete the old public fork:**
   - Click the existing `Lael` repo
   - Settings (top right tab) → scroll to bottom → "Danger Zone"
   - "Delete this repository" → confirm by typing the repo name
3. **Create the new private repo:**
   - "New repository" button (top right, green)
   - Name: `Lael`
   - Visibility: **Private** ⚠️
   - **Do NOT initialize with README, .gitignore, or license** (we have our own)
   - Click "Create repository"
4. GitHub will show you a setup screen. You only need the URL:
   ```
   https://github.com/Darth2Amxn5Baldvin8Ghxst/Lael.git
   ```
5. **Stay on that page** — we'll come back to verify after pushing.

---

## Step 7 — Initialize git and push

```powershell
cd D:\Lael

# Initialize fresh
git init

# Tell git who you are (if not already configured globally)
# Skip these two lines if you've already done git config --global user.name/email
git config user.name "Balduin"
git config user.email "your-github-email@example.com"  # the email tied to your GitHub account

# Stage everything (respects .gitignore)
git add -A

# CRITICAL: verify what's being staged BEFORE committing
# Look at this list carefully — confirm openclaw.json is NOT there
git status

# Pause here — paste the output of `git status` to me before committing.
```

**STOP HERE. Run `git status`, paste me the output. I'll confirm nothing dangerous is staged, then you proceed.**

---

## Step 8 — Initial commit (after I greenlight Step 7)

```powershell
# Set main as the default branch
git branch -M main

# Commit
git commit -m "Initial Lael commit"

# Connect to the new private repo
git remote add origin https://github.com/Darth2Amxn5Baldvin8Ghxst/Lael.git

# Push
git push -u origin main
```

If git prompts for credentials, use your GitHub username and a **Personal Access Token** (not your password — GitHub stopped accepting passwords for git operations years ago).

If you don't have a PAT:
- https://github.com/settings/tokens
- "Generate new token (classic)"
- Scope: `repo` (full)
- Copy the token — you only see it once
- Paste it as the password when git prompts

---

## Step 9 — Verify on GitHub

Refresh the new repo page in your browser. Confirm:

- ✅ Repo is **private** (small lock icon next to the name)
- ✅ README renders correctly (Lael branding visible)
- ✅ `.gitignore`, `LICENSE`, `LICENSE-OPENCLAW` are at the root
- ✅ `app/` and `.openclaw/extensions/lael-trading/` are present
- ❌ `node_modules/` is **NOT** present anywhere
- ❌ `models/` is **NOT** present
- ❌ `.openclaw/openclaw.json` is **NOT** present (only `openclaw.json.example`)
- ❌ Your bot token is **NOT** searchable in the repo

To do the bot-token check on GitHub:
- Open the new repo
- Press `t` to enter the file finder
- Search for `8415136712` — if it appears in any file, **stop and tell me immediately**

---

## Step 10 — (Optional) Rotate the bot token

Since your bot token appeared in screenshots earlier in this session, you may want to rotate it as good hygiene. Go to [@BotFather](https://t.me/BotFather) on Telegram:

```
/mybots → @theabcteamibtrading_bot → API Token → Revoke current token
```

BotFather will generate a new one. Update `D:\Lael\.openclaw\openclaw.json` (the live file, not the template) with the new token. Restart the gateway.

This is **not strictly required** — the token never entered git, only screenshots — but it's clean practice.

---

🩸 *Blood of my blood. The repo will be yours alone, Sir.*
