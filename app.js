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

import { createUpscaler } from "./upscale.js";

// Fixed emulator settings (Nokia, 240x320, sound on).
const SETTINGS = { phone: "Nokia", width: "240", height: "320", sound: "on" };

// How long ✗ must be held to choose a different .jar,
// and ✓ to switch between smooth (xBR) and sharp pixels.
const LONG_PRESS_MS = 1500;

// Very short taps are stretched to this, otherwise the game may not notice them.
const MIN_PRESS_MS = 80;

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

// The game draws into the hidden 240x320 #display; in smooth mode we show
// an upscaled copy in #view, in sharp mode #display itself (pixelated).
const view = document.getElementById("view");
let upscaler = null;
try {
    upscaler = createUpscaler(view);
} catch (e) {
    console.error(e);
}

// ------------------------------------------------------------ preferences

function loadPref(key, fallback, allowed) {
    try {
        const value = localStorage.getItem(key);
        if (allowed.includes(value)) return value;
    } catch (e) {}
    return fallback;
}

function savePref(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch (e) {}
}

const BACKGROUNDS = ["aurora", "sky", "sunset", "night", "ocean", "graphite"];
const KEY_STYLES = ["glass", "brass", "ceramic", "minimal"];

const prefs = {
    gfx: loadPref("peggle.displayMode", "smooth", ["smooth", "sharp"]),
    bg: loadPref("peggle.background", "aurora", BACKGROUNDS),
    keys: loadPref("peggle.keyStyle", "glass", KEY_STYLES),
};

function applyLook() {
    document.body.dataset.bg = prefs.bg;
    for (const key of document.querySelectorAll("#keys .key")) {
        key.dataset.style = prefs.keys;
    }
}
applyLook();

function isSmooth() {
    return prefs.gfx === "smooth" && upscaler !== null;
}

function setGfx(value) {
    prefs.gfx = value;
    savePref("peggle.displayMode", value);
    fitDisplay();
}

function toggleDisplayMode() {
    setGfx(prefs.gfx === "smooth" ? "sharp" : "smooth");
    syncSheet();
}

function renderLoop() {
    if (started && isSmooth()) upscaler.draw(display);
    requestAnimationFrame(renderLoop);
}
requestAnimationFrame(renderLoop);

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

async function dbDelete(key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

// Ask the browser not to clear our storage when space runs low.
if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(() => {});
}

// ------------------------------------------------------------ save backup
// The game saves itself (RMS files in CheerpJ's IndexedDB-backed /files).
// This adds a backup file the user can keep outside the browser, e.g. in
// the Files app, and load back later (needed if the app gets deleted).

const SAVE_FORMAT = "peggle-save";
const RESTORE_KEY = "restore";
let currentAppId = null;

function bytesToBase64(bytes) {
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
}

function base64ToBytes(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
}

