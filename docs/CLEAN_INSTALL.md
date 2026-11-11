# Clean-install verification

The project was archived without node_modules or .env, extracted into a separate directory, and verified there with no pre-existing project dependencies.

Executed:
1. `npm ci` — installed 116 packages, audited 117, exit 0; 0 reported vulnerabilities.
2. `npm run verify:all` with RUN_DB_TESTS=1 and separate disposable MySQL credentials — exit 0.
3. Syntax checks: 25 JavaScript files; compilation: 16 EJS templates.
4. Runtime tests: 74 passed; 0 failed; 0 skipped; real MySQL 8.4.9.
5. `npm audit --json` — 0 reported vulnerabilities.

Machine output is in `clean-install-output.txt`, `clean-verification-output.txt` and `dependency-audit.json`. Database passwords were environment inputs and are not recorded in these output files.

The final ZIP's runtime source/dependency files were compared byte-for-byte against the clean-installed copy. Additional final documentation and checksums do not change runtime behavior. This proves the package can install in the executed Linux/Node/MySQL environment, not that every OS/browser or production deployment has been verified.
