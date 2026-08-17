# TVM on this laptop

This folder is the **laptop copy** of TVM: a windowed desktop app and a Roku
sideload package. It is not the living-room kiosk (`TVM.cmd` in the repo root
still goes fullscreen). Both launchers bind Core to `127.0.0.1`, so they open
without Wi-Fi and without Windows asking to allow Node on public networks.

| File | What it does |
| --- | --- |
| `TVM.cmd` / `TVM.sh` | Desktop app in a window that fits a laptop screen |
| `TVM-roku.cmd` / `TVM-roku.sh` | Same UI in a 1920×1080 TV frame, plus the Roku zip |
| `TVM-roku.zip` | Sideload this onto a developer-mode Roku (created by the copy script) |

Double-click **Install-to-Desktop.cmd** in the repo root to put `TVM.cmd`,
`TVM Roku.cmd`, and `TVM-roku.zip` on your Windows Desktop. On Linux or macOS:

```bash
./scripts/copy-to-desktop.sh
```
