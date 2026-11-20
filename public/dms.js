/* ==========================================================
   The Charged Proxy — direct messages
   ========================================================== */
(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);

  const panel = $("#dms");
  const scrim = $("#dmScrim");
  const views = { auth: $("#dmAuth"), list: $("#dmList"), thread: $("#dmThread") };
  const titleEl = $("#dmTitle");
  const avatarEl = $("#dmAvatar");
  const backBtn = $("#dmBack");
  const blockBtn = $("#dmBlock");
  const msgsEl = $("#msgs");
  const composeInput = $("#composeInput");
  const threadNote = $("#threadNote");

  const state = {
    me: null,           // { username }
    view: "auth",
    open: null,         // { username, blocked }
    unread: 0,
    ws: null,
    wsRetry: 0,
    seen: new Set(),    // message ids already drawn in the open thread
    authMode: "signup",
  };

  /* ---------------- api ---------------- */

  async function api(path, opts = {}) {
    const res = await fetch("/api" + path, {
      method: opts.method || (opts.body ? "POST" : "GET"),
      headers: opts.body ? { "Content-Type": "application/json" } : {},
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: "same-origin",
    });
    let data = {};
    try { data = await res.json(); } catch {}
    if (!res.ok) {
      const err = new Error(data.error || "Something went wrong.");
      err.status = res.status;
      throw err;
    }
    return data;
  }

  /* ---------------- little helpers ---------------- */

  function initial(name) { return (name || "?").slice(0, 1).toUpperCase(); }

  // Same name always gets the same hue so people are easy to recognize.
  function hue(name) {
    let h = 0;
    for (const c of (name || "").toLowerCase()) h = (h * 31 + c.charCodeAt(0)) % 360;
    return h;
  }

  function paintAvatar(el, name) {
    el.textContent = initial(name);
    el.style.setProperty("--h", hue(name));
  }

  function ago(ts) {
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 45) return "now";
    if (s < 3600) return Math.round(s / 60) + "m";
    if (s < 86400) return Math.round(s / 3600) + "h";
    if (s < 604800) return Math.round(s / 86400) + "d";
    return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function clock(ts) {
    return new Date(ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }

  function showError(el, msg) {
    el.textContent = msg || "";
    el.hidden = !msg;
  }

  /* ---------------- unread badge + ping ---------------- */

  function setUnread(n) {
    state.unread = Math.max(0, n);
    for (const b of document.querySelectorAll(".dm-btn .badge")) {
      b.textContent = state.unread > 99 ? "99+" : String(state.unread);
      b.hidden = state.unread === 0;
    }
  }

  let pingTimer;
  function ping(message) {
    const el = $("#ping");
    el.innerHTML = "";
    const av = document.createElement("span");
    av.className = "avatar sm";
    paintAvatar(av, message.from);
    const text = document.createElement("div");
    const who = document.createElement("b");
    who.textContent = "@" + message.from;
    const body = document.createElement("span");
    body.textContent = message.body.length > 70 ? message.body.slice(0, 70) + "…" : message.body;
    text.append(who, body);
    el.append(av, text);
    el.hidden = false;
    el.onclick = () => { el.hidden = true; openPanel(); openThread(message.from); };
    clearTimeout(pingTimer);
    pingTimer = setTimeout(() => (el.hidden = true), 5000);
  }

  /* ---------------- views ---------------- */

  function show(view) {
    state.view = view;
    for (const [name, el] of Object.entries(views)) el.hidden = name !== view;
    backBtn.hidden = view !== "thread";
    blockBtn.hidden = view !== "thread";
    avatarEl.hidden = view !== "thread";
    if (view !== "thread") {
      state.open = null;
      titleEl.textContent = "Messages";
    }
  }

  function openPanel() {
    panel.hidden = false;
    scrim.hidden = false;
    requestAnimationFrame(() => panel.classList.add("in"));
    if (!state.me) {
      show("auth");
      setTimeout(() => $("#authUser").focus(), 50);
    } else if (state.view === "thread" && state.open) {
      openThread(state.open.username);
    } else {
      showList();
    }
  }

  function closePanel() {
    panel.classList.remove("in");
    scrim.hidden = true;
    setTimeout(() => { if (!panel.classList.contains("in")) panel.hidden = true; }, 220);
  }

  const isOpen = () => !panel.hidden && panel.classList.contains("in");

  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-open-dms]")) openPanel();
  });
  $("#dmClose").addEventListener("click", closePanel);
  scrim.addEventListener("click", closePanel);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && isOpen()) closePanel(); });
  backBtn.addEventListener("click", showList);

  /* ---------------- sign up / log in ---------------- */

  for (const b of document.querySelectorAll(".seg button")) {
    b.addEventListener("click", () => {
      state.authMode = b.dataset.mode;
      document.querySelectorAll(".seg button").forEach((x) => x.classList.toggle("on", x === b));
      $("#authSubmit").textContent = state.authMode === "signup" ? "Create account" : "Log in";
      $("#authPass").setAttribute("autocomplete", state.authMode === "signup" ? "new-password" : "current-password");
      showError($("#authError"), "");
    });
  }

  $("#authForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#authSubmit");
    btn.disabled = true;
    try {
      const { user } = await api("/" + state.authMode, {
        body: { username: $("#authUser").value.trim(), password: $("#authPass").value },
      });
      $("#authPass").value = "";
      showError($("#authError"), "");
      signedIn(user, 0);
      showList();
    } catch (err) {
      showError($("#authError"), err.message);
    } finally {
      btn.disabled = false;
    }
  });

  $("#dmLogout").addEventListener("click", async () => {
    try { await api("/logout", { method: "POST" }); } catch {}
    state.me = null;
    if (state.ws) { state.ws.onclose = null; state.ws.close(); state.ws = null; }
    setUnread(0);
    show("auth");
  });

  function signedIn(user, unread) {
    state.me = user;
    $("#dmMe").textContent = "@" + user.username;
    setUnread(unread);
    connect();
  }

  /* ---------------- conversation list ---------------- */

  async function showList() {
    show("list");
    showError($("#dmNewError"), "");
    try {
      const { conversations } = await api("/conversations");
      renderConvos(conversations);
      setUnread(conversations.reduce((n, c) => n + (c.blocked ? 0 : c.unread), 0));
    } catch (err) {
      if (err.status === 401) return loggedOut();
      showError($("#dmNewError"), err.message);
    }
  }

  function renderConvos(list) {
    const box = $("#convos");
    box.innerHTML = "";
    $("#convosEmpty").hidden = list.length > 0;
    for (const c of list) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "convo" + (c.unread && !c.blocked ? " unread" : "");
      const av = document.createElement("span");
      av.className = "avatar";
      paintAvatar(av, c.username);
      const mid = document.createElement("span");
      mid.className = "convo-mid";
      const name = document.createElement("b");
      name.textContent = "@" + c.username + (c.blocked ? " · blocked" : "");
      const last = document.createElement("span");
      last.className = "convo-last";
      last.textContent = (c.lastFromMe ? "You: " : "") + c.last;
      mid.append(name, last);
      const side = document.createElement("span");
      side.className = "convo-side";
      const when = document.createElement("time");
      when.textContent = ago(c.at);
      side.append(when);
      if (c.unread && !c.blocked) {
        const dot = document.createElement("span");
        dot.className = "count";
        dot.textContent = c.unread;
        side.append(dot);
      }
      row.append(av, mid, side);
      row.addEventListener("click", () => openThread(c.username));
      box.append(row);
    }
  }

  $("#dmNew").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("#dmNewUser").value.trim().replace(/^@/, "");
    if (!name) return;
    $("#dmNewUser").value = "";
    openThread(name);
  });

  function loggedOut() {
    state.me = null;
    setUnread(0);
    show("auth");
  }

  /* ---------------- one conversation ---------------- */

  async function openThread(username) {
    try {
      const data = await api("/messages/" + encodeURIComponent(username));
      state.open = data.with;
      show("thread");
      titleEl.textContent = "@" + data.with.username;
      paintAvatar(avatarEl, data.with.username);
      setBlockedUi(data.with.blocked);
      msgsEl.innerHTML = "";
      state.seen.clear();
      if (!data.messages.length) {
        const hi = document.createElement("p");
        hi.className = "thread-hello";
        hi.textContent = `This is the start of your chat with @${data.with.username}. Say hi ⚡`;
        msgsEl.append(hi);
      }
      for (const m of data.messages) drawMessage(m);
      scrollToEnd();
      refreshUnread();
      if (!data.with.blocked) setTimeout(() => composeInput.focus(), 50);
    } catch (err) {
      if (err.status === 401) return loggedOut();
      if (state.view !== "list") await showList();
      showError($("#dmNewError"), err.message);
    }
  }

  function setBlockedUi(blocked) {
    state.open.blocked = blocked;
    blockBtn.textContent = blocked ? "Unblock" : "Block";
    blockBtn.classList.toggle("danger", !blocked);
    $("#compose").hidden = blocked;
    threadNote.hidden = !blocked;
    threadNote.textContent = blocked ? "You blocked this person. Unblock them to chat again." : "";
  }

  blockBtn.addEventListener("click", async () => {
    if (!state.open) return;
    const name = state.open.username;
    const blocking = !state.open.blocked;
    if (blocking && !confirm(`Block @${name}? They won't be able to message you.`)) return;
    try {
      await api("/block/" + encodeURIComponent(name), { method: blocking ? "POST" : "DELETE" });
      setBlockedUi(blocking);
      refreshUnread();
    } catch (err) {
      alert(err.message);
    }
  });

  function drawMessage(m) {
    if (state.seen.has(m.id)) return;
    state.seen.add(m.id);
    const hello = msgsEl.querySelector(".thread-hello");
    if (hello) hello.remove();

    const mine = m.from === state.me.username;
    const prev = msgsEl.lastElementChild;
    const grouped = prev && prev.dataset.from === m.from && m.at - Number(prev.dataset.at) < 5 * 60e3;

    const row = document.createElement("div");
    row.className = "msg " + (mine ? "mine" : "theirs") + (grouped ? " grouped" : "");
    row.dataset.from = m.from;
    row.dataset.at = m.at;
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = m.body;
    bubble.title = new Date(m.at).toLocaleString();
    row.append(bubble);
    if (!grouped) {
      const t = document.createElement("time");
      t.textContent = clock(m.at);
      row.prepend(t);
    }
    msgsEl.append(row);
  }

  function scrollToEnd() {
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  // Grow the box with the text, Enter sends, Shift+Enter makes a new line.
  composeInput.addEventListener("input", () => {
    composeInput.style.height = "auto";
    composeInput.style.height = Math.min(composeInput.scrollHeight, 140) + "px";
  });
  composeInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      $("#compose").requestSubmit();
    }
  });

  $("#compose").addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = composeInput.value.trim();
    if (!body || !state.open) return;
    composeInput.value = "";
    composeInput.style.height = "auto";
    try {
      const { message } = await api("/messages/" + encodeURIComponent(state.open.username), { body: { body } });
      drawMessage(message);
      scrollToEnd();
    } catch (err) {
      composeInput.value = body;
      threadNote.textContent = err.message;
      threadNote.hidden = false;
      setTimeout(() => { if (!state.open?.blocked) threadNote.hidden = true; }, 4000);
    }
  });

  async function refreshUnread() {
    try {
      const { unread } = await api("/me");
      setUnread(unread);
    } catch {}
  }

  /* ---------------- live updates ---------------- */

  function connect() {
    if (state.ws) return;
    const ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/chat");
    state.ws = ws;
    ws.onopen = () => { state.wsRetry = 0; };
    ws.onmessage = (e) => {
      let data;
      try { data = JSON.parse(e.data); } catch { return; }
      if (data.type === "message") onMessage(data.message);
    };
    ws.onclose = () => {
      state.ws = null;
      if (!state.me) return;
      const wait = Math.min(15000, 1000 * 2 ** state.wsRetry++);
      setTimeout(() => { if (state.me) { connect(); refreshUnread(); } }, wait);
    };
  }

  function onMessage(m) {
    const me = state.me?.username;
    if (!me) return;
    const other = m.from === me ? m.to : m.from;
    const fromThem = m.from !== me;

    if (isOpen() && state.view === "thread" && state.open?.username.toLowerCase() === other.toLowerCase()) {
      drawMessage(m);
      scrollToEnd();
      if (fromThem) api("/read/" + encodeURIComponent(other), { method: "POST" }).catch(() => {});
      return;
    }

    if (fromThem) {
      setUnread(state.unread + 1);
      if (!isOpen()) ping(m);
    }
    if (isOpen() && state.view === "list") showList();
  }

  /* ---------------- boot ---------------- */

  api("/me").then(
    ({ user, unread }) => signedIn(user, unread),
    () => show("auth")
  );
})();