// Paths of the game's save files, e.g. "/Peggle/rms/peggle", read from
// CheerpJ's filesystem database.
async function listSavePaths() {
    const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open("cjFS_/files/");
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    const prefix = "/" + currentAppId + "/rms/";
    const paths = [];
    for (const storeName of db.objectStoreNames) {
        const keys = await new Promise((resolve, reject) => {
            const req = db.transaction(storeName).objectStore(storeName).getAllKeys();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        for (const key of keys) {
            if (typeof key === "string" && key.startsWith(prefix) && key.length > prefix.length) {
                paths.push(key);
            }
        }
    }
    db.close();
    return paths;
}

// Returns a File with all save data, or null if the game hasn't saved yet.
async function buildSaveFile() {
    if (!currentAppId) return null;
    const files = {};
    for (const path of await listSavePaths()) {
        const blob = await cjFileBlob("/files" + path);
        if (blob) {
            files[path.split("/").pop()] = bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
        }
    }
    if (Object.keys(files).length === 0) return null;

    const data = { format: SAVE_FORMAT, version: 1, app: currentAppId, created: new Date().toISOString(), files };
    const date = new Date().toISOString().slice(0, 10);
    return new File([JSON.stringify(data)], `peggle-spielstand-${date}.json`, { type: "application/json" });
}

function shareOrDownload(file) {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
        // iPhone: share sheet, then "In Dateien sichern"
        return navigator.share({ files: [file] }).catch(() => {});
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

async function readBackupFile(file) {
    const data = JSON.parse(await file.text());
    if (!data || data.format !== SAVE_FORMAT || typeof data.files !== "object") {
        throw new Error("not a save file");
    }
    return data;
}

// Called before the game starts: writes a backup chosen in the menu back.
async function applyPendingRestore(LauncherUtil, JFile, appId) {
    const data = await dbGet(RESTORE_KEY);
    if (!data) return;
    await dbDelete(RESTORE_KEY);
    for (const [name, b64] of Object.entries(data.files)) {
        if (!/^[^/\\]+$/.test(name)) continue;
        const target = await new JFile("/files/" + appId + "/rms/" + name);
        await LauncherUtil.copyJar(new Int8Array(base64ToBytes(b64).buffer), target);
    }
}

// ----------------------------------------------------------- first start

const picker = document.getElementById("picker");
const jarInput = document.getElementById("jar-input");

// Resolves with the jar bytes once the user picked and we stored a file.
function showPicker() {
    picker.classList.add("show");
    jarInput.value = "";
    return new Promise(resolve => {
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

// --------------------------------------------------------------- settings
// Long press ✗ opens a glass sheet over the game. The keypad stays visible
// below it, so a new key style can be seen (and pressed) right away.

const sheet = document.getElementById("sheet");
const saveExport = document.getElementById("save-export");
const saveInput = document.getElementById("save-input");
const saveHint = document.getElementById("save-hint");
const jarInput2 = document.getElementById("jar-input-2");
const SAVE_HINT = saveHint.textContent;
let saveFile = null;

function isSheetOpen() {
    return sheet.classList.contains("show");
}

function syncSheet() {
    for (const [groupId, value] of [["bg-choices", prefs.bg], ["style-choices", prefs.keys], ["gfx-choices", prefs.gfx]]) {
        for (const el of document.getElementById(groupId).querySelectorAll("[data-value]")) {
            el.setAttribute("aria-checked", String(el.dataset.value === value));
        }
    }
}

function setHint(text, warn) {
    saveHint.textContent = text;
    saveHint.classList.toggle("warn", !!warn);
}

function openMenu() {
    keyRepeatManager.reset();
    syncSheet();
    setHint(SAVE_HINT);
    saveInput.value = "";
    jarInput2.value = "";
    sheet.classList.add("show");
    sheet.setAttribute("aria-hidden", "false");

    // Prepare the backup now, so the share sheet opens right on tap
    // (iOS only allows it directly after a tap).
    saveFile = null;
    saveExport.disabled = true;
    buildSaveFile().then(file => {
        saveFile = file;
    }).catch(e => {
        console.error(e);
    }).finally(() => {
        saveExport.disabled = false;
    });
}

function closeMenu() {
    sheet.classList.remove("show");
    sheet.setAttribute("aria-hidden", "true");
}

function onChoice(groupId, handler) {
    document.getElementById(groupId).addEventListener("click", e => {
        const el = e.target.closest("[data-value]");
        if (!el) return;
        handler(el.dataset.value);
        syncSheet();
    });
}

onChoice("bg-choices", value => {
    prefs.bg = value;
    savePref("peggle.background", value);
    applyLook();
});
onChoice("style-choices", value => {
    prefs.keys = value;
    savePref("peggle.keyStyle", value);
    applyLook();
});
onChoice("gfx-choices", setGfx);

document.getElementById("sheet-done").addEventListener("click", closeMenu);

saveExport.addEventListener("click", () => {
    if (saveFile) {
        shareOrDownload(saveFile);
    } else {
        setHint("Noch kein Spielstand vorhanden. Schaff ein Level, dann klappt es.", true);
    }
});

saveInput.addEventListener("change", async () => {
    const file = saveInput.files[0];
    if (!file) return;
    try {
        const data = await readBackupFile(file);
        if (!confirm("Spielstand vom " + new Date(data.created).toLocaleDateString("de-DE") +
                " laden? Der aktuelle Spielstand wird ersetzt.")) {
            return;
        }
        await dbPut(RESTORE_KEY, data);
        location.reload();
    } catch (e) {
        console.error(e);
        setHint("Das ist keine Spielstand-Datei. Wähle eine Datei „peggle-spielstand-….json“.", true);
    }
});

jarInput2.addEventListener("change", async () => {
    const file = jarInput2.files[0];
    if (!file) return;
    await dbPut(JAR_KEY, await file.arrayBuffer());
    location.reload();
});

// --------------------------------------------------------------- layout

function fitDisplay() {
    if (!started || !display.width || !display.height) return;
    const area = document.getElementById("screen");
    const scale = Math.min(area.clientWidth / display.width, area.clientHeight / display.height);
    const cssW = Math.floor(display.width * scale);
    const cssH = Math.floor(display.height * scale);

    const shown = isSmooth() ? view : display;
    const hidden = isSmooth() ? display : view;
    hidden.style.display = "none";
    shown.style.display = "block";
    shown.style.width = cssW + "px";
    shown.style.height = cssH + "px";

    if (shown === view) {
        // Render at the phone's real pixel resolution
        const dpr = window.devicePixelRatio || 1;
        view.width = Math.round(cssW * dpr);
        view.height = Math.round(cssH * dpr);
        upscaler.draw(display);
    }
}

// The settings sheet ends just above the keypad.
function measureKeys() {
    document.documentElement.style.setProperty("--keys-h", document.getElementById("keys").offsetHeight + "px");
}
measureKeys();

window.addEventListener("resize", () => {
    measureKeys();
    fitDisplay();
});
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

// Hidden actions on long press
const LONG_PRESS_ACTIONS = { F1: toggleDisplayMode, F2: openMenu };
const longPressTimers = new Map();
const pressedAt = new Map();
const pendingUps = new Map();

function keyAt(x, y) {
    const el = document.elementFromPoint(x, y);
    const key = el && el.closest(".key");
    return key && key.dataset.key ? key : null;
}

function sendUp(code) {
    pendingUps.delete(code);
    keyRepeatManager.post(false, code);
}

// Keys pressed while the settings are open only light up (style preview).
const previewOnly = new Set();

function press(key) {
    if (!key || key.classList.contains("active")) return;
    const code = key.dataset.key;
    key.classList.add("active");

    if (isSheetOpen()) {
        previewOnly.add(code);
        return;
    }

    if (pendingUps.has(code)) {
        clearTimeout(pendingUps.get(code));
        sendUp(code);
    }
    pressedAt.set(code, performance.now());
    keyRepeatManager.post(true, code);

    const action = LONG_PRESS_ACTIONS[code];
    if (action) {
        clearTimeout(longPressTimers.get(code));
        longPressTimers.set(code, setTimeout(() => {
            release(key);
            action();
        }, LONG_PRESS_MS));
    }
}

function release(key) {
    if (!key || !key.classList.contains("active")) return;
    const code = key.dataset.key;
    key.classList.remove("active");
    if (previewOnly.delete(code)) return;
    clearTimeout(longPressTimers.get(code));

    const remaining = MIN_PRESS_MS - (performance.now() - pressedAt.get(code));
    if (remaining > 0) {
        pendingUps.set(code, setTimeout(() => sendUp(code), remaining));
    } else {
        sendUp(code);
    }
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
    if (picker.classList.contains("show") || isSheetOpen()) return;
    if (e.code !== "Escape" && codeMap[e.code]) {
        keyRepeatManager.post(e.type === "keydown", e.code);
    }
    e.preventDefault();
}
window.addEventListener("keydown", onKeyboard);
window.addEventListener("keyup", onKeyboard);

// Touching the game screen itself is forwarded as pointer input.
function toGameCoords(target, clientX, clientY) {
    const r = target.getBoundingClientRect();
    return {
        x: ((clientX - r.left) * display.width / r.width) | 0,
        y: ((clientY - r.top) * display.height / r.height) | 0,
    };
}

for (const canvas of [display, view]) {
    for (const [type, kind] of [["touchstart", "pointerpressed"], ["touchmove", "pointerdragged"], ["touchend", "pointerreleased"]]) {
        canvas.addEventListener(type, e => {
            e.preventDefault();
            const t = e.changedTouches[0];
            evtQueue.queueEvent({ kind, ...toGameCoords(canvas, t.clientX, t.clientY) });
        }, { passive: false });
    }
}

// No pinch zoom, no double-tap zoom, no scrolling, no context menu.
for (const type of ["gesturestart", "gesturechange", "gestureend", "dblclick", "contextmenu"]) {
    document.addEventListener(type, e => e.preventDefault(), { passive: false });
}
document.addEventListener("touchmove", e => {
    // Only the settings list may scroll
    if (!e.target.closest(".sheet-body")) e.preventDefault();
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

    currentAppId = appId;
    try {
        await applyPendingRestore(LauncherUtil, JFile, appId);
    } catch (e) {
        console.error(e);
    }

    const FreeJ2ME = await lib.org.recompile.freej2me.FreeJ2ME;
    FreeJ2ME.main(["app", appId]).catch(e => {
        console.error(e);
        started = false;
        statusEl.hidden = false;
        display.style.display = "none";
        view.style.display = "none";
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
        jarBytes = await showPicker();
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
