---
"pptx-glimpse": patch
---

Default non-placeholder text boxes to left alignment

Text boxes (`cNvSpPr/@txBox="1"`) that are not placeholders now default to left alignment instead of inheriting a centered alignment from the slide master's `otherStyle` / `defaultTextStyle`, matching PowerPoint. Autoshapes and placeholders are unaffected and still inherit alignment as before. An explicit paragraph `algn` always takes precedence.
