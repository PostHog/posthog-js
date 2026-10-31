---
"@posthog/browser-common": patch
---

Fix tab widget surveys ignoring the selected position. The popup is only centred next to the tab for the default right position or next to trigger; any other position picked in the survey appearance settings is now honoured.
