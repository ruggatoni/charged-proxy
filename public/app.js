/* ==========================================================
   The Charged Proxy — front-end
   ========================================================== */
(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);

  // Set by electron/preload.cjs when running in the Charged Browser app.
  const desktop = window.chargedApp || null;
  const HOME_TITLE = desktop ? "Charged Browser" : "The Charged Proxy";
  const appTitle = $("#appTitle");

  function setPageTitle(t) {
    document.title = t ? `${t} · Charged` : HOME_TITLE;
    appTitle.textContent = t || "";
  }
  setPageTitle("");

  /* ---------------- settings (per-browser) ---------------- */

  const DEFAULTS = {
    engine: "https://duckduckgo.com/?q=%s",
    proxy: "scramjet",
    transport: "libcurl",
    sparks: true,
    recents: [],
  };

  function load(key) {
    try {
      const raw = localStorage.getItem("charged:" + key);
      return raw === null ? DEFAULTS[key] : JSON.parse(raw);
    } catch {
      return DEFAULTS[key];
    }
  }
  function save(key, value) {
    try { localStorage.setItem("charged:" + key, JSON.stringify(value)); } catch {}
  }

  const settings = {
    engine: load("engine"),
    proxy: load("proxy"),
    transport: load("transport"),
    sparks: load("sparks"),
    recents: Array.isArray(load("recents")) ? load("recents") : [],
  };

  /* ---------------- status + toast ---------------- */

  const statusEl = $("#status");
  function setStatus(state, label, title) {
    statusEl.className = "status " + state;
    statusEl.querySelector(".label").textContent = label;
    statusEl.title = title || label;
  }

  let toastTimer;
  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), 5000);
  }

  /* ---------------- proxy engine ---------------- */

  const connection = new BareMux.BareMuxConnection("/baremux/worker.js");
  const wispUrl = (location.protocol === "https:" ? "wss" : "ws") + "://" + location.host + "/wisp/";

  // Two interchangeable engines that tunnel traffic over Wisp.
  const TRANSPORTS = {
    epoxy:   ["/epoxy/index.mjs",   [{ wisp: wispUrl }]],
    libcurl: ["/libcurl/index.mjs", [{ websocket: wispUrl }]],
  };
  if (!TRANSPORTS[settings.transport]) settings.transport = DEFAULTS.transport;
  if (!["scramjet", "uv"].includes(settings.proxy)) settings.proxy = DEFAULTS.proxy;

  // Scramjet is the main rewriting engine; Ultraviolet is the fallback.
  const { ScramjetController } = $scramjetLoadController();
  const scramjet = new ScramjetController({
    prefix: "/scramjet/",
    files: {
      wasm: "/scram/scramjet.wasm.wasm",
      all: "/scram/scramjet.all.js",
      sync: "/scram/scramjet.sync.js",
    },
  });

  async function applyTransport() {
    const [path, opts] = TRANSPORTS[settings.transport];
    if ((await connection.getTransport()) !== path) {
      await connection.setTransport(path, opts);
    }
  }

  async function charge() {
    if (!("serviceWorker" in navigator)) {
      throw new Error(
        location.protocol === "https:" || ["localhost", "127.0.0.1"].includes(location.hostname)
          ? "This browser has service workers turned off (private windows often do). Try a normal window."
          : "The proxy needs HTTPS or localhost to run. Open it over https:// or at localhost."
      );
    }

    // Drop any worker from an older build that used a narrower scope.
    for (const old of await navigator.serviceWorker.getRegistrations()) {
      if (new URL(old.scope).pathname !== "/") await old.unregister();
    }

    await scramjet.init();

    const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    const worker = reg.installing || reg.waiting || reg.active;
    if (worker && worker.state !== "activated") {
      await new Promise((resolve) => {
        worker.addEventListener("statechange", () => {
          if (worker.state === "activated") resolve();
        });
      });
    }

    await applyTransport();
  }

  let ready;
  function powerUp() {
    setStatus("charging", "Charging…", "Connecting the proxy engine");
    ready = charge().then(
      () => setStatus("ready", "Charged", "Proxy engine online"),
      (err) => {
        console.error("[charged]", err);
        setStatus("error", "No power", err.message);
        throw err;
      }
    );
    ready.catch(() => {});
    return ready;
  }
  powerUp();

  /* ---------------- url helpers ---------------- */

  function toUrl(input) {
    const text = input.trim();
    if (!text) return null;

    try {
      const u = new URL(text);
      if (u.protocol === "http:" || u.protocol === "https:") return u.href;
    } catch {}

    if (!/\s/.test(text)) {
      try {
        const u = new URL("https://" + text);
        if (u.hostname.includes(".") && !u.hostname.endsWith(".")) return u.href;
      } catch {}
    }

    return settings.engine.replace("%s", encodeURIComponent(text));
  }

  const proxied = (url) =>
    settings.proxy === "uv"
      ? __uv$config.prefix + __uv$config.encodeUrl(url)
      : scramjet.encodeUrl(url);

  function decodeFrameUrl() {
    try {
      const href = frame.contentWindow.location.href;

      if (href.startsWith(location.origin + "/scramjet/")) {
        return scramjet.decodeUrl(href);
      }

      const uvBase = location.origin + __uv$config.prefix;
      if (href.startsWith(uvBase)) {
        const [encoded, ...hash] = href.slice(uvBase.length).split("#");
        const real = __uv$config.decodeUrl(encoded);
        return hash.length ? real + "#" + hash.join("#") : real;
      }
    } catch {}
    return null;
  }

  /* ---------------- the goat ---------------- */

  const goat = $("#goat");
  const mascot = $("#mascot");
  const FACES = {
    idle: "/img/goat/1_idle.png",
    blink: "/img/goat/1_idle_blink.png",
    talk: "/img/goat/1_talk.png",
    happy: "/img/goat/2_happy_idle.png",
    happyTalk: "/img/goat/2_happy_talk.png",
    shocked: "/img/goat/3_shocked_idle.png",
  };
  Object.values(FACES).forEach((src) => { new Image().src = src; });

  let mood = "normal";      // normal | happy | shocked
  let mouthOpen = false;
  let blinking = false;
  let talkUntil = 0;
  let moodTimer;

  function drawGoat() {
    if (!document.getElementById("browser").hidden) return; // resting while you browse
    let face;
    if (mood === "shocked") face = FACES.shocked;
    else if (mood === "happy") face = mouthOpen ? FACES.happyTalk : FACES.happy;
    else if (mouthOpen) face = FACES.talk;
    else face = blinking ? FACES.blink : FACES.idle;
    if (!goat.src.endsWith(face)) goat.src = face;
  }

  function setMood(next, ms) {
    mood = next;
    clearTimeout(moodTimer);
    if (ms) moodTimer = setTimeout(() => {
      mood = document.activeElement === searchInput ? "happy" : "normal";
      drawGoat();
    }, ms);
    drawGoat();
  }

  function zap() {
    mascot.classList.remove("zap");
    void mascot.offsetWidth;
    mascot.classList.add("zap");
  }

  (function blinkLoop() {
    setTimeout(() => {
      blinking = true;
      drawGoat();
      setTimeout(() => { blinking = false; drawGoat(); blinkLoop(); }, 140);
    }, 2400 + Math.random() * 3200);
  })();

  // Goat "talks" while you type, like a veadotube avatar.
  let talkTimer = null;
  function talk() {
    talkUntil = performance.now() + 260;
    if (talkTimer) return;
    talkTimer = setInterval(() => {
      if (performance.now() > talkUntil) {
        clearInterval(talkTimer);
        talkTimer = null;
        mouthOpen = false;
      } else {
        mouthOpen = !mouthOpen;
      }
      drawGoat();
    }, 110);
  }

  mascot.addEventListener("click", () => { zap(); setMood("happy", 1600); });

  /* ---------------- search ---------------- */

  const searchForm = $("#searchForm");
  const searchInput = $("#searchInput");

  searchInput.addEventListener("input", talk);
  searchInput.addEventListener("focus", () => { if (mood !== "shocked") setMood("happy"); });
  searchInput.addEventListener("blur", () => { if (mood === "happy") setMood("normal"); });

  searchForm.addEventListener("submit", (e) => {
    e.preventDefault();
    go(searchInput.value);
  });

  document.addEventListener("keydown", (e) => {
    const typing = e.target.closest && e.target.closest("input, textarea, select, [contenteditable]");
    if (e.key === "/" && browser.hidden && !dialog.open && !typing) {
      e.preventDefault();
      searchInput.focus();
    }
  });

  async function go(input) {
    const url = toUrl(input);
    if (!url) {
      zap();
      setMood("shocked", 1400);
      return;
    }

    try {
      await ready;
    } catch {
      // Try once more in case it was a hiccup.
      try { await powerUp(); } catch (err) {
        zap();
        setMood("shocked", 2500);
        toast("⚡ Short circuit: " + err.message);
        return;
      }
    }

    zap();
    addRecent(url);
    openBrowser(url);
  }

  /* ---------------- quick tiles ---------------- */

  const SITES = [
    { name: "YouTube",   url: "https://www.youtube.com",   mono: "YT", c: "#ff4d5e" },
    { name: "Google",    url: "https://www.google.com",    mono: "G",  c: "#4c8bf5" },
    { name: "Discord",   url: "https://discord.com/app",   mono: "DC", c: "#7f8bff" },
    { name: "Reddit",    url: "https://www.reddit.com",    mono: "R",  c: "#ff6a2b" },
    { name: "Wikipedia", url: "https://en.wikipedia.org",  mono: "W",  c: "#d6dae8" },
    { name: "GitHub",    url: "https://github.com",        mono: "GH", c: "#a8b4ff" },
    { name: "Twitch",    url: "https://www.twitch.tv",     mono: "TV", c: "#a970ff" },
    { name: "Spotify",   url: "https://open.spotify.com",  mono: "SP", c: "#1ed760" },
  ];

  const tiles = $("#tiles");
  for (const site of SITES) {
    const b = document.createElement("button");
    b.className = "tile";
    b.type = "button";
    b.style.setProperty("--c", site.c);
    b.innerHTML = `<span class="mono"></span><span class="name"></span>`;
    b.querySelector(".mono").textContent = site.mono;
    b.querySelector(".name").textContent = site.name;
    b.addEventListener("click", () => go(site.url));
    b.addEventListener("mouseenter", talk);
    tiles.appendChild(b);
  }

  /* ---------------- recents ---------------- */

  const recentsEl = $("#recents");

  function prettyHost(url) {
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
  }

  function addRecent(url) {
    // Don't save search result pages, just real destinations.
    const host = prettyHost(url);
    if (settings.engine.includes(host) && url !== "https://" + host + "/") return;
    settings.recents = [url, ...settings.recents.filter((u) => prettyHost(u) !== host)].slice(0, 6);
    save("recents", settings.recents);
    renderRecents();
  }

  function renderRecents() {
    recentsEl.innerHTML = "";
    recentsEl.hidden = settings.recents.length === 0;
    for (const url of settings.recents) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.textContent = prettyHost(url);
      chip.title = url;
      chip.addEventListener("click", () => go(url));
      recentsEl.appendChild(chip);
    }
  }
  renderRecents();

  /* ---------------- browser view ---------------- */

  const browser = $("#browser");
  const home = $("#home");
  const bgEl = $(".bg");
  const frameWrap = $("#frameWrap");
  let frame = $("#frame");
  const addrInput = $("#addrInput");
  const loadbar = $("#loadbar");
  let syncTimer = null;

  function loadStart() {
    loadbar.classList.remove("done");
    void loadbar.offsetWidth;
    loadbar.classList.add("on");
  }
  function loadDone() {
    loadbar.classList.remove("on");
    loadbar.classList.add("done");
  }

  function showAddress(url) {
    if (url && document.activeElement !== addrInput) addrInput.value = url;
  }

  function syncTitle() {
    try {
      setPageTitle(frame.contentDocument && frame.contentDocument.title);
    } catch {}
  }

  function wireFrame() {
    // Scramjet must know about the iframe (it names and tags it), and its
    // navigate/urlchange events drive the load bar and address bar.
    // Don't poll or hook the proxied window from out here: on heavy pages
    // like YouTube that can lock the whole tab up.
    const sjFrame = scramjet.createFrame(frame);
    sjFrame.addEventListener("navigate", loadStart);
    sjFrame.addEventListener("urlchange", (e) => showAddress(e.url));
    frame.addEventListener("load", () => {
      loadDone();
      showAddress(decodeFrameUrl());
      syncTitle();
    });
  }
  wireFrame();

  function startSync() {
    clearInterval(syncTimer);
    // Ultraviolet has no navigation events, so follow its URL by polling.
    if (settings.proxy === "uv") {
      syncTimer = setInterval(() => { showAddress(decodeFrameUrl()); syncTitle(); }, 800);
    }
  }

  // `src` is an already-proxied path (from a popup or new window); otherwise
  // the real URL gets proxied here.
  function openBrowser(url, src) {
    browser.hidden = false;
    // Take the home screen (and its animations) out of the page entirely
    // while browsing so the proxied site gets the whole renderer.
    home.hidden = true;
    bgEl.hidden = true;
    searchInput.blur();
    document.body.style.overflow = "hidden";
    addrInput.value = url || "";
    loadStart();
    frame.src = src || proxied(url);
    startSync();
    if (sparks) sparks.pause();
  }

  function closeBrowser() {
    clearInterval(syncTimer);
    // Swap in a fresh iframe so the old page (and its audio) is fully gone.
    const fresh = document.createElement("iframe");
    fresh.id = "frame";
    fresh.title = frame.title;
    fresh.setAttribute("allow", frame.getAttribute("allow"));
    frame.replaceWith(fresh);
    frame = fresh;
    wireFrame();

    browser.hidden = true;
    home.hidden = false;
    bgEl.hidden = false;
    document.body.style.overflow = "";
    setPageTitle("");
    loadbar.className = "loadbar";
    if (sparks) sparks.resume();
    searchInput.value = "";
    setMood("happy", 1200);
  }

  $("#addrForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const url = toUrl(addrInput.value);
    if (!url) return;
    addRecent(url);
    loadStart();
    frame.src = proxied(url);
    startSync();
    addrInput.blur();
  });
  addrInput.addEventListener("focus", () => addrInput.select());
  addrInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { addrInput.blur(); showAddress(decodeFrameUrl()); }
  });

  $("#bBack").addEventListener("click", () => { try { frame.contentWindow.history.back(); } catch {} });
  $("#bFwd").addEventListener("click", () => { try { frame.contentWindow.history.forward(); } catch {} });
  $("#bReload").addEventListener("click", () => {
    loadStart();
    try { frame.contentWindow.location.reload(); } catch { frame.src = frame.src; }
  });
  $("#bHome").addEventListener("click", closeBrowser);
  $("#bClose").addEventListener("click", closeBrowser);
  $("#bFull").addEventListener("click", () => {
    if (frameWrap.requestFullscreen) frameWrap.requestFullscreen().catch(() => {});
  });
  $("#bPop").addEventListener("click", () => {
    let href;
    try { href = frame.contentWindow.location.href; } catch {}
    if (href && href !== "about:blank") window.open(href, "_blank", "noopener");
  });

  /* ---------------- settings dialog ---------------- */

  const dialog = $("#settings");
  const engineSelect = $("#engineSelect");
  const sparksToggle = $("#sparksToggle");
  const transportSelect = $("#transportSelect");
  const engineKindSelect = $("#engineKindSelect");

  transportSelect.value = settings.transport;
  engineKindSelect.value = settings.proxy;
  engineSelect.value = settings.engine;
  if (engineSelect.value !== settings.engine) engineSelect.value = DEFAULTS.engine;
  sparksToggle.checked = !!settings.sparks;

  $("#openSettings").addEventListener("click", () => dialog.showModal());
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });

  engineSelect.addEventListener("change", () => {
    settings.engine = engineSelect.value;
    save("engine", settings.engine);
  });
  engineKindSelect.addEventListener("change", () => {
    settings.proxy = engineKindSelect.value;
    save("proxy", settings.proxy);
  });
  transportSelect.addEventListener("change", () => {
    settings.transport = transportSelect.value;
    save("transport", settings.transport);
    powerUp();
  });
  sparksToggle.addEventListener("change", () => {
    settings.sparks = sparksToggle.checked;
    save("sparks", settings.sparks);
    settings.sparks ? sparks.start() : sparks.stop();
  });
  $("#clearRecents").addEventListener("click", () => {
    settings.recents = [];
    save("recents", []);
    renderRecents();
  });

  /* ---------------- sparks + lightning canvas ---------------- */

  const sparks = (() => {
    const canvas = $("#sparks");
    const ctx = canvas.getContext("2d");
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const COLORS = ["34,211,238", "79,91,255", "155,60,240", "224,68,196"];
    let w = 0, h = 0, dpr = 1;
    let particles = [];
    let bolts = [];
    let running = false;
    let paused = false;
    let raf = 0;
    let nextBolt = 0;

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.round(Math.min(90, (w * h) / 16000));
      particles = Array.from({ length: count }, () => spawn(true));
    }

    function spawn(anywhere) {
      return {
        x: Math.random() * w,
        y: anywhere ? Math.random() * h : h + 10,
        r: Math.random() * 1.6 + 0.4,
        vy: -(Math.random() * 0.35 + 0.08),
        vx: (Math.random() - 0.5) * 0.12,
        phase: Math.random() * Math.PI * 2,
        c: COLORS[(Math.random() * COLORS.length) | 0],
      };
    }

    function makeBolt() {
      const x0 = w * (0.1 + Math.random() * 0.8);
      const y0 = -10;
      const len = h * (0.25 + Math.random() * 0.3);
      const pts = [[x0, y0]];
      let x = x0, y = y0;
      while (y < y0 + len) {
        x += (Math.random() - 0.5) * 46;
        y += 14 + Math.random() * 26;
        pts.push([x, y]);
      }
      return { pts, life: 1, c: COLORS[(Math.random() * 3) | 0] };
    }

    function frame(t) {
      raf = requestAnimationFrame(frame);
      ctx.clearRect(0, 0, w, h);

      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.phase += 0.03;
        if (p.y < -10) Object.assign(p, spawn(false));
        const a = 0.35 + Math.sin(p.phase) * 0.3;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${p.c},${a})`;
        ctx.shadowColor = `rgba(${p.c},0.9)`;
        ctx.shadowBlur = 8;
        ctx.fill();
      }

      if (t > nextBolt) {
        bolts.push(makeBolt());
        nextBolt = t + 5000 + Math.random() * 9000;
      }
      bolts = bolts.filter((b) => b.life > 0);
      for (const b of bolts) {
        const flicker = b.life > 0.7 ? (Math.random() > 0.3 ? 1 : 0.3) : b.life;
        ctx.beginPath();
        b.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.strokeStyle = `rgba(${b.c},${0.55 * flicker})`;
        ctx.lineWidth = 2;
        ctx.shadowColor = `rgba(${b.c},1)`;
        ctx.shadowBlur = 18;
        ctx.stroke();
        ctx.strokeStyle = `rgba(255,255,255,${0.5 * flicker})`;
        ctx.lineWidth = 0.8;
        ctx.stroke();
        b.life -= 0.018;
      }
      ctx.shadowBlur = 0;
    }

    function start() {
      if (running || reduced) return;
      running = true;
      canvas.hidden = false;
      resize();
      nextBolt = performance.now() + 2500;
      if (!paused) raf = requestAnimationFrame(frame);
    }
    function stop() {
      running = false;
      cancelAnimationFrame(raf);
      ctx.clearRect(0, 0, w, h);
      canvas.hidden = true;
    }
    function pause() { paused = true; cancelAnimationFrame(raf); }
    function resume() {
      paused = false;
      if (running) { cancelAnimationFrame(raf); raf = requestAnimationFrame(frame); }
    }

    window.addEventListener("resize", () => running && resize());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) cancelAnimationFrame(raf);
      else if (running && !paused) { cancelAnimationFrame(raf); raf = requestAnimationFrame(frame); }
    });

    return { start, stop, pause, resume };
  })();

  if (settings.sparks) sparks.start();

  /* ---------------- links into the app ---------------- */
  // #go=<url or search>      open a site
  // #open=<proxied path>     reopen a page that's already proxied (popups, new windows)

  async function handleHash(hash) {
    const m = /^#(go|open)=(.+)$/.exec(hash || "");
    if (!m) return;
    if (location.hash) history.replaceState(null, "", location.pathname);

    let value;
    try { value = decodeURIComponent(m[2]); } catch { return; }

    if (m[1] === "go") return go(value);
    if (!value.startsWith("/scramjet/") && !value.startsWith(__uv$config.prefix)) return;
    try { await ready; } catch { return; }
    openBrowser(null, value);
  }

  window.addEventListener("hashchange", () => handleHash(location.hash));
  handleHash(location.hash);

  /* ---------------- desktop app shortcuts ---------------- */

  if (desktop) {
    $("#bPop").title = "Open in new window";
    $("#bPop").setAttribute("aria-label", "Open in new window");

    desktop.onCommand((cmd, arg) => {
      if (cmd === "hash") return handleHash(arg);
      if (cmd === "address") {
        if (browser.hidden) searchInput.focus();
        else { addrInput.focus(); addrInput.select(); }
        return;
      }
      if (browser.hidden) return;
      if (cmd === "reload") $("#bReload").click();
      else if (cmd === "back") $("#bBack").click();
      else if (cmd === "forward") $("#bFwd").click();
      else if (cmd === "home") closeBrowser();
    });
  }
})();
