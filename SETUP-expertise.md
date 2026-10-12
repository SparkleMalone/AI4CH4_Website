# Expertise survey & directory: setup

The site's expertise pages are static HTML. Responses live in a **Google Sheet in your Google Drive**, reached through a small **Google Apps Script web app** (`expertise-backend/Code.gs`). Setup takes about 10 minutes and is done once.

| Page | What it does |
|---|---|
| `survey.html` | Members add their expertise (password required). They can later update or delete it with a private link that is emailed to them. |
| `expertise.html` | Public directory: search, filter by method, methane system, region, scale, or "open to". Filtered views have shareable URLs. |
| `opportunities.html` | Members post funding, research, job, workshop, and collaboration opportunities (password required). Each post has a visibility date and expired rows are removed automatically. |
| `index.html#expertise` | Home-page summary: top methods and systems, each linking to the filtered directory. |

Every submission updates the Sheet, and the website reads it live, so changes show up as soon as the page is reloaded.

## 1. Create the Sheet and script

1. Pick the Google account that will own the data. **Yale Google accounts may not allow web apps open to "Anyone".** If step 3 doesn't offer **Anyone**, use a personal or lab Gmail account instead.
2. In Google Drive: **New → Google Sheets**. Name it something like *AI4Methane Expertise Survey*.
3. In the Sheet: **Extensions → Apps Script**. Delete the sample code, then paste in the full contents of `expertise-backend/Code.gs`. Click **Save**.
4. In the function dropdown at the top, choose **setup** and click **Run**. Google will ask you to authorize the script: it needs access to this spreadsheet and permission to send email as you. Approve it. If you see "Google hasn't verified this app", click **Advanced → Go to (project name)**. That warning is normal for your own scripts.
   `setup` creates **Responses** and **Opportunities** tabs and stores these settings under **Project Settings (gear icon) → Script properties**:
   - `SURVEY_PASSWORD` = `AI4Methane`. Change it here at any time.
   - `SITE_URL` = `https://ai4ch4.com/`. This is used to build the edit links in emails. Change it if the site moves.
   - `ADMIN_EMAIL` = your address. You get an email for each new profile. Delete the property to turn that off.

## 2. Deploy it as a web app

1. **Deploy → New deployment**. Click the gear next to "Select type" and choose **Web app**.
2. **Execute as: Me**. **Who has access: Anyone**.
3. Click **Deploy** and copy the **Web app URL** (it ends in `/exec`).

## 3. Connect the website

1. Open `expertise-config.js` and paste the URL:
   ```js
   AI4M.ENDPOINT = 'https://script.google.com/macros/s/AKfy.../exec';
   ```
2. Publish the site as usual: commit, push, and update the PNNL copy.
3. Test it by filling in `survey.html` yourself. You should get an email with your edit link, and your profile should appear on `expertise.html`.

## Day-to-day

- **Inviting members.** Send them the survey link (`…/survey.html`) and the password. Members who already submitted can use **"Email me my edit link"** at the bottom of the survey.
- **Editing data yourself.** Edit the Responses or Opportunities sheet directly. List columns hold values separated by `; `. The website picks up your edits right away. Don't edit the `edit_token` column in Responses.
- **Opportunity visibility.** The public opportunities page shows only rows whose `visible_until` date is today or later. The backend deletes expired opportunity rows when the list is requested or a new opportunity is submitted.
- **Removing someone.** Delete their row.
- **Changing survey options.** Edit the lists in `expertise-config.js`. Members can also add their own terms in the "Add your own" box under each main category; those terms become searchable filters too. If you rename an option, old responses keep the old wording, and when those members next edit, the old term appears in that section's "Add your own" box.
- **Adding a whole new category.** Add it to `AI4M.TAXONOMY` in `expertise-config.js`, add its name to `LIST_FIELDS` and `PUBLIC_FIELDS` in `Code.gs`, and redeploy (see below). The Sheet gets the new column automatically.
- **Changing the backend code.** Paste the new code, then **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy**. This keeps the same URL, so the website doesn't need changing.

## How access works

- The password is checked on Google's side, never in the website code. Wrong guesses are slowed down.
- Each email address can have one profile. Updating or deleting a profile requires the private link sent to that address, plus the password. So a member can't edit someone else's profile, and anyone who receives a confirmation email they didn't expect can delete that profile.
- The public feed never includes edit links, and includes email addresses only for members who tick **Show my email**.
- Text that looks like a spreadsheet formula is stored as plain text, and the pages display all member-entered text as plain text.
- Gmail accounts can send about 100 emails a day; Workspace accounts can send about 1,500. That's plenty for a working group.
