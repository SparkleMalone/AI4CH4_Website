# AI⁴Methane

A project site for **AI⁴Methane**, a Collaborative Organization — *Advance understanding of Global Methane Sources/Sinks using Knowledge-guided AI*.

- **Resources:** [GitHub – AI for Natural Methane](https://cu-esiil.github.io/AI-for-Natural-Methane/)

## Run locally

Open `index.html` in a browser, or use a local server:

```bash
# Python
python3 -m http.server 8080

# Node (npx)
npx serve .
```

Then visit `http://localhost:8080` (or the port shown).

## Structure

- `index.html` — Home page: hero, challenge, leadership team, collaborative-team map, sectors, workshops, outputs, footer
- `team-members.html` — Full working-group table (name, affiliation), loaded from `team_members.json`
- `survey.html`, `expertise.html`, `expertise.css`, `expertise-config.js` — Member expertise survey and searchable directory (also summarized on the home page)
- `expertise-backend/Code.gs` — Google Apps Script that stores survey responses in a Google Sheet; see `SETUP-expertise.md`
- `styles.css` — Dark theme, Cormorant Garamond + Outfit, teal accents
- `script.js` — Header scroll state and scroll-in reveal animations
- `images/team/`, `images/workshops/` — Portraits and workshop photos

## Updating team data

Member data lives in `WG Member Contact 2025 web.xlsx` (columns B=Email, C=Name, D=Position, E=Affiliation). After editing it, regenerate the JSON the site reads:

```bash
pip install openpyxl geopy
python3 build_team_members.py       # -> team_members.json (emails are not published)
python3 build_participants_map.py   # -> participants_map_data.json
```

Map locations come from the `KNOWN` table in `build_participants_map.py`. A new affiliation not in that table is geocoded automatically; check where it lands and add it to `KNOWN`.
