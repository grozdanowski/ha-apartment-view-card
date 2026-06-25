# Dev render assets

Drop your apartment render images here. The local dev harness (`npm run dev`)
and the screenshot tests load them from this folder. If a file is missing, the
harness falls back to a generated placeholder so it still runs.

Use these exact filenames (same ones the example card config references):

| File              | Meaning                                              | Required |
| ----------------- | ---------------------------------------------------- | -------- |
| `all-lights.png`  | Every light ON, full brightness, neutral/white       | yes      |
| `day.png`         | All lights OFF, daylight ambient                     | yes      |
| `night.png`       | All lights OFF, night ambient                        | optional |
| `duskdawn.png`    | All lights OFF, sunrise/sunset ambient               | optional |

Tips for good renders (e.g. exported from Sweet Home 3D):

- Use the **same camera angle and resolution** for all four — they're layered
  pixel-for-pixel, so any shift will misalign the lighting reveal.
- `all-lights.png` should be lit brightly and fairly neutral in color; per-light
  RGB tint is applied at runtime from the entity's actual color.
- Keep the background transparent or consistent across all renders.

These files are git-tracked by default (the flat is already visible in the repo
screenshots). If you'd rather keep them out of version control, add
`dev/assets/*.png` to `.gitignore`.
