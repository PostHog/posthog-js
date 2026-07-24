---
'posthog-js': patch
---

Fix selector-widget surveys being abruptly removed while open when their trigger element is unmounted from the DOM (e.g. a dropdown or menu that hosts the trigger closes). The survey is now kept in place while open and only torn down once the user has closed it.
