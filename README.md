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
- **Hold ✗ for about 1.5 seconds:** choose a different `.jar`

## Notes

- Settings are fixed: Nokia, 240×320, sound on
- Needs an internet connection, because the CheerpJ Java runtime loads online
- No sound? Check the iPhone's silent switch

## License

GPL-3.0, see [LICENSE](LICENSE). The `emu/` folder contains files from freej2me-web, unchanged.
