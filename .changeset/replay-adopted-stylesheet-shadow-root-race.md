---
'posthog-js': patch
---

fix(replay): stop dropping adopted stylesheets that arrive before the host's shadow root is attached. When the recorder's full snapshot races a web component's hydration, the AdoptedStyleSheet event can be recorded before the mutation that attaches the host's shadow root. The replayer silently dropped those styles for the rest of the page view, so components styled via `shadowRoot.adoptedStyleSheets` (Stencil, Lit) rendered completely unstyled. The replayer now constructs the stylesheet even when the shadow root does not exist yet and keeps retrying adoption until it is attached.
