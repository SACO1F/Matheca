# Project instructions

- Reply to the user without JSON.
- After every desktop application change, rebuild and deliver the Windows x64 portable release, following the user's preference for the Shiqian project. Do not stop after source edits or a renderer build.
- Run the appropriate checks, then run `npm run make:portable` from `desktop/`. Verify the newly packaged `Matheca.exe` starts and the changed behavior works, using isolated test data.
- Keep the complete portable application directory and ZIP together with their runtime resources. Deliver clickable absolute paths to the runnable EXE and ZIP, and identify any build or validation failure honestly.
- Do not modify the user's normal application data or terminate their running application just to package a release. If files are locked, build a fresh output directory.
