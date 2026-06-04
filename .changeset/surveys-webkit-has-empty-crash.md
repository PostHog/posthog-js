---
'posthog-js': patch
---

fix(surveys): stop the survey CSS from using `:has(.survey-question:empty)`, which crashes some WebKit builds during text-node style invalidation while a survey renders. The empty-header margin tweak now keys off a JS-set `question-header--empty` class and a sibling selector instead.
