# Local fonts

The client uses Latin subsets derived from Inter and Newsreader, downloaded from the Google Fonts repository on 2026-10-25. The modified fonts have internal family names **Leyline Sans** and **Leyline Serif** to respect reserved-font-name requirements. The original SIL Open Font Licenses are included beside them. CSS family aliases preserve the client design API.

The subsets retain the original outlines and variable axes for Latin text, common punctuation and arrows. Other scripts use the system fallback. WOFF2 conversion and subsetting used FontTools; no font service is contacted at runtime.
