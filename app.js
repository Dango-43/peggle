// Single-game launcher for freej2me-web (https://github.com/zb3/freej2me-web).
// Based on web/src/main.js of that project, stripped down to: one game,
// jar stored in IndexedDB, fixed settings, own on-screen keypad.

import { LibMedia } from "./emu/libmedia/libmedia.js";
import { LibMidi, createUnlockingAudioContext } from "./emu/libmidi/libmidi.js";
import { codeMap, KeyRepeatManager } from "./emu/src/key.js";
import { EventQueue } from "./emu/src/eventqueue.js";

import canvasFontNatives from "./emu/libjs/libcanvasfont.js";
import canvasGraphicsNatives from "./emu/libjs/libcanvasgraphics.js";
import gles2Natives from "./emu/libjs/libgles2.js";
import jsReferenceNatives from "./emu/libjs/libjsreference.js";
import mediaBridgeNatives from "./emu/libjs/libmediabridge.js";
import midiBridgeNatives from "./emu/libjs/libmidibridge.js";

// Fixed emulator settings (Nokia, 240x320, sound on).
const SETTINGS = { phone: "Nokia", width: "240", height: "320", sound: "on" };

// How long ✗ must be held to choose a different .jar.
const LONG_PRESS_MS = 1500;

// CheerpJ maps the web server root to /app; the emulator lives in ./emu/
const cheerpjEmuRoot = "/app" + location.pathname.replace(/\/[^/]*$/, "") + "/emu";
// Inside CheerpJ's own persistent filesystem
const GAME_JAR_PATH = "/files/_game/game.jar";

const evtQueue = new EventQueue();
const keyRepeatManager = new KeyRepeatManager();
window.evtQueue = evtQueue;

const display = document.getElementById("display");
const screenCtx = display.getContext("2d");
const statusEl = document.getElementById("status");
let started = false;

function setStatus(text) {
    statusEl.textContent = text;
}

// ---------------------------------------------------------------- IndexedDB

const DB_NAME = "peggle-app";
const STORE = "files";
const JAR_KEY = "game.jar";

