---
'posthog-react-native': patch
---

Fix `posthog-xcode.sh` uploading from `DERIVED_FILE_DIR` when `SOURCEMAP_FILE` is preset elsewhere (e.g. EAS builds), so the composed source map is found.
