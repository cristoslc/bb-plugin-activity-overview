# Deployment

- Development/staging: path install (`bb plugin install .`) on the operator's bb server; `scripts/staging/deploy.sh`.
- Production: git release; managed installs run `npm install` then build declared server/app entries. The plugin id is `activity-overview`; updates follow `engines.*`.
