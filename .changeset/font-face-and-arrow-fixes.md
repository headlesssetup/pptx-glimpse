---
"pptx-glimpse": patch
---

Fix font weight/style face selection and block-arrow head proportions

- Text now resolves the correct font face for a run's bold/italic state instead of using whichever face was scanned first for a family. Regular text always uses the Regular face (previously, alphabetical scan order could pick e.g. "Arial Bold Italic" for all text), and bold/italic runs pick the matching face when available, falling back to the closest one.
- Block arrows (rightArrow, leftArrow, upArrow, downArrow, leftRightArrow, upDownArrow, notchedRightArrow, stripedRightArrow) now scale the arrowhead length by the shorter side `min(w, h)` per ECMA-376, instead of the full width/height. Wide, short arrows no longer render with an oversized, blunt head.
