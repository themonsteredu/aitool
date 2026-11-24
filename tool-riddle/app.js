(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const screen = $('screen');
  const audio = new Audio();
  const stageButton = $('toggle-stage');
  const packs = new Map();
  const requests = new Map();
  let tools = [];
  let selected = [];
  let order = [];
  let index = 0;
  let mode = 'robot';
  let robotStep = 0;
  let roundPack;
  let studentStep = 'intro';
  let draft = { answer: '', first: '', second: '' };
  let sound = readSetting('sound') !== false;
  let voiceSettings;
  let voice;
  let captions = readSetting('captions') === true;
  let audioUnavailable = false;
  let projecting = false;
  let nativeProjection = false;
  let controlsTimer;
  let speechId = 0;
  let voiceTimer = 0;
  let utterance;

  function readSetting(key) {
    try { return JSON.parse(localStorage.getItem('moakit-tool-riddle-' + key)); }
    catch { return null; }
  }
  function saveSetting(key, value) {
    try { localStorage.setItem('moakit-tool-riddle-' + key, JSON.stringify(value)); } catch {}
  }
  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function action(label, callback, cls = 'primary') {
    const button = el('button', cls, label);
    button.type = 'button';
    button.addEventListener('click', callback);
    return button;
  }
  function actions(...buttons) {
    const row = el('div', 'actions');
    row.append(...buttons);
    screen.append(row);
  }
  function heading(label, content, cls = '') {
    const line = el('div', 'kicker');
    const marker = el('span', 'marker');
    marker.setAttribute('aria-hidden', 'true');
    line.append(marker, document.createTextNode(label));
    const title = el('h2', cls, content);
    title.tabIndex = -1;
    screen.append(line, title);
  }
  function textLine(text, cls = 'sub') { screen.append(el('p', cls, text)); }

  function activeTool() { return order[index]; }
  function clipUrl(clip, profile, tool, ticket) {
    const params = new URLSearchParams({ clip, voice: profile.id });
    if (tool) params.set('tool', tool.id);
    if (ticket) params.set('ticket', ticket);
    return '/api/tool-riddle?' + params;
  }
  function requestPack(tool) {
    if (!tool || packs.has(tool.id) || requests.has(tool.id)) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    const promise = fetch('/api/tool-riddle?' + new URLSearchParams({ tool: tool.id, format: 'lines' }), { signal: controller.signal })
      .then(response => response.ok ? response.json() : null)
      .then(pack => {
        if (pack?.source === 'ai' && Array.isArray(pack.hints) && pack.hints.length === 2 &&
            pack.hints.every(hint => typeof hint === 'string' && hint.trim())) {
          packs.set(tool.id, pack);
        } else if (pack?.source === 'classroom') {
          packs.set(tool.id, { source: 'classroom', hints: tool.hints });
        }
      })
      .catch(() => {})
      .finally(() => { clearTimeout(timeout); requests.delete(tool.id); });
    requests.set(tool.id, promise);
  }
  function resetDeck(firstLesson = true) {
    order = tools.filter(tool => selected.includes(tool.id));
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    const broom = order.findIndex(tool => tool.id === 'broom');
    if (firstLesson && broom > 0) [order[0], order[broom]] = [order[broom], order[0]];
    index = 0;
    robotStep = 0;
    roundPack = null;
    requestPack(activeTool());
  }

  function stopAudio() {
    speechId++;
    clearTimeout(voiceTimer);
    audio.onplaying = audio.onended = audio.onerror = null;
    audio.pause();
    if (audio.hasAttribute('src')) { audio.removeAttribute('src'); audio.load(); }
    window.speechSynthesis?.cancel();
    utterance = null;
    $('art-panel').classList.remove('speaking');
    $('audio-status').textContent = '';
    $('voice-status').textContent = '';
  }
  function syncCaption() {
    const forced = !sound || audioUnavailable;
    const visible = forced || captions;
    $('board').classList.toggle('show-caption', visible);
    const toggle = $('toggle-caption');
    if (toggle) {
      toggle.disabled = forced;
      toggle.textContent = forced ? '자막 켜짐' : (visible ? '자막 숨기기' : '자막 보기');
      toggle.setAttribute('aria-pressed', String(visible));
    }
  }
  function koreanVoice() {
    return window.speechSynthesis?.getVoices().find(v => /^ko(?:[-_]|$)/i.test(v.lang));
  }
  function speak(text, src, profile = voice, preview = false) {
    stopAudio();
    if (!preview && !sound) return;
    if (!preview) {
      audioUnavailable = false;
      syncCaption();
    }
    const id = speechId;
    const current = () => id === speechId;
    const status = $(preview ? 'voice-status' : 'audio-status');
    const art = $('art-panel');
    function playing() {
      if (!current()) return;
      clearTimeout(voiceTimer);
      if (!usedDevice) status.textContent = preview ? '목소리 미리 듣는 중…' : '';
      art.classList.add('speaking');
    }
    function finished() {
      if (!current()) return;
      clearTimeout(voiceTimer);
      art.classList.remove('speaking');
      if (preview) status.textContent = '';
    }
    let usedDevice = false;
    function useDevice() {
      if (!current() || usedDevice) return;
      usedDevice = true;
      clearTimeout(voiceTimer);
      audio.onplaying = audio.onended = audio.onerror = null;
      audio.pause();
      const speech = window.speechSynthesis;
      const voice = koreanVoice();
      function silent() {
        if (!current()) return;
        finished();
        if (!preview && robotStep > 0 && robotStep < 3) {
          audioUnavailable = true;
          syncCaption();
          status.textContent = '소리를 재생할 수 없어 자막을 켰어요.';
        } else {
          status.textContent = preview ? '미리 듣기를 재생할 수 없어요.' : '소리를 재생할 수 없어요.';
        }
      }
      if (!speech || !window.SpeechSynthesisUtterance) return silent();
      utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'ko-KR';
      if (voice) utterance.voice = voice;
      utterance.rate = profile.rate;
      utterance.pitch = profile.devicePitch;
      status.textContent = '기기의 한국어 목소리로 재생해요.';
      utterance.onstart = playing;
      utterance.onend = finished;
      utterance.onerror = silent;
      try {
        voiceTimer = setTimeout(silent, 4000);
        speech.speak(utterance);
      } catch { silent(); }
    }
    if (!src) return useDevice();
    status.textContent = '로봇 목소리를 준비하고 있어요.';
    audio.onplaying = playing;
    audio.onended = finished;
    audio.onerror = useDevice;
    audio.src = src;
    voiceTimer = setTimeout(useDevice, 8500);
    audio.play().catch(useDevice);
  }
  function currentLine() {
    if (mode !== 'robot' || !robotStep) return;
    const tool = activeTool();
    if (robotStep === 3) {
      speak('정답은 ' + tool.name + '! 어떤 힌트를 듣고 알았나요?', clipUrl('answer', voice, tool));
      return;
    }
    const line = robotStep - 1;
    const ticket = roundPack.tickets?.[line];
    const playable = roundPack.source !== 'ai' || ticket;
    const src = playable ? clipUrl(String(robotStep), voice, tool, ticket) : null;
    speak(roundPack.hints[line], src);
  }
  function openVoices() {
    stopAudio();
    const group = $('voice-options');
    group.querySelectorAll('label').forEach(label => label.remove());
    for (const profile of voiceSettings.voices) {
      const label = el('label', 'voice-choice');
      const input = el('input');
      input.type = 'radio';
      input.name = 'robot-voice';
      input.value = profile.id;
      input.checked = profile.id === voice.id;
      input.addEventListener('change', stopAudio);
      label.append(input, document.createTextNode(profile.label));
      group.append(label);
    }
    $('voice-dialog').showModal();
  }
  function checkedVoice() {
    return voiceSettings.voices.find(v => v.id === $('voice-options').querySelector(':checked').value);
  }
  function wakeControls() {
    if (!projecting) return;
    document.body.classList.remove('controls-idle');
    clearTimeout(controlsTimer);
    controlsTimer = setTimeout(() => {
      if (!document.activeElement?.matches('button:focus-visible, input:focus-visible') &&
          !document.querySelector('dialog[open]')) document.body.classList.add('controls-idle');
    }, 2600);
  }
  function stageLabel() {
    const label = projecting ? '기본 화면' : ($('board').dataset.scene === 'answer' ? '그림 크게 보기' : '로봇만 보기');
    $('stage-label').textContent = label;
    stageButton.setAttribute('aria-label', label);
    stageButton.setAttribute('aria-pressed', String(projecting));
  }
  function leaveProjection() {
    projecting = false;
    clearTimeout(controlsTimer);
    document.body.classList.remove('projecting', 'controls-idle');
    stageLabel();
    if (nativeProjection && document.fullscreenElement) document.exitFullscreen().catch(() => {});
    nativeProjection = false;
  }
  function toggleProjection() {
    if (projecting) { leaveProjection(); return; }
    projecting = true;
    document.body.classList.add('projecting');
    stageLabel();
    wakeControls();
    if (document.fullscreenEnabled && !document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => {
        if (projecting) nativeProjection = true;
        else if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      }).catch(() => {});
    }
  }
  function updateSound() {
    $('toggle-sound').setAttribute('aria-pressed', String(sound));
    $('sound-label').textContent = sound ? '소리 켜짐' : '소리 꺼짐';
    $('sound-icon').setAttribute('href', sound ? '#i-sound' : '#i-muted');
  }
  function setPicture(tool) {
    const stage = $('picture-stage');
    const old = stage.querySelector('.answer-picture');
    $('robot-picture').hidden = Boolean(tool);
    $('art-panel').classList.toggle('revealed', Boolean(tool));
    if (!tool) { old?.remove(); return; }
    if (old?.dataset.id === tool.id) return;
    old?.remove();
    const img = new Image();
    img.src = './assets/' + tool.id + '.webp';
    img.alt = tool.name;
    img.className = 'answer-picture';
    img.dataset.id = tool.id;
    stage.append(img);
  }
  function robotAdvance(step) {
    if (step === 1) {
      const tool = activeTool();
      roundPack = packs.get(tool.id) || { source: 'classroom', hints: tool.hints };
      requestPack(order[index + 1]);
    }
    robotStep = step;
    audioUnavailable = false;
    render(true);
    wakeControls();
    currentLine();
  }
  function nextRobot() {
    const last = activeTool();
    if (index + 1 < order.length) {
      index++;
    } else {
      resetDeck(false);
      if (order.length > 1 && order[0] === last) [order[0], order[1]] = [order[1], order[0]];
    }
    requestPack(activeTool());
    robotAdvance(1);
  }
  function renderRobot() {
    const tool = activeTool();
    const counter = '문제 ' + (index + 1) + ' / ' + order.length;
    setPicture(robotStep === 3 ? tool : null);
    if (robotStep === 0) {
      heading(counter, '내가 고른 도구는 뭘까?');
      actions(action(sound ? '첫 힌트 듣기' : '첫 힌트 보기', () => robotAdvance(1)));
    } else if (robotStep < 3) {
      const n = robotStep;
      heading((n === 1 ? '첫 힌트' : '둘째 힌트') + ' · ' + counter, roundPack.hints[n - 1], 'hint-title');
      screen.querySelector('h2').id = 'hint-caption';
      if (n === 2) textLine('첫 힌트　' + roundPack.hints[0], 'previous');
      const toggle = action('자막 보기', () => {
        captions = !captions;
        saveSetting('captions', captions);
        syncCaption();
      }, 'secondary action-caption');
      toggle.id = 'toggle-caption';
      toggle.setAttribute('aria-controls', 'hint-caption');
      const replay = action('다시 듣기', () => {
        if (!sound) { sound = true; saveSetting('sound', true); updateSound(); }
        currentLine();
      }, 'secondary');
      actions(action(n === 1 ? '다음 힌트' : '정답 공개', () => robotAdvance(n + 1)), replay, toggle);
    } else {
      heading('정답 · ' + counter, tool.name);
      actions(action('이제 우리가 문제 내기', () => changeMode('student')),
        action(index + 1 < order.length ? '다음 로봇 문제' : '다시 섞어 풀기', nextRobot, 'secondary'));
    }
    $('lesson-note').textContent = '';
  }

  function studentAdvance(step) {
    studentStep = step;
    render(true);
  }
  function newStudent() {
    draft = { answer: '', first: '', second: '' };
    studentAdvance('intro');
  }
  function studentEditor() {
    heading('출제자 준비', '나만의 문제 만들기', 'student-title');
    textLine('출제자만 화면을 보고 적어요. 다 쓰면 친구에게 화면을 돌려줘요.');
    const form = el('form', 'editor');
    const fields = [
      ['answer', '정답', '도구 이름', 24],
      ['first', '첫 번째 힌트 · 쓰임', '나는 언제 쓰는 도구인가요?', 80],
      ['second', '두 번째 힌트 · 모양이나 움직임', '어떤 모습이고 어떻게 움직이나요?', 80]
    ];
    const inputs = {};
    for (const [key, name, placeholder, max] of fields) {
      const label = el('label', '', name);
      const input = el('input');
      input.type = 'text';
      input.maxLength = max;
      input.required = true;
      input.autocomplete = 'off';
      input.value = draft[key];
      input.placeholder = placeholder;
      input.addEventListener('input', () => { draft[key] = input.value; input.setCustomValidity(''); });
      inputs[key] = input;
      label.append(input);
      form.append(label);
    }
    const buttons = el('div', 'actions');
    const submit = el('button', 'primary', '친구에게 문제 내기');
    submit.type = 'submit';
    buttons.append(submit, action('돌아가기', () => studentAdvance('intro'), 'secondary'));
    form.append(buttons);
    form.addEventListener('submit', event => {
      event.preventDefault();
      for (const [key] of fields) {
        const value = inputs[key].value.trim();
        if (!value) { inputs[key].setCustomValidity('내용을 적어 주세요.'); inputs[key].reportValidity(); return; }
        draft[key] = value;
      }
      studentAdvance('ready');
    });
    screen.append(form);
  }
  function renderStudent() {
    const ready = studentStep === 'ready';
    const first = studentStep === 'first';
    const second = studentStep === 'second';
    const revealed = studentStep === 'answer';
    const tool = revealed ? tools.find(t => t.name === draft.answer) : null;
    setPicture(tool);
    $('lesson-note').textContent = studentStep === 'edit' ? '' : '모둠에서 돌아가며 한 사람씩 출제해요.';
    if (studentStep === 'intro') {
      heading('친구가 출제자예요', '이번엔 내가 낼게!', 'student-title');
      textLine('그림 카드 한 장을 몰래 골라요. 이름을 숨기고 두 가지 힌트를 말해요.');
      const stems = el('div', 'stems');
      stems.append(el('p', 'stem', '나는 ___할 때 써요.'), el('p', 'stem', '내 모양은 ___처럼 생겼어요.'));
      screen.append(stems);
      actions(action('힌트 카드 직접 쓰기', () => studentAdvance('edit')));
    } else if (studentStep === 'edit') {
      studentEditor();
    } else if (ready || first || second) {
      heading(ready ? '친구의 문제' : (first ? '친구의 첫 번째 힌트' : '친구의 두 번째 힌트'),
        ready ? '친구가 고른 도구는 뭘까?' : (first ? draft.first : draft.second), ready ? 'student-title' : 'hint-title');
      if (ready) textLine('친구들이 볼 수 있게 화면을 돌리고 첫 힌트를 열어요.');
      if (second) textLine('첫 힌트　' + draft.first, 'previous');
      actions(action(ready ? '첫 힌트 열기' : first ? '다음 힌트' : '정답 공개',
        () => studentAdvance(ready ? 'first' : first ? 'second' : 'answer')));
    } else if (revealed) {
      heading('친구가 낸 문제의 정답', draft.answer);
      textLine('어떤 말이 정답을 찾는 데 도움이 되었나요?');
      actions(action('다음 친구 차례', newStudent), action('문제 고치기', () => studentAdvance('edit'), 'secondary'));
    }
  }
  function render(moveFocus = false) {
    if (!tools.length) return;
    const studentAnswer = mode === 'student' && studentStep === 'answer';
    const answerWithPicture = studentAnswer && tools.some(tool => tool.name === draft.answer);
    const stageView = mode === 'robot' || answerWithPicture;
    if (!stageView && projecting) leaveProjection();
    document.body.classList.toggle('stage-view', stageView);
    const scene = (mode === 'robot' && robotStep === 3) || studentAnswer ? 'answer' : (mode === 'robot' && robotStep ? 'hint' : 'intro');
    $('board').dataset.scene = scene;
    screen.replaceChildren();
    $('board').classList.toggle('editing', mode === 'student' && studentStep === 'edit');
    $('robot-mode').setAttribute('aria-pressed', String(mode === 'robot'));
    $('student-mode').setAttribute('aria-pressed', String(mode === 'student'));
    if (mode === 'robot') renderRobot(); else renderStudent();
    if (stageView && scene === 'answer') screen.querySelector('.actions').append(stageButton);
    else $('art-panel').append(stageButton);
    stageLabel();
    syncCaption();
    if (moveFocus) screen.querySelector('h2')?.focus({ preventScroll: true });
  }
  function changeMode(next) {
    if (mode === next || !tools.length) return;
    stopAudio();
    mode = next;
    render(true);
  }

  function checkedIds() {
    return Array.from($('card-grid').querySelectorAll('input:checked'), input => input.value);
  }
  function refreshChoices() {
    const ids = checkedIds();
    $('card-count').textContent = ids.length + '장 선택';
    $('apply-cards').disabled = $('print-cards').disabled = !ids.length;
  }
  function openCards() {
    stopAudio();
    const grid = $('card-grid');
    grid.replaceChildren();
    for (const tool of tools) {
      const label = el('label', 'card-choice');
      const check = el('input');
      check.type = 'checkbox';
      check.value = tool.id;
      check.checked = selected.includes(tool.id);
      const img = new Image();
      img.src = './assets/' + tool.id + '.webp';
      img.alt = '';
      label.append(check, img, el('span', '', tool.name));
      grid.append(label);
    }
    refreshChoices();
    $('card-dialog').showModal();
  }
  function fillPrintSheet() {
    const ids = $('card-dialog').open ? checkedIds() : selected;
    const sheet = $('print-sheet');
    sheet.replaceChildren();
    for (const tool of tools.filter(t => ids.includes(t.id))) {
      const figure = el('figure', 'print-card');
      const img = new Image();
      img.src = './assets/' + tool.id + '.webp';
      img.alt = '';
      figure.append(img, el('strong', '', tool.name));
      sheet.append(figure);
    }
  }

  $('robot-mode').onclick = () => changeMode('robot');
  $('student-mode').onclick = () => changeMode('student');
  $('toggle-sound').onclick = () => {
    sound = !sound;
    saveSetting('sound', sound);
    updateSound();
    if (!sound) stopAudio();
    syncCaption();
    if (mode === 'robot' && tools.length && robotStep === 0) render();
    if (sound) currentLine();
  };
  $('open-voices').onclick = openVoices;
  $('close-voices').onclick = () => $('voice-dialog').close();
  $('voice-dialog').addEventListener('close', () => {
    if ($('voice-dialog').returnValue !== 'applied') stopAudio();
    $('voice-dialog').returnValue = '';
  });
  $('preview-voice').onclick = () => {
    const choice = checkedVoice();
    speak(voiceSettings.sample, clipUrl('sample', choice), choice, true);
  };
  $('apply-voice').onclick = () => {
    stopAudio();
    voice = checkedVoice();
    saveSetting('voice', voice.id);
    $('voice-dialog').close('applied');
    if (sound) currentLine();
  };
  stageButton.onclick = toggleProjection;
  document.addEventListener('pointermove', wakeControls, { passive: true });
  document.addEventListener('pointerdown', wakeControls, { passive: true });
  document.addEventListener('focusin', wakeControls);
  document.addEventListener('keydown', event => {
    if (!projecting) return;
    if (event.key === 'Escape') leaveProjection();
    else wakeControls();
  });
  document.addEventListener('fullscreenchange', () => {
    if (nativeProjection && !document.fullscreenElement) leaveProjection();
  });
  $('open-cards').onclick = openCards;
  $('close-cards').onclick = () => $('card-dialog').close();
  $('card-grid').onchange = refreshChoices;
  $('apply-cards').onclick = () => {
    const ids = checkedIds();
    if (selected.join() !== ids.join()) {
      selected = ids;
      saveSetting('cards', ids);
      resetDeck();
      mode = 'robot';
      render();
    }
    $('card-dialog').close();
  };
  $('print-cards').onclick = async () => {
    fillPrintSheet();
    await Promise.all(Array.from($('print-sheet').querySelectorAll('img'), img => img.decode().catch(() => {})));
    window.print();
  };
  window.addEventListener('beforeprint', fillPrintSheet);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopAudio(); });
  window.addEventListener('pagehide', stopAudio);
  updateSound();
  window.speechSynthesis?.getVoices();

  async function initialize() {
    try {
      const [catalog, settings] = await Promise.all(['./tools.json', './voices.json'].map(async path => {
        const response = await fetch(path);
        if (!response.ok) throw Error('catalog');
        return response.json();
      }));
      tools = catalog;
      voiceSettings = settings;
      const savedVoice = readSetting('voice');
      voice = settings.voices.find(v => v.id === savedVoice) ||
        settings.voices.find(v => v.id === settings.defaultVoice);
      $('open-voices').disabled = false;
      const saved = readSetting('cards');
      selected = tools.filter(t => Array.isArray(saved) && saved.includes(t.id)).map(t => t.id);
      if (!selected.length) selected = tools.map(t => t.id);
      resetDeck();
      $('open-cards').disabled = false;
      render();
    } catch {
      document.body.classList.remove('stage-view');
      screen.replaceChildren();
      heading('연결 확인', '그림 카드를 불러오지 못했어요.', 'student-title');
      actions(action('다시 불러오기', initialize));
    } finally {
      screen.setAttribute('aria-busy', 'false');
    }
  }
  initialize();
})();
