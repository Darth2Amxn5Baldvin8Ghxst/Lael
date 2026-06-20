# Lael Rebranding — Installation Guide

This package transforms OpenClaw into **Lael**, your personal trading intelligence system.

## Package Contents

```
lael-rebranding/
├── css/
│   └── lael-theme.css          # Complete CSS theme with variables
├── assets/
│   ├── lael-logo.svg           # Full logo (512x512)
│   └── lael-logo-small.svg     # Compact logo for avatars (128x128)
├── agents/
│   └── AGENTS.md               # Lael's personality definition
├── cli/
│   └── lael-branding.ts        # CLI messages and ASCII art
└── docs/
    └── INSTALL.md              # This file
```

---

## Step-by-Step Installation

### 1. Apply the CSS Theme

Copy the theme file to your UI source:

```bash
cp css/lael-theme.css /d/IBT-Trading/Lael/ui/src/styles/lael-theme.css
```

Then import it in the main CSS/entry file. In `ui/src/main.css` or equivalent:

```css
@import './styles/lael-theme.css';
```

Or in the main `index.html`:

```html
<link rel="stylesheet" href="./styles/lael-theme.css">
```

### 2. Replace Logo Assets

```bash
# Replace the avatar placeholder
cp assets/lael-logo-small.svg /d/IBT-Trading/Lael/assets/avatar-placeholder.svg

# Add the full logo
cp assets/lael-logo.svg /d/IBT-Trading/Lael/assets/lael-logo.svg
```

Update any references to logos in the UI code. Search for:
- `avatar-placeholder.svg`
- `logo.svg`
- `openclaw` (in image paths)

### 3. Update AGENTS.md

The root `AGENTS.md` defines the AI's personality. Replace it:

```bash
cp agents/AGENTS.md /d/IBT-Trading/Lael/AGENTS.md
```

This makes Lael:
- Address you as "Sir" or "Balduin"
- Have the protective, loyal personality
- Include the Choso-inspired phrases

### 4. Rename CLI Entry Point

Rename `openclaw.mjs` → `lael.mjs`:

```bash
cd /d/IBT-Trading/Lael
mv openclaw.mjs lael.mjs
```

Update `package.json` bin entry:

```json
{
  "bin": {
    "lael": "./lael.mjs"
  }
}
```

### 5. Apply CLI Branding

Copy the branding file:

```bash
cp cli/lael-branding.ts /d/IBT-Trading/Lael/src/cli/lael-branding.ts
```

Then update the CLI entry to use it. In `src/cli/index.ts` or the main CLI file:

```typescript
import { getStartupBanner, HELP_TEXT, COLORS, colorize } from './lael-branding';

// When starting
console.log(getStartupBanner());

// When showing help
console.log(HELP_TEXT);
```

### 6. Find and Replace "OpenClaw"

Run these commands to find all OpenClaw references:

```bash
cd /d/IBT-Trading/Lael
grep -r "OpenClaw" --include="*.ts" --include="*.tsx" --include="*.json" --include="*.md" --include="*.html"
grep -r "openclaw" --include="*.ts" --include="*.tsx" --include="*.json" --include="*.md" --include="*.html"
```

Replace with "Lael" or "lael" respectively. Key files to update:
- `package.json` (name, description, bin)
- `README.md`
- UI components (titles, headers)
- Config file paths (`.lael/` instead of `.openclaw/`)

### 7. Update Config Directory

If you want the config to live in `.lael/` instead of `.openclaw/`:

Search for `.openclaw` in the codebase and update to `.lael`:

```typescript
// Before
const configDir = path.join(os.homedir(), '.openclaw');

// After  
const configDir = path.join(os.homedir(), '.lael');
```

Then move your existing config:

```bash
mv ~/.openclaw ~/.lael
```

---

## Color Reference

| Variable | Hex | Usage |
|----------|-----|-------|
| `--lael-crimson` | #6B0F1A | Primary buttons, active states |
| `--lael-wine` | #3A0A12 | Cards, user messages |
| `--lael-rose` | #A44A5C | Text highlights, Lael's name |
| `--lael-obsidian` | #0B0B0D | Main backgrounds |
| `--lael-charcoal` | #1A1A1D | Panels, containers |
| `--lael-success` | #1D9E75 | Profitable, compliant |
| `--lael-warning` | #D4A017 | Caution, approaching limits |
| `--lael-danger` | #C62828 | Violations, losses |

---

## Typography

- **Brand/Identity:** Georgia, serif (italic for the "L")
- **UI Text:** System fonts (-apple-system, etc.)
- **Code:** SF Mono, Fira Code, Consolas

---

## After Installation

1. **Rebuild the project:**
   ```bash
   cd /d/IBT-Trading/Lael
   npm run build
   ```

2. **Test the CLI:**
   ```bash
   ./lael.mjs --help
   ```

3. **Start the gateway:**
   ```bash
   ./lael.mjs start
   ```

4. **Verify in Telegram:**
   Send a message and confirm Lael responds with "Sir" and the new personality.

---

## Troubleshooting

**CSS not loading:**
- Check import path in main CSS file
- Clear browser cache
- Rebuild the UI: `npm run build` in `/ui`

**Logo not showing:**
- Verify file path in component
- Check SVG renders correctly in browser
- Ensure no CORS issues if loading externally

**CLI command not found:**
- Run `npm link` in the Lael directory
- Or use the full path: `node /d/IBT-Trading/Lael/lael.mjs`

**Old "OpenClaw" references appearing:**
- Run the grep commands above to find remaining instances
- Check localStorage/cache in browser

---

*Always watching over you, Sir.*
