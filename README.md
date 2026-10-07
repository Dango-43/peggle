# Peggle (Nokia J2ME) in the Browser

A small web app that starts one classic Nokia Java game right away.
It's made for the iPhone SE in portrait mode, and you can install it on your home screen.

Built on the open-source emulator [freej2me-web](https://github.com/zb3/freej2me-web) by zb3.

## How it works

1. Open the page in **Safari**, tap Share, then **Add to Home Screen**.
2. Open the app and pick the game file (`.jar`) the first time.
3. From then on, the game starts right away.

The `.jar` is stored only in your browser (IndexedDB). It is **not** part of this repository.

## Controls

|     |      |     |
|:---:|:----:|:---:|
|  ✓  |  ↑   |  ✗  |
|  ←  |  OK  |  →  |
|     |  ↓   |     |

- ✓ = left soft key, ✗ = right soft key
- **Hold ✗ for about 1.5 seconds:** settings: background (Aurora, Sunset, Night, Deep sea, Graphite), key style (Liquid Glass, Brass, Ceramic, Minimal), graphics, save backup, other `.jar`
- **Hold ✓ for about 1.5 seconds:** switch between smooth graphics (xBR filter, default) and sharp pixels

## Notes

- Settings are fixed: Nokia, 240×320, sound on
- Needs an internet connection, because the CheerpJ Java runtime loads online
- No sound? Check the iPhone's silent switch
- Progress saves automatically in the browser. Deleting the home-screen app deletes it too, so use "Spielstand sichern" in the menu now and then to keep a copy in the Files app

## License

GPL-3.0, see [LICENSE](LICENSE). The `emu/` folder contains files from freej2me-web; only `emu/src/eventqueue.js` is changed (fixes key releases arriving late).
