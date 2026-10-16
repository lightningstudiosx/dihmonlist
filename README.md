# Dihmon List

Runs on GitHub Pages: no server. The list is `data.json`; the admin page edits it for you.

## Set up (once)

1. Put `index.html`, `data.json` and this README in your repo (the one behind dihmonlist.kaifun.fun).
2. index.html is already set to github.com/lightningstudiosx/dihmonlist (branch main). If you rename the repo or branch, change the three lines at the top of the script:
   `REPO_OWNER` (your GitHub name), `REPO_NAME` (this repo's name), `BRANCH` (usually `main`).
3. Make sure the repo has Issues turned on (Settings → General → Features → Issues).
4. Make your admin token: GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens →
   Generate new token. Repository access: only this repo. Permissions: **Contents: Read and write**,
   **Issues: Read and write**. Copy it.
5. Go to dihmonlist.kaifun.fun/#/admin and paste the token. It's kept in that browser only. Don't share it:
   anyone with it can change the list.

## How it works

- Visitors submit a record or a level on the Submit page. It opens a GitHub issue with everything filled in;
  they press "Submit new issue". They need a (free) GitHub account.
- Your admin page lists those issues. Approve adds the record or level to `data.json` (a commit to the repo)
  and closes the issue; Reject closes it.
- You can also add, edit, move (with a reason for the position history) and delete levels, remove records,
  hide players, and export / import the whole list as JSON.
- After a change, GitHub Pages takes about a minute to show it on the site.
