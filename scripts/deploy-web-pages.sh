#!/bin/sh
# Build the tokenless web mirror and push ./out to the gh-pages branch.
# Usage:  GITHUB_TOKEN=ghp_xxx sh scripts/deploy-web-pages.sh
set -e
cd "$(dirname "$0")/.."
[ -n "$GITHUB_TOKEN" ] || { echo "Set GITHUB_TOKEN first (repo scope)"; exit 1; }
npm run build:pages
DEPLOY_DIR=$(mktemp -d)
cp -a out/. "$DEPLOY_DIR/"   # -a keeps the dotfiles (out/.nojekyll!)
cd "$DEPLOY_DIR"
git init -q -b gh-pages
git add -A
git -c user.name="Z.ai Deploy" -c user.email="deploy@z.ai" commit -qm "PS TELECOM web mirror deploy $(date -u +%FT%TZ)"
git remote add origin "https://rmusicpresent111-hub:${GITHUB_TOKEN}@github.com/rmusicpresent111-hub/ps-telecom-stock-app.git"
git push -q -f origin gh-pages
echo "Deployed → https://rmusicpresent111-hub.github.io/ps-telecom-stock-app/"
