/* ==========================================================================
   THE PODIUM  —  app.js
   Draw a prompt (it rises under the spotlight), pick a mode, take prep time,
   run the clock, capture speech, hit your target words, grow a word bank.
   No server, no keys.
   ========================================================================== */

(function () {
  "use strict";

  const TOPICS = window.TOPICS || [];
  const VOCAB = window.VOCAB || [];
  const $ = (id) => document.getElementById(id);

  const el = {
    spotlight: $("spotlight"),
    greetText: $("greetText"), editName: $("editName"),
    modes: $("modes"), modeHint: $("modeHint"),
    typeFilter: $("typeFilter"), bankCount: $("bankCount"), catSelect: $("catSelect"),
    drawBtn: $("drawBtn"),
    stage: $("stage"), marquee: $("marquee"), catLabel: $("catLabel"), taskText: $("taskText"),
    durRow: $("durRow"), prepRow: $("prepRow"),
    timer: $("timer"), ringFill: $("ringFill"),
    timerDisplay: $("timerDisplay"), timerPhase: $("timerPhase"),
    startBtn: $("startBtn"), resetBtn: $("resetBtn"),
    vocabChallenge: $("vocabChallenge"), vcWords: $("vcWords"),
    recordBtn: $("recordBtn"), speakNote: $("speakNote"),
    metrics: $("metrics"), mWpm: $("mWpm"), mWords: $("mWords"), mFillers: $("mFillers"),
    transcriptWrap: $("transcriptWrap"), transcript: $("transcript"),
    brSummary: $("brSummary"), brPHeading: $("brPHeading"), brQHeading: $("brQHeading"),
    brPoints: $("brPoints"), brQuestions: $("brQuestions"),
    brCounter: $("brCounter"), briefing: $("briefing"),
    wbWord: $("wbWord"), wbPos: $("wbPos"), wbDef: $("wbDef"), wbEx: $("wbEx"),
    wbSave: $("wbSave"), anotherWord: $("anotherWord"),
    wbSaved: $("wbSaved"), wbCount: $("wbCount"), wbChips: $("wbChips"), wbClear: $("wbClear"),
    history: $("history"), histCount: $("histCount"), histStreak: $("histStreak"),
    histMinutes: $("histMinutes"), histList: $("histList"), clearHist: $("clearHist"),
    saveBtn: $("saveBtn"),
    rClarity: $("rClarity"), rStructure: $("rStructure"), rConfidence: $("rConfidence"), rDepth: $("rDepth")
  };

  const RING_LEN = 339.29;
  const DURATIONS = [1, 2, 3, 5];
  const PREPS = [["Off", 0], ["15s", 15], ["30s", 30], ["60s", 60]];
  const FILLERS = ["um", "uh", "er", "erm", "like", "you know", "sort of",
                   "kind of", "i mean", "basically", "actually", "literally", "so"];
  const DEFAULT_NAME = "Tatenda";
  const KEY_NAME = "podium.name";
  const KEY_HIST = "podium.history.v1";
  const KEY_VOCAB = "podium.vocab.v1";

  let mode = "cuff";
  let activeType = "all";
  let activeCategory = "All";
  let currentTopic = null;
  let targetSeconds = 60, remaining = 60, prepSeconds = 0;
  let phase = "idle";
  let ticking = null;
  let recognition = null, recording = false, recStart = 0, finalTranscript = "";
  let targetWords = [], featuredWord = null;

  const catVar = (cat) => "var(--cat-" + cat.split(" ")[0] + ")";
  const store = {
    get(k, fb) { try { const v = localStorage.getItem(k); return v === null ? fb : JSON.parse(v); } catch (e) { return fb; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };

  // ==== GREETING / NAME ==================================================
  function greetWord() { const h = new Date().getHours(); return h < 12 ? "Morning" : h < 18 ? "Afternoon" : "Evening"; }
  function renderGreeting() {
    const name = store.get(KEY_NAME, DEFAULT_NAME);
    el.greetText.textContent = name ? greetWord() + ", " + name + "." : "Step up.";
  }
  function editName() {
    const cur = store.get(KEY_NAME, DEFAULT_NAME);
    const next = prompt("What should the podium call you?", cur || "");
    if (next === null) return;
    store.set(KEY_NAME, next.trim()); renderGreeting();
  }

  // ==== MODES ===========================================================
  const MODE_HINT = {
    cuff: "Off the Cuff — short clock, briefing stays shut. Think on your feet.",
    research: "Deep Research — longer clock, briefing opens. Build the argument."
  };
  function setMode(m) {
    mode = m;
    Array.from(el.modes.children).forEach((b) => b.setAttribute("aria-pressed", b.dataset.mode === m ? "true" : "false"));
    el.modeHint.textContent = MODE_HINT[m];
    if (currentTopic) applyMode();
  }
  function applyMode() {
    if (mode === "cuff") { setDuration(1); buildDurRow(1); el.briefing.open = false; }
    else { const mins = Math.max(currentTopic.minutes, 3); setDuration(mins); buildDurRow(mins); el.briefing.open = true; }
  }

  // ==== TYPE + CATEGORY + BANK COUNT ====================================
  function setType(t) {
    activeType = t;
    Array.from(el.typeFilter.children).forEach((b) => b.setAttribute("aria-pressed", b.dataset.type === t ? "true" : "false"));
    renderBankCount();
  }
  function populateCatSelect() {
    const cats = ["All", ...Array.from(new Set(TOPICS.map((t) => t.category))).sort()];
    el.catSelect.innerHTML = "";
    cats.forEach((c) => { const o = document.createElement("option"); o.value = c; o.textContent = c; el.catSelect.appendChild(o); });
    el.catSelect.value = "All";
  }
  function renderBankCount() {
    const p = pool();
    const cn = p.filter((x) => x.type === "concept").length;
    const qn = p.filter((x) => x.type === "question").length;
    let label = activeType === "concept" ? cn + " concepts"
              : activeType === "question" ? qn + " questions"
              : cn + " concepts \u00B7 " + qn + " questions";
    el.bankCount.textContent = label + " in the bank \u00B7 " + VOCAB.length + " words to master";
  }

  // ==== DRAW + REVEAL ===================================================
  function pool() {
    return TOPICS.filter((t) =>
      (activeCategory === "All" || t.category === activeCategory) &&
      (activeType === "all" || t.type === activeType));
  }
  function draw() {
    const p = pool();
    if (!p.length) return;
    let chosen = p[Math.floor(Math.random() * p.length)];
    if (p.length > 1) { let g = 0; while (currentTopic && chosen.task === currentTopic.task && g < 20) { chosen = p[Math.floor(Math.random() * p.length)]; g++; } }
    currentTopic = chosen;
    render(chosen);
  }
  function render(t) {
    const isConcept = t.type === "concept";
    el.stage.hidden = false;
    el.stage.style.setProperty("--cat", catVar(t.category));
    el.catLabel.textContent = t.category + " \u00B7 " + (isConcept ? "Concept" : "Question");
    el.taskText.textContent = t.task;

    // replay the spotlight reveal
    el.marquee.classList.remove("show");
    void el.marquee.offsetWidth;
    el.marquee.classList.add("show");
    el.spotlight.classList.add("lit");

    applyMode();
    el.brSummary.textContent = t.summary;
    el.brPHeading.textContent = isConcept ? "Key ideas" : "Main points";
    el.brQHeading.textContent = isConcept ? "Angles to explore" : "Interrogate yourself";
    fillList(el.brPoints, t.points);
    fillList(el.brQuestions, t.questions);
    if (t.counter) { el.brCounter.hidden = false; el.brCounter.textContent = t.counter; }
    else { el.brCounter.hidden = true; }

    resetSpeech(); setTargetWords();
    [el.rClarity, el.rStructure, el.rConfidence, el.rDepth].forEach((s) => (s.value = 3));
    el.stage.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function fillList(ul, items) {
    ul.innerHTML = "";
    items.forEach((txt) => { const li = document.createElement("li"); li.textContent = txt; ul.appendChild(li); });
  }

  // ==== TIMER (two-phase: prep -> speak) ================================
  function buildDurRow(active) {
    el.durRow.innerHTML = "";
    DURATIONS.forEach((m) => {
      const b = document.createElement("button");
      b.className = "dur"; b.textContent = m + " min";
      b.setAttribute("aria-pressed", m === active ? "true" : "false");
      b.addEventListener("click", () => {
        setDuration(m);
        Array.from(el.durRow.children).forEach((c, i) => c.setAttribute("aria-pressed", DURATIONS[i] === m ? "true" : "false"));
      });
      el.durRow.appendChild(b);
    });
  }
  function buildPrepRow() {
    el.prepRow.innerHTML = "";
    const lab = document.createElement("span"); lab.className = "prep-label"; lab.textContent = "Prep"; el.prepRow.appendChild(lab);
    PREPS.forEach(([txt, secs]) => {
      const b = document.createElement("button");
      b.className = "dur"; b.textContent = txt;
      b.setAttribute("aria-pressed", secs === prepSeconds ? "true" : "false");
      b.addEventListener("click", () => {
        prepSeconds = secs;
        Array.from(el.prepRow.querySelectorAll(".dur")).forEach((c, i) => c.setAttribute("aria-pressed", PREPS[i][1] === secs ? "true" : "false"));
      });
      el.prepRow.appendChild(b);
    });
  }
  function timerBase() { return (phase === "prep" ? prepSeconds : targetSeconds) || 1; }
  function paintTimer() {
    const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
    const ss = String(remaining % 60).padStart(2, "0");
    el.timerDisplay.textContent = mm + ":" + ss;
    el.ringFill.style.strokeDashoffset = String(RING_LEN * (1 - remaining / timerBase()));
    el.timerPhase.textContent = phase === "prep" ? "PREP" : phase === "speak" ? "SPEAK" : phase === "done" ? "TIME" : "";
  }
  function setDuration(mins) {
    stopTimer(); targetSeconds = mins * 60; phase = "idle"; remaining = targetSeconds;
    el.timer.classList.remove("prep", "done"); el.startBtn.textContent = "Start"; paintTimer();
  }
  function onTick() {
    remaining--;
    if (remaining <= 0) {
      if (phase === "prep") { chime(); phase = "speak"; el.timer.classList.remove("prep"); remaining = targetSeconds; paintTimer(); return; }
      stopTimer(); phase = "done"; el.timer.classList.add("done"); el.startBtn.textContent = "Start"; chime(); paintTimer(); return;
    }
    paintTimer();
  }
  function runInterval() { ticking = setInterval(onTick, 1000); }
  function startTimer() {
    if (ticking) { stopTimer(); el.startBtn.textContent = "Start"; return; }
    if (phase === "idle" || phase === "done") {
      if (prepSeconds > 0) { phase = "prep"; el.timer.classList.add("prep"); el.timer.classList.remove("done"); remaining = prepSeconds; }
      else { phase = "speak"; el.timer.classList.remove("prep", "done"); remaining = targetSeconds; }
    }
    el.timer.classList.remove("done"); el.startBtn.textContent = "Pause"; paintTimer(); runInterval();
  }
  function startSpeakingTimer() {
    stopTimer(); phase = "speak"; el.timer.classList.remove("prep", "done");
    remaining = targetSeconds; el.startBtn.textContent = "Pause"; paintTimer(); runInterval();
  }
  function stopTimer() { if (ticking) { clearInterval(ticking); ticking = null; } }
  function chime() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      const ctx = new AC(); const o = ctx.createOscillator(); const g = ctx.createGain();
      o.frequency.value = 660; o.type = "sine"; o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.05);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.9);
      o.start(); o.stop(ctx.currentTime + 0.95);
    } catch (e) {}
  }

  // ==== VOCAB ===========================================================
  function pickWords(n) {
    const p = VOCAB.slice(); const out = [];
    while (out.length < n && p.length) out.push(p.splice(Math.floor(Math.random() * p.length), 1)[0]);
    return out;
  }
  function wordRoot(w) { const s = w.toLowerCase().replace(/[^a-z]/g, ""); return s.slice(0, Math.max(4, s.length - 3)); }
  function setTargetWords() {
    targetWords = pickWords(2);
    el.vcWords.innerHTML = "";
    targetWords.forEach((w) => {
      const span = document.createElement("span");
      span.className = "vc-word"; span.tabIndex = 0; span.dataset.word = w.word; span.textContent = w.word;
      const def = document.createElement("span"); def.className = "vc-def"; def.textContent = w.def;
      span.appendChild(def); el.vcWords.appendChild(span);
    });
    el.vocabChallenge.hidden = false;
  }
  function markWordsUsed(transcript) {
    const tokens = transcript.toLowerCase().replace(/[^a-z\s]/g, "").split(/\s+/).filter(Boolean);
    Array.from(el.vcWords.children).forEach((span) => {
      const used = tokens.some((tok) => tok.startsWith(wordRoot(span.dataset.word)));
      span.classList.add(used ? "used" : "missed");
    });
  }
  function showFeatured(word) {
    featuredWord = word || VOCAB[Math.floor(Math.random() * VOCAB.length)];
    el.wbWord.textContent = featuredWord.word; el.wbPos.textContent = featuredWord.pos;
    el.wbDef.textContent = featuredWord.def; el.wbEx.textContent = "\u201C" + featuredWord.ex + "\u201D";
    const saved = store.get(KEY_VOCAB, []).some((w) => w.word === featuredWord.word);
    el.wbSave.classList.toggle("saved", saved); el.wbSave.textContent = saved ? "Saved" : "Save";
  }
  function saveFeatured() {
    if (!featuredWord) return;
    const list = store.get(KEY_VOCAB, []);
    if (!list.some((w) => w.word === featuredWord.word)) { list.unshift({ word: featuredWord.word, def: featuredWord.def }); store.set(KEY_VOCAB, list); }
    showFeatured(featuredWord); renderSaved();
  }
  function renderSaved() {
    const list = store.get(KEY_VOCAB, []);
    el.wbSaved.hidden = list.length === 0; el.wbCount.textContent = list.length; el.wbChips.innerHTML = "";
    list.forEach((w) => {
      const c = document.createElement("button");
      c.className = "wb-chip"; c.title = w.def; c.innerHTML = w.word + " <span class=\"x\">\u00D7</span>";
      c.addEventListener("click", () => {
        store.set(KEY_VOCAB, store.get(KEY_VOCAB, []).filter((x) => x.word !== w.word));
        renderSaved(); if (featuredWord && featuredWord.word === w.word) showFeatured(featuredWord);
      });
      el.wbChips.appendChild(c);
    });
  }

  // ==== SPEECH ==========================================================
  function initSpeech() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { el.recordBtn.hidden = true; el.speakNote.textContent = "Speech capture needs Chrome or Edge. The timer still works everywhere."; return; }
    recognition = new SR(); recognition.continuous = true; recognition.interimResults = true; recognition.lang = "en-US";
    recognition.onresult = (ev) => {
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const chunk = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) finalTranscript += chunk + " "; else interim += chunk;
      }
      el.transcriptWrap.hidden = false; el.transcript.textContent = (finalTranscript + interim).trim();
    };
    recognition.onerror = (ev) => { el.speakNote.textContent = "Mic error: " + ev.error + " (needs https or localhost)."; stopRecording(); };
    recognition.onend = () => { if (recording) recognition.start(); };
  }
  function toggleRecording() { if (!recognition) return; recording ? stopRecording() : startRecording(); }
  function startRecording() {
    finalTranscript = ""; el.transcript.textContent = ""; el.metrics.hidden = true;
    Array.from(el.vcWords.children).forEach((s) => s.classList.remove("used", "missed"));
    recording = true; recStart = Date.now();
    el.recordBtn.classList.add("on"); el.recordBtn.textContent = "Stop and score";
    el.speakNote.textContent = "Listening... speak naturally.";
    try { recognition.start(); } catch (e) {}
    if (!ticking || phase !== "speak") startSpeakingTimer();
  }
  function stopRecording() {
    recording = false; el.recordBtn.classList.remove("on"); el.recordBtn.textContent = "Record my answer";
    try { recognition && recognition.stop(); } catch (e) {}
    stopTimer(); el.startBtn.textContent = "Start"; scoreSpeech();
  }
  function scoreSpeech() {
    const text = finalTranscript.trim();
    if (!text) { el.speakNote.textContent = "Didn't catch anything that time."; return; }
    const secs = Math.max(1, Math.round((Date.now() - recStart) / 1000));
    const words = text.split(/\s+/).filter(Boolean);
    const wpm = Math.round((words.length / secs) * 60);
    const lower = " " + text.toLowerCase().replace(/[.,!?;:]/g, "") + " ";
    let fillers = 0;
    FILLERS.forEach((f) => { const m = lower.match(new RegExp("\\s" + f.replace(/ /g, "\\s") + "\\s", "g")); if (m) fillers += m.length; });
    el.mWpm.textContent = wpm; el.mWords.textContent = words.length; el.mFillers.textContent = fillers; el.metrics.hidden = false;
    markWordsUsed(text);
    const usedCount = el.vcWords.querySelectorAll(".vc-word.used").length;
    const pace = wpm < 110 ? "a touch slow" : wpm > 170 ? "a bit fast" : "a good pace";
    el.speakNote.textContent = pace + " (" + wpm + " wpm) \u00B7 used " + usedCount + "/" + targetWords.length + " target words.";
  }
  function resetSpeech() {
    stopRecording(); finalTranscript = "";
    el.metrics.hidden = true; el.transcriptWrap.hidden = true; el.transcript.textContent = "";
    if (recognition) el.speakNote.textContent = ""; recording = false;
  }

  // ==== HISTORY =========================================================
  function logSession() {
    if (!currentTopic) return;
    const entry = {
      date: new Date().toISOString(), category: currentTopic.category, task: currentTopic.task, minutes: targetSeconds / 60,
      wpm: el.metrics.hidden ? null : Number(el.mWpm.textContent),
      fillers: el.metrics.hidden ? null : Number(el.mFillers.textContent),
      ratings: { clarity: +el.rClarity.value, structure: +el.rStructure.value, confidence: +el.rConfidence.value, depth: +el.rDepth.value }
    };
    const list = store.get(KEY_HIST, []); list.unshift(entry); store.set(KEY_HIST, list); renderHistory();
    el.saveBtn.textContent = "Logged \u2713"; setTimeout(() => (el.saveBtn.textContent = "Log this session"), 1400);
  }
  function iso(d) { return d.toISOString().slice(0, 10); }
  function streak(list) {
    if (!list.length) return 0;
    const days = new Set(list.map((e) => e.date.slice(0, 10)));
    let count = 0; const d = new Date();
    if (!days.has(iso(d))) { d.setDate(d.getDate() - 1); if (!days.has(iso(d))) return 0; }
    while (days.has(iso(d))) { count++; d.setDate(d.getDate() - 1); }
    return count;
  }
  function renderHistory() {
    const list = store.get(KEY_HIST, []);
    el.history.hidden = list.length === 0;
    el.histCount.textContent = list.length;
    el.histStreak.textContent = streak(list);
    el.histMinutes.textContent = list.reduce((s, e) => s + (e.minutes || 0), 0);
    el.histList.innerHTML = "";
    list.slice(0, 8).forEach((e) => {
      const li = document.createElement("li");
      const task = document.createElement("span"); task.className = "hl-task"; task.textContent = e.task;
      const meta = document.createElement("span"); meta.className = "hl-meta";
      meta.textContent = new Date(e.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }) + (e.wpm ? " \u00B7 " + e.wpm + "wpm" : "");
      li.appendChild(task); li.appendChild(meta); el.histList.appendChild(li);
    });
  }
  function clearHistory() { if (!confirm("Clear all logged sessions on this device?")) return; store.set(KEY_HIST, []); renderHistory(); }

  // ==== WIRE UP =========================================================
  function init() {
    renderGreeting(); populateCatSelect(); buildPrepRow(); initSpeech();
    showFeatured(); renderSaved(); renderHistory();
    setMode("cuff"); setType("all");

    el.editName.addEventListener("click", editName);
    Array.from(el.modes.children).forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
    Array.from(el.typeFilter.children).forEach((b) => b.addEventListener("click", () => setType(b.dataset.type)));
    el.catSelect.addEventListener("change", () => { activeCategory = el.catSelect.value; renderBankCount(); });
    el.drawBtn.addEventListener("click", draw);
    el.startBtn.addEventListener("click", startTimer);
    el.resetBtn.addEventListener("click", () => setDuration(targetSeconds / 60));
    el.recordBtn.addEventListener("click", toggleRecording);
    el.saveBtn.addEventListener("click", logSession);
    el.clearHist.addEventListener("click", clearHistory);
    el.wbSave.addEventListener("click", saveFeatured);
    el.anotherWord.addEventListener("click", () => showFeatured());
    el.wbClear.addEventListener("click", () => { if (confirm("Clear your saved words?")) { store.set(KEY_VOCAB, []); renderSaved(); showFeatured(featuredWord); } });

    document.addEventListener("keydown", (e) => { if (e.code === "Space" && e.target === document.body) { e.preventDefault(); draw(); } });
  }
  document.addEventListener("DOMContentLoaded", init);
})();
