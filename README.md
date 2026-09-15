# Live Poll v4 – Book Club + Preloaded Polls

New:
- Keeps Quick Poll/manual question creation.
- Adds Start a Preloaded Poll.
- Includes a Book Club Poll with 3 prepared questions.
- Book Club Q1 is a short-answer response question.
- Q2 and Q3 are multiple-choice/scale-style questions.
- Preloaded questions are launched one at a time; participants cannot see ahead.
- You can still add manual questions after starting a preloaded poll.


## New in v3

- **Copy Audience Link** button for pasting the join URL into Teams, Zoom, or chat.
- Every question now has its own **PowerPoint Display** link.
- The question display is a clean, presentation-friendly page that shows:
  - waiting state before launch,
  - the live question while voting,
  - live results after the presenter reveals them.
- Each question row includes **Open PowerPoint display** and **Copy Display Link**.


# Live Poll Multi-Device

A presenter-controlled polling app with three separate views:

- **Presenter**: private controls, question list, launch/reveal/next, live response counts
- **Projector**: clean display for the room; no presenter controls
- **Audience**: phone-friendly voting screen; no account needed

## Easiest way to test without installing Python

Use a browser-based host that runs Node.js apps, such as Replit or another Node-compatible hosting service.

### Replit-style workflow
1. Create a new Node.js project.
2. Upload all files from this folder.
3. Run `npm install` if the platform does not do it automatically.
4. Run `npm start`.
5. Open the public web URL.
6. Create a session.
7. Open the projector link in another tab/window.
8. Scan the QR code with your phone to join as an audience member.

## Local Node option
If Node.js is already installed:

```bash
npm install
npm start
```

Then browse to:

```text
http://localhost:3000
```

## New in v2

- **Download Results (.CSV)** from the private presenter screen; opens directly in Excel and includes aggregate results plus anonymous participant response rows.

## Important MVP notes
- No participant accounts.
- Presenter controls are private via a long secret URL token.
- Projector view also uses its own secret token.
- Sessions are held in memory and disappear when the server restarts.
- Suitable for testing; not yet hardened for college-wide production use.
- For production, add persistent storage, HTTPS, presenter authentication/SSO, accessibility review, and institutional privacy/security review.

## Next upgrades
- CSV/Excel export
- Open-text questions
- Likert scales
- Word clouds
- Save/reuse question decks
- Microsoft Entra ID login for presenters
- Institutional branding
- Import questions from PowerPoint/CSV
