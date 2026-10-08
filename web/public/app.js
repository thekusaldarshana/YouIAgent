const form = document.querySelector('#source-form');
const feedback = document.querySelector('#form-feedback');
const submit = document.querySelector('#submit-job');
const provider = document.querySelector('#provider');
const model = document.querySelector('#model');
const modelOptions = document.querySelector('#model-options');
const providerStatus = document.querySelector('#provider-status');
const loginStatus = document.querySelector('#login-status');
const loginLink = document.querySelector('#login-link');
const connectProvider = document.querySelector('#connect-provider');
const cancelLogin = document.querySelector('#cancel-login');
const renderStatus = document.querySelector('#render-status');
let providerStates = {};
let renderReady = false;
let modelEdited = false;
let activeLogin = null;
let loginTimer;
const modelSuggestions = { codex: ['gpt-6-sol', 'gpt-6-astra', 'gpt-6-luna'], claude: ['sonnet', 'opus', 'haiku'] };

function updateProvider() {
  modelOptions.replaceChildren(...modelSuggestions[provider.value].map((name) => {
    const option = document.createElement('option'); option.value = name; return option;
  }));
  if (!modelEdited) model.value = provider.value === 'codex' ? 'gpt-6-sol' : '';
  const status = providerStates[provider.value];
  providerStatus.textContent = status ? status.ready ? status.detail : `Unavailable: ${status.detail}` : 'Checking account connection…';
  connectProvider.textContent = activeLogin ? 'Sign-in in progress' : status?.ready ? `Switch ${provider.value === 'codex' ? 'Codex' : 'Claude Code'} account` : `Connect ${provider.value === 'codex' ? 'Codex' : 'Claude Code'}`;
  connectProvider.disabled = Boolean(activeLogin);
  submit.disabled = status?.ready !== true || !renderReady;
}
provider.addEventListener('change', () => { modelEdited = false; updateProvider(); });
model.addEventListener('input', () => { modelEdited = true; });
updateProvider();
async function refreshConnections() {
  const button = document.querySelector('#refresh-providers');
  button.disabled = true;
  providerStatus.textContent = 'Checking account connections…';
  try {
    const response = await fetch('/api/config', { cache: 'no-store' });
    const config = await response.json();
    if (!response.ok) throw new Error(config.error || 'Connection check failed.');
    providerStates = config.providers || {};
    renderReady = config.renderTools?.ffmpeg === true && config.renderTools?.ffprobe === true;
    renderStatus.textContent = renderReady ? 'FFmpeg and FFprobe are ready.' : 'FFmpeg or FFprobe is missing. Install both and restart the server, or set FFMPEG_BIN and FFPROBE_BIN.';
    updateProvider();
  } catch (error) { providerStates = {}; updateProvider(); providerStatus.textContent = error.message; }
  finally { button.disabled = false; }
}
document.querySelector('#refresh-providers').addEventListener('click', refreshConnections);
refreshConnections();

function showLogin(login) {
  loginStatus.textContent = `${login.provider === 'codex' ? 'Codex' : 'Claude Code'}: ${login.message}`;
  let url;
  try { url = login.url && new URL(login.url); } catch { url = null; }
  if (login.state === 'waiting' && url?.protocol === 'https:') {
    loginLink.href = url.href;
    loginLink.classList.remove('hidden');
  } else loginLink.classList.add('hidden');
  cancelLogin.classList.toggle('hidden', login.state !== 'waiting');
}

async function pollLogin() {
  if (!activeLogin) return;
  try {
    const response = await fetch(`/api/providers/${activeLogin.provider}/connect/${activeLogin.id}`, { cache: 'no-store' });
    const login = await response.json();
    if (!response.ok) throw new Error(login.error || 'Could not check sign-in.');
    showLogin(login);
    if (login.state === 'waiting') { loginTimer = setTimeout(pollLogin, 1500); return; }
  } catch (error) { loginStatus.textContent = error.message; }
  activeLogin = null;
  updateProvider();
  await refreshConnections();
}