function openDb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function dbGet(key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function dbPut(key, value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

// ------------------------------------------------------------- jar picker

const picker = document.getElementById("picker");
const pickerText = document.getElementById("picker-text");
const jarInput = document.getElementById("jar-input");
const pickerCancel = document.getElementById("picker-cancel");

// Resolves with the jar bytes once the user picked and we stored a file.
function showPicker(canCancel) {
    pickerCancel.hidden = !canCancel;
    if (canCancel) {
        pickerText.textContent = "Andere Spieldatei (.jar) wählen? Das Spiel startet danach neu.";
    }
    picker.classList.add("show");
    jarInput.value = "";

    return new Promise(resolve => {
        pickerCancel.onclick = () => {
            picker.classList.remove("show");
            resolve(null);
        };
        jarInput.onchange = async () => {
            const file = jarInput.files[0];
            if (!file) return;
            const buf = await file.arrayBuffer();
            await dbPut(JAR_KEY, buf);
            picker.classList.remove("show");
            resolve(buf);
        };
    });
}

async function changeJar() {
    keyRepeatManager.reset();
    const buf = await showPicker(true);
    if (buf) location.reload();
}

// --------------------------------------------------------------- layout

function fitDisplay() {
    if (!display.width || !display.height) return;
    const area = document.getElementById("screen");
    const scale = Math.min(area.clientWidth / display.width, area.clientHeight / display.height);
    display.style.width = Math.floor(display.width * scale) + "px";
    display.style.height = Math.floor(display.height * scale) + "px";
}

window.addEventListener("resize", fitDisplay);
window.addEventListener("orientationchange", () => setTimeout(fitDisplay, 300));

// ---------------------------------------------------------------- input

function queueKey(kind, key) {
    if (!codeMap[key]) return;
    evtQueue.queueEvent({
        kind: kind === "up" ? "keyup" : "keydown",
        args: [codeMap[key], "\x00", false, false],
    });
}

keyRepeatManager.register((kind, key) => {
    if (kind !== "click") queueKey(kind, key);
});

// On-screen keypad, multi-touch, finger can slide from key to key.
const keysEl = document.getElementById("keys");
const touchKeyMap = new Map();
let longPressTimer = null;

function keyAt(x, y) {
    const el = document.elementFromPoint(x, y);
    const key = el && el.closest(".key");
    return key && key.dataset.key ? key : null;
}

function press(key) {
    if (!key || key.classList.contains("active")) return;
    key.classList.add("active");
    keyRepeatManager.post(true, key.dataset.key);
    if (key.dataset.key === "F2") {
        clearTimeout(longPressTimer);
        longPressTimer = setTimeout(() => {
            release(key);
            changeJar();
        }, LONG_PRESS_MS);
    }
}

function release(key) {
    if (!key || !key.classList.contains("active")) return;
    key.classList.remove("active");
    keyRepeatManager.post(false, key.dataset.key);
    if (key.dataset.key === "F2") clearTimeout(longPressTimer);
}

keysEl.addEventListener("touchstart", e => {
    e.preventDefault();
    for (const t of e.changedTouches) {
        const key = keyAt(t.clientX, t.clientY);
        if (key) {
            touchKeyMap.set(t.identifier, key);
            press(key);
        }
    }
}, { passive: false });

keysEl.addEventListener("touchmove", e => {
    e.preventDefault();
    for (const t of e.changedTouches) {
        const now = keyAt(t.clientX, t.clientY);
        const before = touchKeyMap.get(t.identifier);
        if (now !== before) {
            release(before);
            if (now) {
                touchKeyMap.set(t.identifier, now);
                press(now);
            } else {
                touchKeyMap.delete(t.identifier);
            }
        }
    }
}, { passive: false });

function onTouchEnd(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
        release(touchKeyMap.get(t.identifier));
        touchKeyMap.delete(t.identifier);
    }
}
keysEl.addEventListener("touchend", onTouchEnd, { passive: false });
keysEl.addEventListener("touchcancel", onTouchEnd, { passive: false });

// Mouse, for testing on a computer
let mouseKey = null;
keysEl.addEventListener("mousedown", e => {
    mouseKey = keyAt(e.clientX, e.clientY);
    press(mouseKey);
});
document.addEventListener("mouseup", () => {
    release(mouseKey);
    mouseKey = null;
});

// Physical keyboard, for testing on a computer. Escape (emulator settings) is blocked.
function onKeyboard(e) {
    if (picker.classList.contains("show")) return;
    if (e.code !== "Escape" && codeMap[e.code]) {
        keyRepeatManager.post(e.type === "keydown", e.code);
    }
    e.preventDefault();
}
window.addEventListener("keydown", onKeyboard);
window.addEventListener("keyup", onKeyboard);

// Touching the game screen itself is forwarded as pointer input.
function toGameCoords(clientX, clientY) {
    const r = display.getBoundingClientRect();
    return {
        x: ((clientX - r.left) * display.width / r.width) | 0,
        y: ((clientY - r.top) * display.height / r.height) | 0,
    };
}

for (const [type, kind] of [["touchstart", "pointerpressed"], ["touchmove", "pointerdragged"], ["touchend", "pointerreleased"]]) {
    display.addEventListener(type, e => {
        e.preventDefault();
        const t = e.changedTouches[0];
        evtQueue.queueEvent({ kind, ...toGameCoords(t.clientX, t.clientY) });
    }, { passive: false });
}

// No pinch zoom, no double-tap zoom, no scrolling, no context menu.
for (const type of ["gesturestart", "gesturechange", "gestureend", "dblclick", "contextmenu"]) {
    document.addEventListener(type, e => e.preventDefault(), { passive: false });
}
document.addEventListener("touchmove", e => {
    if (!picker.classList.contains("show")) e.preventDefault();
}, { passive: false });

// ------------------------------------------------------------- emulator

async function startEmulator(jarBytes) {
    const audioCtx = createUnlockingAudioContext();
    // iOS suspends audio when the app goes to the background
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden && audioCtx.state !== "running") audioCtx.resume().catch(() => {});
    });
    for (const type of ["touchend", "mouseup"]) {
        document.addEventListener(type, () => {
            if (audioCtx.state !== "running") audioCtx.resume().catch(() => {});
        });
    }

    window.libmidi = new LibMidi(audioCtx);
    await window.libmidi.init();
    window.libmidi.midiPlayer.addEventListener("end-of-media", e => {
        evtQueue.queueEvent({ kind: "player-eom", player: e.target });
    });
    window.libmedia = new LibMedia();

    setStatus("Lädt Java…");

    await cheerpjInit({
        enableDebug: false,
        natives: {
            ...canvasFontNatives,
            ...canvasGraphicsNatives,
            ...gles2Natives,
            ...jsReferenceNatives,
            ...mediaBridgeNatives,
            ...midiBridgeNatives,
            async Java_pl_zb3_freej2me_bridge_shell_Shell_setTitle(lib, title) {},
            async Java_pl_zb3_freej2me_bridge_shell_Shell_setIcon(lib, iconBytes) {},
            async Java_pl_zb3_freej2me_bridge_shell_Shell_getScreenCtx(lib) {
                return screenCtx;
            },
            async Java_pl_zb3_freej2me_bridge_shell_Shell_setCanvasSize(lib, width, height) {
                if (!started) {
                    started = true;
                    statusEl.hidden = true;
                    display.style.display = "block";
                }
                display.width = width;
                display.height = height;
                fitDisplay();
            },
            async Java_pl_zb3_freej2me_bridge_shell_Shell_waitForAndDispatchEvents(lib, listener) {
                const KeyEvent = await lib.pl.zb3.freej2me.bridge.shell.KeyEvent;
                const PointerEvent = await lib.pl.zb3.freej2me.bridge.shell.PointerEvent;

                const evt = await evtQueue.waitForEvent();
                if (evt.kind == "keydown") {
                    await listener.keyPressed(await new KeyEvent(...evt.args));
                } else if (evt.kind == "keyup") {
                    await listener.keyReleased(await new KeyEvent(...evt.args));
                } else if (evt.kind == "pointerpressed") {
                    await listener.pointerPressed(await new PointerEvent(evt.x, evt.y));
                } else if (evt.kind == "pointerdragged") {
                    await listener.pointerDragged(await new PointerEvent(evt.x, evt.y));
                } else if (evt.kind == "pointerreleased") {
                    await listener.pointerReleased(await new PointerEvent(evt.x, evt.y));
                } else if (evt.kind == "player-eom") {
                    await listener.playerEOM(evt.player);
                } else if (evt.kind == "player-video-frame") {
                    await listener.playerVideoFrame(evt.player);
                }
            },
            async Java_pl_zb3_freej2me_bridge_shell_Shell_restart(lib) {
                location.reload();
            },
            async Java_pl_zb3_freej2me_bridge_shell_Shell_exit(lib) {
                // The game quit: start it again instead of showing a blank page
                location.reload();
            },
            async Java_pl_zb3_freej2me_bridge_shell_Shell_sthop(lib) {},
            async Java_pl_zb3_freej2me_bridge_shell_Shell_say(lib, sth) {
                console.log("[say]", sth);
            },
            async Java_pl_zb3_freej2me_bridge_shell_Shell_sayObject(lib, label, obj) {
                console.log("[sayobject]", label, obj);
            },
        },
    });

    setStatus("Startet Spiel…");

    const lib = await cheerpjRunLibrary(cheerpjEmuRoot + "/freej2me-web.jar");
    const LauncherUtil = await lib.pl.zb3.freej2me.launcher.LauncherUtil;
    const MIDletLoader = await lib.org.recompile.mobile.MIDletLoader;
    const JFile = await lib.java.io.File;
    const HashMap = await lib.java.util.HashMap;

    // Hand the jar from our IndexedDB to the Java filesystem.
    const jarFile = await new JFile(GAME_JAR_PATH);
    await LauncherUtil.copyJar(new Int8Array(jarBytes), jarFile);

    // Find out the app id from the manifest.
    const loader = await MIDletLoader.getMIDletLoader(jarFile);
    await LauncherUtil.ensureAppId(loader, "game.jar");
    const appId = await loader.getAppId();
    await loader.close();

    // Install as app: always overwrite app.jar (a newly picked jar wins),
    // keep the save data (rms), and force Nokia / 240x320 / sound on.
    await LauncherUtil.copyJar(new Int8Array(jarBytes), await new JFile("/files/" + appId + "/app.jar"));
    const settings = await new HashMap();
    for (const [k, v] of Object.entries(SETTINGS)) await settings.put(k, v);
    await LauncherUtil.saveApp(appId, settings, null, null);

    const FreeJ2ME = await lib.org.recompile.freej2me.FreeJ2ME;
    FreeJ2ME.main(["app", appId]).catch(e => {
        console.error(e);
        statusEl.hidden = false;
        display.style.display = "none";
        setStatus("Das Spiel ist abgestürzt :( Lange auf ✗ drücken, um eine andere .jar zu wählen.");
    });
}

async function main() {
    let jarBytes = null;
    try {
        jarBytes = await dbGet(JAR_KEY);
    } catch (e) {
        console.error(e);
    }
    if (!jarBytes) {
        setStatus("");
        jarBytes = await showPicker(false);
        setStatus("Lädt…");
    }

    try {
        await startEmulator(jarBytes);
    } catch (e) {
        console.error(e);
        setStatus("Fehler beim Laden. Internetverbindung prüfen und App neu öffnen.");
    }
}

main();
