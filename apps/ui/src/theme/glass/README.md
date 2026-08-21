# Liquid glass tokens

Original TVM theme tokens. Set `data-theme="glass"` on a root; another agent registers the theme. Do not copy Apple assets or SF fonts.

## Variables

| Token | Role |
| --- | --- |
| `--tvm-glass-blur` / `-soft` / `-heavy` | Frost amount |
| `--tvm-glass-saturate` | Color bloom through frost |
| `--tvm-glass-filter` (+ `-soft` / `-heavy`) | `blur()` + `saturate()` over the stage |
| `--tvm-glass-edge` | Inset inner shadow (light top, occluding bottom) |
| `--tvm-glass-fill-text` | Text-bearing panels |
| `--tvm-glass-fill-bright` / `-bright-text` | Light frost |
| `--tvm-glass-fill-video` | Playback chrome over frames |
| `--tvm-glass-fill-solid` | No-blur fallback |
| `--tvm-glass-scrim` | Modal dim |
| `--tvm-glass-hairline` / `-cool` / `-width` | Rim stroke |
| `--tvm-glass-edge` | Inset specular + refract |
| `--tvm-glass-shadow` / `-deep` / `-focus` | Lift + TV focus |
| `--tvm-glass-radius` / `-lg` | Liquid corners |
| `--tvm-glass-text` / `-muted` / `-faint` | Ice type |
| `--tvm-glass-ink` / `-paper` | Solid contrast pair |
| `--tvm-glass-accent` / `-warm` / `-mint` | Aqua, honey, mint |
| `--tvm-glass-halo` | Title ink halo |

Shared `--tvm-*` colors, type, radii, and shadows are remapped on the same selector.

## Contrast (10-foot)

- Ice type (`#f4faff`) on `--tvm-glass-fill-text` / ink (`#0a1624`) is ~16:1. Muted `#d2dce8` stays ≥8:1 on ink; faint `#a8b6c6` stays ≥7:1 — do not thin these further.
- Put body copy on `--tvm-glass-fill-text` (opacity ~0.8), not `--tvm-glass-fill`. Over video, use `--tvm-glass-fill-video` and ice type, or `--tvm-glass-paper` on `--tvm-glass-ink`.
- Add `--tvm-glass-halo` on titles over art. Focus is cream ring + warm glow (`--tvm-glass-shadow-focus`).
- Status mint / honey / coral are bright on dusk ink. Reduced transparency and missing `backdrop-filter` snap fills to solids so type never sits on raw artwork.