connectProvider.addEventListener('click', async () => {
  if (activeLogin) return;
  const selected = provider.value;
  const popup = selected === 'codex' ? window.open('about:blank', '_blank') : null;
  connectProvider.disabled = true;
  loginStatus.textContent = `Starting ${selected === 'codex' ? 'Codex' : 'Claude Code'} sign-in…`;
  loginLink.classList.add('hidden');
  try {
    const response = await fetch(`/api/providers/${selected}/connect`, { method: 'POST' });
    const login = await response.json();
    if (!response.ok) throw new Error(login.error || 'Could not start sign-in.');
    activeLogin = login;
    showLogin(login);
    if (popup) {
      if (login.url && new URL(login.url).protocol === 'https:') popup.location.href = login.url;
      else popup.close();
    }
    updateProvider();
    if (login.state === 'waiting') loginTimer = setTimeout(pollLogin, 1500);
    else { activeLogin = null; updateProvider(); await refreshConnections(); }
  } catch (error) {
    popup?.close();
    activeLogin = null;
    updateProvider();
    loginStatus.textContent = error.message;
  }
});

cancelLogin.addEventListener('click', async () => {
  if (!activeLogin) return;
  clearTimeout(loginTimer);
  const login = activeLogin;
  activeLogin = null;
  updateProvider();
  await fetch(`/api/providers/${login.provider}/connect/${login.id}`, { method: 'DELETE' }).catch(() => {});
  loginStatus.textContent = 'Sign-in cancelled.';
  loginLink.classList.add('hidden');
  cancelLogin.classList.add('hidden');
});
const phaseFor = { capture: 'source', prepare: 'source', plan: 'story', planGate: 'story', repairPlan: 'story', audio: 'composition', compose: 'composition', check: 'composition', repairComposition: 'composition', render: 'render', review: 'render' };
const phaseIds = { source: 'stage-capture', story: 'stage-plan', composition: 'stage-compose', render: 'stage-render' };
const names = { capture: 'Reading source site and repository', prepare: 'Preparing the evidence packet', plan: 'Planning the story with AI', planGate: 'Checking source claims', repairPlan: 'Repairing the plan', audio: 'Preparing the soundtrack', compose: 'Composing the film and soundtrack with AI', check: 'Validating the composition and soundtrack', repairComposition: 'Repairing validation findings', render: 'Rendering the MP4', review: 'Reviewing the finished film', resume: 'Resuming saved work' };
let pollTimer;
let elapsedTimer;
let currentJobId;

async function loadLibrary() {
  const list = document.querySelector('#library-list');
  const count = document.querySelector('#library-count');
  try {
    const response = await fetch('/api/jobs');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not load saved films.');
    count.textContent = `${data.jobs.length} saved ${data.jobs.length === 1 ? 'film' : 'films'}`;
    if (!data.jobs.length) {
      const empty = document.createElement('p');
      empty.className = 'library-empty';
      empty.textContent = 'Your films will appear here when you start a production.';
      list.replaceChildren(empty);
      return;
    }
    list.replaceChildren(...data.jobs.map((job) => {
      const card = document.createElement('article');
      card.className = 'library-card';
      const link = document.createElement('a');
      link.className = 'library-open';
      link.href = `/?job=${job.id}#job-result`;
      const thumb = document.createElement('div');
      thumb.className = 'library-thumb';
      if (job.filmReady) {
        const poster = document.createElement('img');
        poster.src = `/api/jobs/${job.id}/poster.jpg`;
        poster.alt = '';
        poster.loading = 'lazy';
        thumb.append(poster);
      } else {
        thumb.textContent = job.state === 'running' ? 'IN PRODUCTION' : 'SAVED WORK';
      }
      const body = document.createElement('div');
      body.className = 'library-body';
      const title = document.createElement('h3');
      try { title.textContent = new URL(job.websiteUrl).hostname; }
      catch { title.textContent = 'Untitled film'; }
      const date = document.createElement('p');
      date.textContent = `${new Date(job.createdAt).toLocaleString()} · ${job.provider === 'claude' ? 'Claude Code' : 'Codex'}${job.model ? ` · ${job.model}` : ''}`;
      const state = document.createElement('span');
      state.className = `library-state ${job.state}`;
      state.textContent = job.state === 'complete' ? job.hasAudio ? 'READY WITH SOUND' : 'READY · SILENT' : job.state === 'running' ? 'IN PRODUCTION' : job.resumeEligible ? 'CAN RESUME' : job.state.toUpperCase();
      body.append(title, date, state);
      link.append(thumb, body);
      card.append(link);
      if (job.filmReady) {
        const download = document.createElement('a');
        download.className = 'library-download';
        download.href = `/api/jobs/${job.id}/film.mp4`;
        download.download = `${title.textContent}-film.mp4`;
        download.textContent = 'Download MP4 ↓';
        card.append(download);
      }
      return card;
    }));
  } catch (error) {
    count.textContent = 'Unavailable';
    const message = document.createElement('p');
    message.className = 'library-empty';
    message.textContent = error.message;
    list.replaceChildren(message);
  }
}

