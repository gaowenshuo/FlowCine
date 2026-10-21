/* Browser-only interactions. No runtime services, packages, or build step. */
(() => {
  'use strict';
  const data = window.FLOWCINE;
  if (!data) return;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const players = new Set();
  const formatTime = value => {
    const time = Number.isFinite(value) ? Math.max(0, value) : 0;
    return `${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, '0')}`;
  };

  class Comparison {
    constructor(host, options = {}) {
      this.options = options;
      this.intent = Boolean(options.autoplay) && !reducedMotion.matches;
      this.visible = false;
      this.loaded = false;
      this.playing = false;
      this.wipeEnabled = true;
      this.frame = 0;
      this.version = 0;
      host.innerHTML = `<div class="comparison">
        <div class="wipe-stage" tabindex="0" role="slider" aria-label="Original and edited video comparison" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50">
          <video class="edited-video" muted playsinline loop preload="none" aria-hidden="true"></video>
          <div class="source-layer"><video class="source-video" muted playsinline loop preload="none" aria-hidden="true"></video></div>
          <span class="wipe-label wipe-label-source">Original</span><span class="wipe-label wipe-label-edited">FlowCine</span>
          <span class="wipe-divider" aria-hidden="true"><span class="wipe-grip">‹ ›</span></span>
          <span class="wipe-hint" aria-hidden="true">Drag to compare <span>↔</span></span>
          <p class="video-error" role="status">This video could not load. Please try the example again.</p>
        </div>
        <div class="comparison-toolbar">
          <button class="icon-button toggle-play" aria-label="Play comparison">▶</button>
          <button class="icon-button restart" aria-label="Restart comparison">↺</button>
          <input class="timeline" type="range" min="0" max="1000" value="0" aria-label="Video playback position">
          <span class="time-display">0:00 / 0:00</span><span class="toolbar-hint">Drag the divider · ← →</span>
          <button class="reset-wipe" aria-label="Reset comparison to fifty-fifty">50 / 50</button>
        </div>
      </div>`;
      this.root = $('.comparison', host);
      this.stage = $('.wipe-stage', host);
      this.source = $('.source-video', host);
      this.edited = $('.edited-video', host);
      this.timeline = $('.timeline', host);
      this.playButton = $('.toggle-play', host);
      this.timeDisplay = $('.time-display', host);
      this.labelSource = $('.wipe-label-source', host);
      this.labelEdited = $('.wipe-label-edited', host);
      this.error = $('.video-error', host);
      for (const video of [this.source, this.edited]) {
        video.muted = true;
        video.addEventListener('loadedmetadata', () => this.updateTime());
        video.addEventListener('canplay', () => this.maybePlay());
        video.addEventListener('error', () => {
          if (video.getAttribute('src')) {
            this.error.classList.add('visible');
            this.suspend();
          }
        });
      }
      this.edited.addEventListener('seeked', () => this.updateTime());
      this.edited.addEventListener('timeupdate', () => this.updateTime());
      this.playButton.addEventListener('click', () => this.toggle());
      $('.restart', host).addEventListener('click', () => this.seek(0));
      $('.reset-wipe', host).addEventListener('click', () => this.setSplit(50));
      this.timeline.addEventListener('input', () => this.seek(Number(this.timeline.value) / 1000));
      this.stage.addEventListener('pointerdown', event => {
        if (!this.wipeEnabled || (event.pointerType === 'mouse' && event.button !== 0)) return;
        this.stage.setPointerCapture(event.pointerId);
        this.dragging = event.pointerId;
        this.stage.classList.add('interacted');
        this.wipeFromPointer(event);
      });
      this.stage.addEventListener('pointermove', event => {
        if (this.dragging === event.pointerId) this.wipeFromPointer(event);
      });
      const finish = () => { this.dragging = null; };
      this.stage.addEventListener('pointerup', finish);
      this.stage.addEventListener('pointercancel', finish);
      this.stage.addEventListener('lostpointercapture', finish);
      this.stage.addEventListener('keydown', event => {
        if (!this.wipeEnabled || event.target !== this.stage) return;
        const change = event.shiftKey ? 10 : 2;
        const values = { ArrowLeft: this.split - change, ArrowRight: this.split + change, Home: 0, End: 100 };
        if (event.key in values) {
          event.preventDefault();
          this.setSplit(values[event.key]);
          this.stage.classList.add('interacted');
        } else if (event.code === 'Space') {
          event.preventDefault();
          this.toggle();
        }
      });
      this.observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
          this.visible = entry.isIntersecting;
          if (this.visible) { this.prepare(); this.maybePlay(); }
          else this.suspend();
        }
      }, { threshold: 0.08 });
      this.observer.observe(this.stage);
      this.setSplit(50);
      players.add(this);
    }
    setClips(source, edited, { posterSource, posterEdited, labelSource = 'Original', labelEdited = 'FlowCine', reset = true } = {}) {
      this.version++;
      this.suspend();
      this.loaded = false;
      this.starting = false;
      this.urls = [source, edited];
      this.error.classList.remove('visible');
      for (const [video, poster] of [[this.source, posterSource], [this.edited, posterEdited]]) {
        video.removeAttribute('src');
        video.load();
        if (poster) video.poster = poster;
      }
      this.labelSource.textContent = labelSource;
      this.labelEdited.textContent = labelEdited;
      this.stage.setAttribute('aria-label', `${labelSource} and ${labelEdited} video comparison`);
      this.timeline.value = '0';
      this.timeDisplay.textContent = '0:00 / 0:00';
      if (reset) this.setSplit(50);
      if (this.visible) this.prepare();
      this.updatePlayButton();
    }
    prepare() {
      if (this.loaded || !this.urls) return;
      this.loaded = true;
      [this.source, this.edited].forEach((video, index) => {
        video.src = this.urls[index];
        video.preload = 'auto';
        video.load();
      });
    }
    maybePlay() {
      if (!this.intent || !this.visible || document.hidden || this.starting || this.playing) return;
      if (!this.loaded || this.source.readyState < 2 || this.edited.readyState < 2) return;
      const version = this.version;
      this.starting = true;
      this.align();
      Promise.all([this.source.play(), this.edited.play()]).then(() => {
        if (version !== this.version) return;
        this.starting = false;
        if (!this.intent || !this.visible || document.hidden) { this.suspend(); return; }
        this.playing = true;
        this.updatePlayButton();
        this.tick();
      }).catch(() => {
        if (version !== this.version) return;
        this.starting = false;
        this.suspend();
      });
    }
    play() { this.intent = true; this.prepare(); this.maybePlay(); this.updatePlayButton(); }
    pause() { this.intent = false; this.suspend(); }
    toggle() { this.playing || this.starting ? this.pause() : this.play(); }
    suspend() {
      this.source.pause(); this.edited.pause();
      this.playing = false;
      cancelAnimationFrame(this.frame);
      this.frame = 0;
      this.updatePlayButton();
    }
    align() {
      if (this.syncClock?.playing && this.syncClock.edited.duration > 0 && this.edited.duration > 0) {
        const target = this.syncClock.edited.currentTime / this.syncClock.edited.duration * this.edited.duration;
        if (Math.abs(this.edited.currentTime - target) > 0.07 && !this.edited.seeking) this.edited.currentTime = target;
      }
      if (!(this.edited.duration > 0 && this.source.duration > 0)) return;
      const desired = (this.edited.currentTime / this.edited.duration) * this.source.duration;
      if (Math.abs(this.source.currentTime - desired) > 0.07 && !this.source.seeking) this.source.currentTime = desired;
    }
    tick() {
      if (!this.playing) return;
      this.align();
      this.updateTime();
      this.frame = requestAnimationFrame(() => this.tick());
    }
    updateTime() {
      const duration = Number.isFinite(this.edited.duration) ? this.edited.duration : 0;
      if (duration > 0) this.timeline.value = String(Math.round(this.edited.currentTime / duration * 1000));
      this.timeDisplay.textContent = `${formatTime(this.edited.currentTime)} / ${formatTime(duration)}`;
      this.timeline.setAttribute('aria-valuetext', `${formatTime(this.edited.currentTime)} of ${formatTime(duration)}`);
    }
    seek(fraction) {
      this.prepare();
      const value = Math.min(0.999, Math.max(0, fraction));
      for (const video of [this.source, this.edited]) {
        if (Number.isFinite(video.duration) && video.duration > 0) video.currentTime = value * video.duration;
      }
      this.updateTime();
    }
    updatePlayButton() {
      this.playButton.textContent = this.playing ? 'Ⅱ' : '▶';
      this.playButton.setAttribute('aria-label', this.playing ? 'Pause comparison' : 'Play comparison');
      this.playButton.setAttribute('aria-pressed', String(this.playing));
    }
    wipeFromPointer(event) {
      const bounds = this.stage.getBoundingClientRect();
      this.setSplit((event.clientX - bounds.left) / bounds.width * 100);
    }
    setSplit(value) {
      this.split = Math.max(0, Math.min(100, value));
      this.stage.style.setProperty('--split', `${this.split}%`);
      this.stage.setAttribute('aria-valuenow', String(Math.round(this.split)));
      this.stage.setAttribute('aria-valuetext', `${Math.round(this.split)}% ${this.labelSource.textContent}, ${Math.round(100 - this.split)}% ${this.labelEdited.textContent}`);
      this.root.classList.toggle('is-full-source', this.split >= 99.5);
      this.root.classList.toggle('is-full-edited', this.split <= 0.5);
    }
    setWipeEnabled(enabled) {
      this.wipeEnabled = enabled;
      this.stage.tabIndex = enabled ? 0 : -1;
      this.stage.setAttribute('aria-disabled', String(!enabled));
    }
  }

  const makeReference = (reference, compact = false) => {
    const figure = document.createElement('figure');
    figure.className = 'reference-item';
    const button = document.createElement('button');
    button.className = 'zoomable';
    button.dataset.image = reference.image;
    button.dataset.caption = `${reference.label} reference supplied to guide the edit.`;
    button.setAttribute('aria-label', `Enlarge ${reference.label.toLowerCase()} reference`);
    const img = document.createElement('img');
    img.src = reference.image; img.alt = `${reference.label} reference image`; img.loading = 'lazy';
    img.width = compact ? 68 : 90; img.height = compact ? 52 : 66;
    button.append(img);
    const caption = document.createElement('figcaption'); caption.textContent = reference.label;
    figure.append(button, caption);
    return figure;
  };

  const installTabKeyboard = root => root.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabs = $$('[role="tab"]', root);
    const index = tabs.indexOf(document.activeElement);
    if (index < 0) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next].click(); tabs[next].focus();
  });

  // Continuous, draggable thumbnail belts. Only the original controls enter the tab order.
  const conveyors = new Map();
  function mountConveyor(root) {
    conveyors.get(root)?.destroy();
    const items = [...root.children];
    if (!items.length) return;
    let shell = root.parentElement;
    if (!shell.classList.contains('conveyor-shell')) {
      shell = document.createElement('div'); shell.className = 'conveyor-shell';
      root.before(shell); shell.append(root);
    }
    shell.querySelector('.conveyor-toggle')?.remove();
    const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'conveyor-toggle';
    shell.append(toggle);
    root.classList.add('conveyor');
    const track = document.createElement('div'); track.className = 'conveyor-track';
    items.forEach(item => { item.classList.add('conveyor-item'); track.append(item); });
    root.replaceChildren(track);
    const events = new AbortController();
    const signal = events.signal;
    let period = 0, frame = 0, lastTime = 0, carry = 0, visible = false;
    let hover = false, focused = false, pointer = null, lastX = 0, dragged = false;
    let userPaused = reducedMotion.matches, cooldown = 0, clones = [];
    const sync = () => {
      for (const clone of clones) {
        const original = items[Number(clone.dataset.conveyorClone)];
        clone.dataset.active = String(original.getAttribute('aria-selected') === 'true' || original.getAttribute('aria-pressed') === 'true');
      }
    };
    const setToggle = () => {
      const paused = userPaused;
      toggle.textContent = paused ? '▶' : 'Ⅱ';
      toggle.setAttribute('aria-label', paused ? 'Start scrolling examples' : 'Pause scrolling examples');
      toggle.setAttribute('aria-pressed', String(!paused));
    };
    const wrap = () => {
      if (!period || focused) return;
      if (root.scrollLeft < period * .5) root.scrollLeft += period;
      else if (root.scrollLeft >= period * 1.5) root.scrollLeft -= period;
    };
    const layout = () => {
      const phase = period ? ((root.scrollLeft % period) + period) % period / period : 0;
      clones.forEach(clone => clone.remove()); clones = [];
      const first = items[0].getBoundingClientRect(), last = items.at(-1).getBoundingClientRect();
      period = last.right - first.left + 10;
      if (!(period > 0)) return;
      const copies = Math.max(3, Math.ceil(root.clientWidth / period) + 3);
      for (let group = 1; group < copies; group++) for (const [index, item] of items.entries()) {
        const clone = document.createElement('div');
        clone.className = item.className;
        clone.innerHTML = item.innerHTML;
        clone.dataset.conveyorClone = String(index);
        clone.setAttribute('aria-hidden', 'true');
        clone.setAttribute('role', 'presentation');
        track.append(clone); clones.push(clone);
      }
      sync(); root.scrollLeft = period * (1 + phase);
    };
    const tick = time => {
      const dt = lastTime ? Math.min(50, time - lastTime) : 0; lastTime = time;
      if (visible && !document.hidden && !userPaused && !hover && !focused && pointer === null && time > cooldown) {
        carry += dt * .024;
        if (carry >= 1) { const step = Math.floor(carry); root.scrollLeft += step; carry -= step; wrap(); }
      }
      frame = requestAnimationFrame(tick);
    };
    root.addEventListener('pointerenter', event => { if (event.pointerType === 'mouse') hover = true; }, { signal });
    root.addEventListener('pointerleave', () => { hover = false; }, { signal });
    root.addEventListener('focusin', event => {
      focused = true;
      if (items.includes(event.target)) event.target.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'instant' });
    }, { signal });
    root.addEventListener('focusout', () => { focused = root.contains(document.activeElement); queueMicrotask(() => { focused = root.contains(document.activeElement); }); }, { signal });
    root.addEventListener('scroll', wrap, { passive: true, signal });
    root.addEventListener('wheel', event => {
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY) || event.shiftKey) {
        event.preventDefault(); root.scrollLeft += event.deltaX || event.deltaY; cooldown = performance.now() + 1600; wrap();
      }
    }, { passive: false, signal });
    root.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      pointer = event.pointerId; lastX = event.clientX; dragged = false;
    }, { signal });
    root.addEventListener('pointermove', event => {
      if (pointer !== event.pointerId) return;
      const dx = lastX - event.clientX;
      if (!dragged && Math.abs(dx) < 4) return;
      dragged = true; root.setPointerCapture(event.pointerId); root.classList.add('is-dragging');
      root.scrollLeft += dx; lastX = event.clientX; wrap();
    }, { signal });
    const finish = () => { pointer = null; root.classList.remove('is-dragging'); cooldown = performance.now() + 1200; };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) root.addEventListener(type, finish, { signal });
    root.addEventListener('click', event => {
      if (dragged) { event.preventDefault(); event.stopImmediatePropagation(); dragged = false; return; }
      const clone = event.target.closest('[data-conveyor-clone]');
      if (clone) { event.preventDefault(); items[Number(clone.dataset.conveyorClone)].click(); }
    }, { capture: true, signal });
    toggle.addEventListener('click', () => {
      userPaused = !userPaused;
      setToggle();
    }, { signal });
    reducedMotion.addEventListener('change', event => { if (event.matches) userPaused = true; setToggle(); }, { signal });
    const observer = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; }, { threshold: 0 });
    observer.observe(root);
    const resize = new ResizeObserver(layout); resize.observe(root);
    const selection = new MutationObserver(sync);
    items.forEach(item => selection.observe(item, { attributes: true, attributeFilter: ['aria-selected', 'aria-pressed'] }));
    const controller = { sync, destroy() { events.abort(); observer.disconnect(); resize.disconnect(); selection.disconnect(); cancelAnimationFrame(frame); toggle.remove(); } };
    conveyors.set(root, controller); setToggle(); layout();
    document.fonts?.ready.then(() => { if (!signal.aborted) layout(); });
    frame = requestAnimationFrame(tick);
  }

  // Primary result explorer.
  const mainPlayer = new Comparison($('#main-comparison'), { autoplay: true });
  $('#main-comparison').setAttribute('role', 'tabpanel');
  for (const example of data.cases) {
    const button = document.createElement('button');
    button.className = 'example-tab'; button.type = 'button'; button.role = 'tab';
    button.id = `example-${example.id}`; button.dataset.case = example.id;
    button.setAttribute('aria-controls', 'main-comparison');
    button.setAttribute('aria-selected', 'false'); button.tabIndex = -1;
    const image = document.createElement('img'); image.src = example.posterEdited;
    image.alt = ''; image.width = 44; image.height = 33;
    const label = document.createElement('span'); label.textContent = example.title;
    const dot = document.createElement('span'); dot.className = 'tab-dot'; dot.ariaHidden = 'true';
    button.append(image, label, dot);
    button.addEventListener('click', () => selectExample(example));
    $('#example-tabs').append(button);
  }
  $('#video-case-count').textContent = `(${data.cases.length})`;
  mountConveyor($('#example-tabs'));
  function selectExample(example) {
    for (const tab of $$('.example-tab:not([data-conveyor-clone])')) {
      const active = tab.dataset.case === example.id;
      tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
    }
    $('#main-comparison').setAttribute('aria-labelledby', `example-${example.id}`);
    mainPlayer.setClips(example.source, example.edited, example);
    $('#edit-category').textContent = example.category;
    $('#edit-title').textContent = example.title;
    $('#edit-summary').textContent = example.summary;
    $('#edit-instruction').textContent = example.instruction;
    $('.instruction').open = false;
    const dock = $('#reference-dock'); dock.replaceChildren();
    if (example.refs.length) example.refs.forEach(ref => dock.append(makeReference(ref)));
    else {
      const note = document.createElement('p'); note.className = 'prompt-only';
      note.append(document.createTextNode('Words into worlds.'));
      const sub = document.createElement('em'); sub.textContent = 'Guided by the edit instruction'; note.append(sub);
      dock.append(note);
    }
  }
  installTabKeyboard($('#example-tabs'));
  selectExample(data.cases[0]);

  // Real regional control maps from the paper.
  for (const control of data.controls) {
    const figure = document.createElement('figure');
    const button = document.createElement('button'); button.className = 'zoomable';
    button.dataset.image = control.image; button.dataset.caption = control.label;
    button.setAttribute('aria-label', `Enlarge ${control.label.toLowerCase()}`);
    const img = document.createElement('img'); img.src = control.image; img.alt = control.label; img.loading = 'lazy'; img.width = 960; img.height = 544;
    const caption = document.createElement('figcaption'); caption.textContent = control.label;
    button.append(img); figure.append(button, caption); $('#control-frames').append(figure);
  }

  // Shared conditions across the four shots retained in the manuscript.
  data.seriesRefs.forEach(ref => $('#shared-refs').append(makeReference(ref, true)));
  const shotPlayers = data.shots.map(shot => {
    const host = document.createElement('div'); $('#shot-grid').append(host);
    const player = new Comparison(host);
    player.setClips(shot.source, shot.edited, shot);
    player.setSplit(0); player.setWipeEnabled(false);
    return player;
  });
  $('#shot-mode').addEventListener('click', event => {
    const button = event.target.closest('[data-mode]'); if (!button) return;
    for (const option of $$('button', $('#shot-mode'))) option.setAttribute('aria-pressed', String(option === button));
    const mode = button.dataset.mode;
    shotPlayers.forEach(player => {
      player.setSplit(mode === 'source' ? 100 : mode === 'edited' ? 0 : 50);
      player.setWipeEnabled(mode === 'split');
    });
  });
  let shotsPlaying = false;
  $('#play-shots').addEventListener('click', () => {
    shotsPlaying = !shotsPlaying;
    shotPlayers.forEach(player => shotsPlaying ? player.play() : player.pause());
    const button = $('#play-shots');
    button.innerHTML = `<span class="play-symbol" aria-hidden="true">${shotsPlaying ? 'Ⅱ' : '▶'}</span> ${shotsPlaying ? 'Pause all' : 'Play all'}`;
    button.setAttribute('aria-pressed', String(shotsPlaying));
  });

  // Two pre-rendered 3D orbits share one phase and one set of controls.
  const orbit = $('#orbit-video');
  const orbitSource = $('#orbit-source-video');
  const orbitVideos = [orbitSource, orbit];
  const orbitStage = $('#orbit-stage');
  const orbitRange = $('#orbit-range');
  const orbitToggle = $('#orbit-toggle');
  let nativeExample = data.native[0], nativeVariant = nativeExample.variants[0];
  let orbitVisible = false, orbitLoaded = false, orbitIntent = !reducedMotion.matches;
  let orbitPointer = null, orbitStartX = 0, orbitStartPhase = 0, orbitFrame = 0;
  let orbitPhase = 0, orbitVersion = 0, orbitStarting = false;
  const pauseOrbits = () => { orbitVideos.forEach(video => video.pause()); cancelAnimationFrame(orbitFrame); };
  const updateOrbit = () => {
    if (orbit.duration > 0) orbitPhase = orbit.currentTime / orbit.duration;
    const angle = Math.round(orbitPhase * 360);
    orbitRange.value = String(Math.round(orbitPhase * 1000));
    $('#orbit-angle').textContent = `${angle}°`;
    orbitStage.setAttribute('aria-valuenow', String(angle));
    orbitStage.setAttribute('aria-valuetext', `${nativeExample.title}, input and output at ${angle} degrees`);
  };
  function syncOrbits(force = false) {
    if (!(orbit.duration > 0 && orbitSource.duration > 0)) return;
    const desired = orbit.currentTime / orbit.duration * orbitSource.duration;
    if ((force || Math.abs(orbitSource.currentTime - desired) > 0.04) && !orbitSource.seeking) orbitSource.currentTime = desired;
  }
  const orbitTick = () => { syncOrbits(); updateOrbit(); if (!orbit.paused) orbitFrame = requestAnimationFrame(orbitTick); };
  function updateOrbitButton() {
    orbitToggle.textContent = orbitIntent ? 'Pause rotation' : 'Auto-rotate';
    orbitToggle.setAttribute('aria-pressed', String(orbitIntent));
  }
  function prepareOrbit() {
    if (orbitLoaded) return;
    orbitLoaded = true;
    orbitSource.src = nativeExample.sourceVideo; orbit.src = nativeVariant.video;
    orbitVideos.forEach(video => { video.preload = 'auto'; video.load(); });
  }
  function maybePlayOrbit() {
    if (!orbitIntent || !orbitVisible || document.hidden || orbitStarting || orbitVideos.some(video => video.readyState < 2)) return;
    if (orbitVideos.every(video => !video.paused)) return;
    const version = orbitVersion; orbitStarting = true; syncOrbits(true);
    Promise.all(orbitVideos.map(video => video.play())).then(() => {
      if (version !== orbitVersion) return;
      orbitStarting = false;
      if (!orbitIntent || !orbitVisible || document.hidden) { pauseOrbits(); return; }
      cancelAnimationFrame(orbitFrame); orbitTick();
    }).catch(() => {
      if (version !== orbitVersion) return;
      orbitStarting = false; orbitIntent = false; pauseOrbits(); updateOrbitButton();
    });
  }
  function loadOrbitPair() {
    orbitVersion++; pauseOrbits(); orbitLoaded = false; orbitStarting = false; orbitPhase = 0;
    for (const video of orbitVideos) { video.removeAttribute('src'); video.load(); }
    orbitSource.poster = nativeExample.posterSource; orbit.poster = nativeVariant.poster;
    $('#orbit-result-label').textContent = nativeVariant.label;
    $('#orbit-error').hidden = true; updateOrbit();
    if (orbitVisible) prepareOrbit();
  }
  function selectAsset(asset) {
    nativeExample = asset; nativeVariant = asset.variants[0];
    $('#orbit-panel').setAttribute('aria-labelledby', `asset-${asset.id}`);
    $('#native-source').src = asset.source; $('#native-reference').src = asset.reference;
    $('#native-source-button').dataset.image = asset.source;
    $('#native-source-button').dataset.caption = `${asset.title}: source native 3D asset.`;
    $('#native-reference-button').dataset.image = asset.reference;
    $('#native-reference-button').dataset.caption = `${asset.title}: supplied clothing reference.`;
    const picker = $('#native-variant-options'); conveyors.get(picker)?.destroy(); conveyors.delete(picker); picker.replaceChildren();
    picker.closest('.native-variant-picker').hidden = asset.variants.length < 2;
    for (const variant of asset.variants) {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.variant = variant.id;
      button.textContent = variant.label; button.setAttribute('aria-pressed', String(variant === nativeVariant));
      button.addEventListener('click', () => {
        nativeVariant = variant;
        for (const option of $$('button', picker)) option.setAttribute('aria-pressed', String(option === button));
        loadOrbitPair();
      }); picker.append(button);
    }
    if (asset.variants.length > 1) mountConveyor(picker);
    for (const tab of $$('button', $('#asset-tabs'))) {
      const active = tab.dataset.asset === asset.id;
      tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
    }
    loadOrbitPair();
  }
  for (const asset of data.native) {
    const button = document.createElement('button'); button.type = 'button'; button.role = 'tab';
    button.dataset.asset = asset.id;
    const image = document.createElement('img'); image.src = asset.poster; image.alt = ''; image.width = 32; image.height = 44;
    const label = document.createElement('span'); label.textContent = asset.title; button.append(image, label);
    button.id = `asset-${asset.id}`; button.setAttribute('aria-controls', 'orbit-panel');
    button.addEventListener('click', () => selectAsset(asset)); $('#asset-tabs').append(button);
  }
  $('.orbit-card').id = 'orbit-panel'; $('.orbit-card').setAttribute('role', 'tabpanel');
  mountConveyor($('#asset-tabs'));
  installTabKeyboard($('#asset-tabs'));
  selectAsset(nativeExample); updateOrbitButton();
  const orbitObserver = new IntersectionObserver(entries => {
    orbitVisible = entries[0].isIntersecting;
    if (orbitVisible) { prepareOrbit(); maybePlayOrbit(); }
    else pauseOrbits();
  }, { threshold: 0.12 });
  orbitObserver.observe(orbitStage);
  for (const video of orbitVideos) {
    video.addEventListener('canplay', maybePlayOrbit);
    video.addEventListener('loadedmetadata', () => {
      if (video.duration > 0) video.currentTime = Math.min(0.999, orbitPhase) * video.duration;
    });
    video.addEventListener('error', () => {
      if (video.getAttribute('src')) { $('#orbit-error').hidden = false; pauseOrbits(); }
    });
  }
  orbit.addEventListener('timeupdate', updateOrbit);
  orbit.addEventListener('seeked', () => { syncOrbits(true); updateOrbit(); });
  function seekOrbit(fraction) {
    orbitIntent = false; pauseOrbits(); updateOrbitButton(); prepareOrbit();
    orbitPhase = Math.min(0.999, Math.max(0, fraction));
    for (const video of orbitVideos) if (video.duration > 0) video.currentTime = orbitPhase * video.duration;
    orbitRange.value = String(Math.round(orbitPhase * 1000));
    $('#orbit-angle').textContent = `${Math.round(orbitPhase * 360)}°`;
    orbitStage.setAttribute('aria-valuenow', String(Math.round(orbitPhase * 360)));
    orbitStage.setAttribute('aria-valuetext', `${nativeExample.title}, input and output at ${Math.round(orbitPhase * 360)} degrees`);
  }
  orbitToggle.addEventListener('click', () => {
    orbitIntent = !orbitIntent; updateOrbitButton();
    if (orbitIntent) { prepareOrbit(); maybePlayOrbit(); } else pauseOrbits();
  });
  orbitRange.addEventListener('input', () => seekOrbit(Number(orbitRange.value) / 1000));
  orbitStage.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    orbitPointer = event.pointerId; orbitStartX = event.clientX; orbitStartPhase = orbitPhase;
    orbitStage.setPointerCapture(event.pointerId); seekOrbit(orbitStartPhase);
  });
  orbitStage.addEventListener('pointermove', event => {
    if (orbitPointer !== event.pointerId) return;
    const delta = (event.clientX - orbitStartX) / orbitStage.clientWidth;
    seekOrbit((orbitStartPhase + delta + 2) % 1);
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) orbitStage.addEventListener(name, () => { orbitPointer = null; });
  orbitStage.addEventListener('keydown', event => {
    const values = { ArrowLeft: Math.max(0, orbitPhase - 1 / 48), ArrowRight: Math.min(0.999, orbitPhase + 1 / 48), Home: 0, End: 0.999 };
    if (event.key in values) { event.preventDefault(); seekOrbit(values[event.key]); }
  });

  // Every paper comparison/ablation has a case selector and its complete variant set.
  const analysisPlayer = new Comparison($('#analysis-comparison'), { autoplay: true });
  const analysisReference = new Comparison($('#analysis-reference'), { autoplay: true });
  analysisPlayer.syncClock = analysisReference;
  for (const [player, peer] of [[analysisReference, analysisPlayer], [analysisPlayer, analysisReference]]) {
    player.playButton.addEventListener('click', () => player.intent ? peer.play() : peer.pause());
    $('.restart', player.root).addEventListener('click', () => peer.seek(0));
    player.timeline.addEventListener('input', () => peer.seek(Number(player.timeline.value) / 1000));
  }
  let analysisType = 'comparison', analysisCase = data.comparison[0];
  function selectVariant(variant) {
    analysisPlayer.setClips(analysisCase.source, variant.video, {
      posterSource: analysisCase.posterSource, posterEdited: variant.poster,
      labelSource: 'Original', labelEdited: variant.label
    });
    for (const button of $$('button', $('#variant-options'))) button.setAttribute('aria-pressed', String(button.dataset.variant === variant.id));
    $('#analysis-variant-label').textContent = `Original / ${variant.label}`;
    $('#analysis-title').textContent = `Original / ${variant.label}`;
    $('#analysis-description').textContent = `Example ${analysisCase.title}. Drag the divider to compare the original performance with ${variant.label}.`;
  }
  function selectAnalysisCase(example) {
    analysisCase = example;
    for (const button of $$('button', $('#analysis-case-tabs'))) {
      const active = button.dataset.analysisCase === example.id;
      button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1;
    }
    $('#analysis-comparison').setAttribute('aria-labelledby', `analysis-case-${example.id}`);
    const full = example.variants[0];
    analysisReference.setClips(example.source, full.video, {
      posterSource: example.posterSource, posterEdited: full.poster,
      labelSource: 'Original', labelEdited: 'FlowCine'
    });
    const alternatives = example.variants.slice(1);
    $('#variant-options').replaceChildren();
    for (const variant of alternatives) {
      const button = document.createElement('button'); button.dataset.variant = variant.id;
      button.textContent = variant.label; button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => selectVariant(variant)); $('#variant-options').append(button);
    }
    mountConveyor($('#variant-options'));
    selectVariant(alternatives[0]);
  }
  function setAnalysis(type) {
    analysisType = type;
    for (const tab of $$('[data-analysis]')) {
      const active = tab.dataset.analysis === type;
      tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
    }
    $('#analysis-panel').setAttribute('aria-labelledby', type === 'comparison' ? 'comparison-tab' : 'ablation-tab');
    $('#variant-options').setAttribute('aria-label', type === 'comparison' ? 'Select a comparison method' : 'Select a component ablation');
    const picker = $('#analysis-case-tabs'); picker.replaceChildren();
    for (const example of data[type]) {
      const button = document.createElement('button'); button.type = 'button'; button.role = 'tab';
      button.id = `analysis-case-${example.id}`; button.dataset.analysisCase = example.id;
      button.setAttribute('aria-controls', 'analysis-comparison'); button.setAttribute('aria-selected', 'false'); button.tabIndex = -1;
      const image = document.createElement('img'); image.src = example.variants[0].poster; image.alt = ''; image.width = 44; image.height = 33;
      const label = document.createElement('span'); label.textContent = example.title; button.append(image, label);
      button.addEventListener('click', () => selectAnalysisCase(example)); picker.append(button);
    }
    mountConveyor(picker);
    $('#analysis-case-count').textContent = `(${data[type].length})`;
    selectAnalysisCase(data[type][0]);
  }
  installTabKeyboard($('#analysis-case-tabs'));
  $$('[data-analysis]').forEach(tab => tab.addEventListener('click', () => setAnalysis(tab.dataset.analysis)));
  installTabKeyboard($('.analysis-tabs')); setAnalysis('comparison');

  // Accessible media lightbox, also used for the full method figure and limitation clip.
  const dialog = $('#media-dialog');
  let returnFocus = null;
  function showMedia({ image, video, caption, trigger }) {
    returnFocus = trigger || document.activeElement;
    $('#dialog-content').replaceChildren();
    const media = document.createElement(video ? 'video' : 'img');
    media.src = video || image;
    if (video) { media.controls = true; media.muted = true; media.playsInline = true; media.loop = true; }
    else media.alt = caption || 'Enlarged project figure';
    $('#dialog-content').append(media); $('#dialog-caption').textContent = caption || '';
    dialog.showModal(); document.body.classList.add('dialog-open');
    if (video && !reducedMotion.matches) media.play().catch(() => {});
  }
  document.addEventListener('click', event => {
    const button = event.target.closest('button.zoomable');
    if (button?.dataset.image) showMedia({ image: button.dataset.image, caption: button.dataset.caption, trigger: button });
  });
  $('#limitation-preview').addEventListener('click', event => showMedia({
    video: 'assets/videos/limitation.mp4', caption: 'A challenging video edit combining complex background, lighting, motion, and clothing. Fine-detail fidelity is limited by the underlying image editing and video generation models.', trigger: event.currentTarget
  }));
  $('.dialog-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
  dialog.addEventListener('close', () => {
    const video = $('video', dialog); if (video) { video.pause(); video.removeAttribute('src'); video.load(); }
    $('#dialog-content').replaceChildren(); document.body.classList.remove('dialog-open'); returnFocus?.focus({ preventScroll: true });
  });

  $('#copy-citation').addEventListener('click', async () => {
    const text = $('#citation-text').textContent;
    let copied = false;
    try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); copied = true; } } catch (_) { /* Local-file fallback below. */ }
    if (!copied) {
      const input = document.createElement('textarea'); input.value = text;
      input.style.cssText = 'position:fixed;left:-9999px;top:0'; document.body.append(input); input.select();
      try { copied = document.execCommand('copy'); } catch (_) { copied = false; }
      input.remove(); $('#copy-citation').focus({ preventScroll: true });
    }
    $('#copy-status').textContent = copied ? 'BibTeX copied.' : 'Select the BibTeX above to copy it.';
    $('#copy-citation').firstChild.textContent = copied ? 'Copied ' : 'Copy BibTeX ';
    window.setTimeout(() => { $('#copy-citation').firstChild.textContent = 'Copy BibTeX '; $('#copy-status').textContent = ''; }, 2500);
  });

  document.addEventListener('visibilitychange', () => {
    players.forEach(player => document.hidden ? player.suspend() : player.maybePlay());
    if (document.hidden) pauseOrbits(); else maybePlayOrbit();
  });
  reducedMotion.addEventListener('change', event => {
    if (event.matches) { players.forEach(player => player.pause()); orbitIntent = false; pauseOrbits(); updateOrbitButton(); }
  });
  let scrollPending = false;
  function updateScroll() {
    const remaining = document.documentElement.scrollHeight - innerHeight;
    $('.reading-progress').style.transform = `scaleX(${remaining > 0 ? Math.min(1, scrollY / remaining) : 0})`;
    let current = 'results';
    for (const section of $$('.section-anchor')) if (section.getBoundingClientRect().top <= 180) current = section.id;
    for (const link of $$('.nav-wrap nav a')) {
      if (link.getAttribute('href') === `#${current}`) link.setAttribute('aria-current', 'location'); else link.removeAttribute('aria-current');
    }
    scrollPending = false;
  }
  addEventListener('scroll', () => { if (!scrollPending) { scrollPending = true; requestAnimationFrame(updateScroll); } }, { passive: true });
  addEventListener('resize', updateScroll); updateScroll();
})();
