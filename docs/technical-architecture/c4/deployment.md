# Deployment

- Development/staging: path install (`bb plugin install .`) on the operator's bb server; `scripts/staging/deploy.sh`.
- Production: git release; managed installs run `npm install` then build declared server/app entries. The plugin is id-`attention`; updates follow `engines.*`.