function duration(seconds) {
  const value = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

function updateElapsed(job) {
  const total = (new Date(job.finishedAt || Date.now()).getTime() - new Date(job.createdAt).getTime()) / 1000;
  const step = job.activeSince ? (Date.now() - new Date(job.activeSince).getTime()) / 1000 : 0;
  document.querySelector('#progress-elapsed').textContent = `${job.state === 'running' ? `Current step ${duration(step)} · ` : ''}Total elapsed ${duration(total)}`;
}

function renderEvents(events = []) {
  const list = document.querySelector('#event-list');
  list.replaceChildren();
  for (const event of events.slice(-20).reverse()) {
    const item = document.createElement('li');
    const status = document.createElement('span');
    status.className = `event-state ${event.state}`;
    status.textContent = event.outcome === 'issues' ? 'ISSUES' : event.state === 'start' ? 'STARTED' : event.state.toUpperCase();
    const body = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = names[event.node] || event.node;
    const detail = document.createElement('p');
    detail.textContent = event.detail || (event.node === 'resume' ? `Attempt ${event.attempt}: reusing ${['source', 'plan', 'composition'].filter((name) => event.reuse?.[name]).join(', ')}.` : event.error || (event.seconds != null ? `Finished in ${duration(event.seconds)}` : ''));
    const time = document.createElement('time');
    time.textContent = new Date(event.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    body.append(title, detail);
    item.append(status, body, time);
    list.append(item);
  }
}

function showJob(job) {
  currentJobId = job.id;
  clearTimeout(pollTimer);
  clearInterval(elapsedTimer);
  document.querySelector('#job-result').classList.remove('hidden');
  document.querySelector('#job-state').textContent = job.state.toUpperCase();
  document.querySelector('#job-heading').textContent = job.state === 'complete' ? 'Ready to review' : job.state === 'failed' ? 'Stopped at a fixable step' : job.state === 'interrupted' ? 'Run interrupted' : 'In production';
  document.querySelector('#site-title').textContent = new URL(job.input.websiteUrl).hostname;
  document.querySelector('#site-description').textContent = `${job.input.repositoryUrl} · ${job.input.provider === 'claude' ? 'Claude Code' : 'Codex'} ${job.input.model || 'CLI default'}`;
  document.querySelector('#runner-message').textContent = names[job.stage] || (job.state === 'complete' ? 'Film ready' : 'Starting the pipeline');
  document.querySelector('#runner-detail').textContent = job.state === 'complete' ? `${job.render?.durationSeconds || '—'} seconds · ${job.render?.width || '—'} × ${job.render?.height || '—'}` : `Attempt ${job.attempt || 1} · ${job.id}`;
  const activePhase = phaseFor[job.stage];
  for (const [phase, id] of Object.entries(phaseIds)) {
    const status = job.phases?.[phase] ? 'DONE' : phase === activePhase ? job.state === 'failed' ? 'BLOCKED' : 'WORKING' : 'WAITING';
    document.getElementById(id).textContent = status;
    document.getElementById(id).className = status.toLowerCase();
  }
  const warning = document.querySelector('#job-warning');
  warning.classList.toggle('hidden', job.state === 'running' || !job.error && !job.finding);
  warning.textContent = [job.error, job.finding].filter(Boolean).join('\n');
  document.querySelector('#activity-line').textContent = job.state === 'running' ? job.activity?.message || `${names[job.stage] || 'Working'}…` : job.state === 'complete' ? 'All stages finished' : 'Run stopped';
  document.querySelector('#progress-updated').textContent = job.activity?.at ? `Latest action ${new Date(job.activity.at).toLocaleTimeString()}` : job.state === 'running' ? 'Checking for updates every 2 seconds' : 'Saved locally';
  updateElapsed(job);
  if (job.state === 'running') elapsedTimer = setInterval(() => updateElapsed(job), 1000);
  renderEvents(job.events);
  const resumePanel = document.querySelector('#resume-panel');
  resumePanel.classList.toggle('hidden', !job.resume?.eligible);
  if (job.resume?.eligible) {
    const saved = ['source', job.resume.plan && 'approved plan', job.resume.composition && 'composition'].filter(Boolean).join(', ');
    document.querySelector('#resume-detail').textContent = `Saved: ${saved}. Resume at the ${job.resume.from}; earlier AI work is reused.`;
  }
  if (job.filmReady) {
    const base = `/api/jobs/${job.id}`;
    document.querySelector('#film').src = `${base}/film.mp4`;
    document.querySelector('#film').poster = `${base}/poster.jpg`;
    document.querySelector('#film-download').href = `${base}/film.mp4`;
    document.querySelector('#poster-download').href = `${base}/poster.jpg`;
    document.querySelector('#manifest-link').href = `${base}/source-manifest.json`;
    document.querySelector('#review-link').href = `${base}/visual-review.md`;
    document.querySelector('#sheet-link').href = `${base}/contact-sheet.jpg`;
    document.querySelector('#sheet-link').classList.toggle('hidden', !job.review?.contactSheet);
    document.querySelector('#film-review-note').textContent = job.review?.status === 'unreviewed' ? 'Visual review was unavailable; inspect the film yourself before sharing.' : 'The visual review is an advisory report; inspect the film yourself before sharing.';
    document.querySelector('#film-wrap').classList.remove('hidden');
    const audioNote = document.querySelector('#film-audio-note');
    audioNote.replaceChildren();
    if (job.render?.hasAudio) {
      audioNote.textContent = job.music?.choice && job.music.choice !== 'none' ? `Soundtrack: ${job.music.title || job.music.choice}${job.music.author ? ` by ${job.music.author}` : ''}${job.music.choice === 'original' ? ' · Created for this film' : job.music.license ? ` · ${job.music.license}` : ' · Your own audio'}` : 'Soundtrack included.';
      if (job.music?.sourceUrl) {
        const source = new URL(job.music.sourceUrl);
        if (source.protocol === 'https:' && source.hostname === 'opengameart.org') {
          const link = document.createElement('a');
          link.href = source.href;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent = 'Track source ↗';
          audioNote.append(document.createTextNode(' · '), link);
        }
      }
    } else audioNote.textContent = 'This export has no audio track.';
  }
  if (job.state === 'running') pollTimer = setTimeout(() => poll(job.id), 1800);
  else { updateProvider(); feedback.textContent = job.state === 'complete' ? 'Your film is ready to review.' : job.resume?.eligible ? 'You can continue from the saved checkpoint below.' : job.error || 'The job stopped.'; }
}

async function poll(id) {
  try {
    const response = await fetch(`/api/jobs/${id}`);
    const job = await response.json();
    if (!response.ok) throw new Error(job.error || 'Could not read the job.');
    showJob(job);
  } catch (error) { feedback.textContent = error.message; updateProvider(); }
}

document.querySelector('#resume-job').addEventListener('click', async () => {
  if (!currentJobId) return;
  const button = document.querySelector('#resume-job');
  button.disabled = true;
  feedback.textContent = 'Resuming from saved work…';
  try {
    const response = await fetch(`/api/jobs/${currentJobId}/resume`, { method: 'POST' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not resume this film.');
    await poll(currentJobId);
    await loadLibrary();
  } catch (error) { feedback.textContent = error.message; }
  finally { button.disabled = false; }
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearTimeout(pollTimer);
  submit.disabled = true;
  feedback.textContent = 'Starting the film pipeline…';
  try {
    const input = { websiteUrl: document.querySelector('#website').value.trim(), repositoryUrl: document.querySelector('#repository').value.trim(), goal: document.querySelector('#goal').value.trim(), provider: provider.value, model: model.value.trim(), musicMode: document.querySelector('#music-mode').value };
    const response = await fetch('/api/jobs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
    const job = await response.json();
    if (!response.ok) throw new Error(job.error);
    history.replaceState(null, '', `?job=${job.id}`);
    await poll(job.id);
    await loadLibrary();
  } catch (error) { feedback.textContent = error.message; updateProvider(); }
});

const resumed = new URL(location.href).searchParams.get('job');
if (/^[0-9a-f-]{36}$/.test(resumed || '')) poll(resumed).then(() => {
  if (location.hash === '#job-result') document.querySelector('#job-result').scrollIntoView();
});
loadLibrary();
setInterval(loadLibrary, 15000);

const topBar = document.querySelector('#top-bar');
const syncBar = () => topBar?.classList.toggle('is-scrolled', window.scrollY > 8);
window.addEventListener('scroll', syncBar, { passive: true });
syncBar();
