import type { ConfigResponse, CreateJobRequest, ErrorResponse, JobStatus, JobsResponse, JobSummary, LoginSession, ProviderId, ProviderStatus, UploadCreated } from '../../shared/api.js';

/** Finds a required element; a missing one means index.html and this script have drifted apart. */
function $<T extends HTMLElement = HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
}

/**
 * Reads this app's own same-origin JSON API. The shapes are the server's published contract in
 * shared/api.ts; a failed status is surfaced through the `error` field the server always sends.
 */
async function readApi<T>(response: Response): Promise<T & Partial<ErrorResponse>> {
  return await response.json() as T & Partial<ErrorResponse>;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const form = $<HTMLFormElement>('#source-form');
const feedback = $('#form-feedback');
const submit = $<HTMLButtonElement>('#submit-job');
const provider = $<HTMLSelectElement>('#provider');
const model = $<HTMLInputElement>('#model');
const modelOptions = $<HTMLDataListElement>('#model-options');
const providerStatus = $('#provider-status');
const loginStatus = $('#login-status');
const loginLink = $<HTMLAnchorElement>('#login-link');
const connectProvider = $<HTMLButtonElement>('#connect-provider');
const cancelLogin = $<HTMLButtonElement>('#cancel-login');
const renderStatus = $('#render-status');
const repositoryInput = $<HTMLInputElement>('#repository');
const folderPicker = $<HTMLInputElement>('#folder-picker');
const folderSelection = $('#folder-selection');
let providerStates: Partial<Record<ProviderId, ProviderStatus>> = {};
let renderReady = false;
let modelEdited = false;
let activeLogin: LoginSession | null = null;
let loginTimer: number | undefined;
const modelSuggestions: Record<ProviderId, string[]> = { codex: ['gpt-6-sol', 'gpt-6-astra', 'gpt-6-luna'], claude: ['sonnet', 'opus', 'haiku'] };

const selectedProvider = (): ProviderId => provider.value === 'claude' ? 'claude' : 'codex';
const providerLabel = (id: ProviderId): string => id === 'codex' ? 'Codex' : 'Claude Code';

function updateProvider(): void {
  modelOptions.replaceChildren(...modelSuggestions[selectedProvider()].map((name) => {
    const option = document.createElement('option'); option.value = name; return option;
  }));
  if (!modelEdited) model.value = selectedProvider() === 'codex' ? 'gpt-6-sol' : '';
  const status = providerStates[selectedProvider()];
  providerStatus.textContent = status ? status.ready ? status.detail : `Unavailable: ${status.detail}` : 'Checking account connection…';
  connectProvider.textContent = activeLogin ? 'Sign-in in progress' : status?.ready ? `Switch ${providerLabel(selectedProvider())} account` : `Connect ${providerLabel(selectedProvider())}`;
  connectProvider.disabled = Boolean(activeLogin);
  submit.disabled = status?.ready !== true || !renderReady;
}
provider.addEventListener('change', () => { modelEdited = false; updateProvider(); });
model.addEventListener('input', () => { modelEdited = true; });
updateProvider();
async function refreshConnections(): Promise<void> {
  const button = $<HTMLButtonElement>('#refresh-providers');
  button.disabled = true;
  providerStatus.textContent = 'Checking account connections…';
  try {
    const response = await fetch('/api/config', { cache: 'no-store' });
    const config = await readApi<ConfigResponse>(response);
    if (!response.ok) throw new Error(config.error || 'Connection check failed.');
    providerStates = config.providers || {};
    renderReady = config.renderTools?.ffmpeg === true && config.renderTools?.ffprobe === true;
    renderStatus.textContent = renderReady ? 'FFmpeg and FFprobe are ready.' : 'FFmpeg or FFprobe is missing. Install both and restart the server, or set FFMPEG_BIN and FFPROBE_BIN.';
    updateProvider();
  } catch (error) { providerStates = {}; updateProvider(); providerStatus.textContent = messageOf(error); }
  finally { button.disabled = false; }
}
$('#refresh-providers').addEventListener('click', () => { void refreshConnections(); });
void refreshConnections();

function showLogin(login: LoginSession): void {
  loginStatus.textContent = `${providerLabel(login.provider)}: ${login.message}`;
  let url: URL | null = null;
  try { url = login.url ? new URL(login.url) : null; } catch { url = null; }
  if (login.state === 'waiting' && url?.protocol === 'https:') {
    loginLink.href = url.href;
    loginLink.classList.remove('hidden');
  } else loginLink.classList.add('hidden');
  cancelLogin.classList.toggle('hidden', login.state !== 'waiting');
}

async function pollLogin(): Promise<void> {
  if (!activeLogin) return;
  try {
    const response = await fetch(`/api/providers/${activeLogin.provider}/connect/${activeLogin.id}`, { cache: 'no-store' });
    const login = await readApi<LoginSession>(response);
    if (!response.ok) throw new Error(login.error || 'Could not check sign-in.');
    showLogin(login);
    if (login.state === 'waiting') { loginTimer = window.setTimeout(() => { void pollLogin(); }, 1500); return; }
  } catch (error) { loginStatus.textContent = messageOf(error); }
  activeLogin = null;
  updateProvider();
  await refreshConnections();
}

connectProvider.addEventListener('click', async () => {
  if (activeLogin) return;
  const selected = selectedProvider();
  const popup = selected === 'codex' ? window.open('about:blank', '_blank') : null;
  connectProvider.disabled = true;
  loginStatus.textContent = `Starting ${providerLabel(selected)} sign-in…`;
  loginLink.classList.add('hidden');
  try {
    const response = await fetch(`/api/providers/${selected}/connect`, { method: 'POST' });
    const login = await readApi<LoginSession>(response);
    if (!response.ok) throw new Error(login.error || 'Could not start sign-in.');
    activeLogin = login;
    showLogin(login);
    if (popup) {
      if (login.url && new URL(login.url).protocol === 'https:') popup.location.href = login.url;
      else popup.close();
    }
    updateProvider();
    if (login.state === 'waiting') loginTimer = window.setTimeout(() => { void pollLogin(); }, 1500);
    else { activeLogin = null; updateProvider(); await refreshConnections(); }
  } catch (error) {
    popup?.close();
    activeLogin = null;
    updateProvider();
    loginStatus.textContent = messageOf(error);
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
const phaseFor: Record<string, string> = { capture: 'source', prepare: 'source', plan: 'story', planGate: 'story', repairPlan: 'story', audio: 'composition', compose: 'composition', check: 'composition', repairComposition: 'composition', render: 'render', review: 'render' };
const phaseIds: Record<string, string> = { source: 'stage-capture', story: 'stage-plan', composition: 'stage-compose', render: 'stage-render' };
const names: Record<string, string> = { capture: 'Reading source material', prepare: 'Preparing the evidence packet', plan: 'Planning the story with AI', planGate: 'Checking source claims', repairPlan: 'Repairing the plan', audio: 'Preparing the soundtrack', compose: 'Composing the film and soundtrack with AI', check: 'Validating the composition and soundtrack', repairComposition: 'Repairing validation findings', render: 'Rendering the MP4', review: 'Reviewing the finished film', resume: 'Resuming saved work' };
interface SourceFields { websiteUrl?: string | null | undefined; repositoryUrl?: string | null | undefined; repositoryName?: string | undefined }

function sourceLabel(input: SourceFields): string {
  if (input.websiteUrl) return new URL(input.websiteUrl).hostname;
  if (input.repositoryName) return input.repositoryName;
  if (input.repositoryUrl?.startsWith('https://')) return new URL(input.repositoryUrl).pathname.split('/').filter(Boolean).join('/');
  return input.repositoryUrl?.split(/[\\/]/).filter(Boolean).at(-1) || 'Untitled film';
}
$('#choose-folder').addEventListener('click', () => folderPicker.click());
folderPicker.addEventListener('change', () => {
  const files = [...(folderPicker.files ?? [])];
  if (files.length) repositoryInput.value = '';
  const name = files[0]?.webkitRelativePath?.split('/')[0] || 'Local folder';
  folderSelection.textContent = files.length ? `${name} · ${files.length} selected files` : 'No folder chosen';
});
repositoryInput.addEventListener('input', () => {
  if (repositoryInput.value.trim() && folderPicker.files?.length) {
    folderPicker.value = '';
    folderSelection.textContent = 'No folder chosen';
  }
});

async function uploadFolder(files: File[]): Promise<string> {
  const ignored = /^(?:\.git|\.env(?:\..*)?|\.youiagent|node_modules|\.next|dist|build|coverage|venv|\.venv|__pycache__|secrets?|credentials?)$/i;
  const selected = files.map((file) => ({ file, parts: file.webkitRelativePath?.split('/') || [] }))
    .filter(({ parts }) => parts.length > 1 && parts.slice(1).every((part) => part && !part.startsWith('.') && !ignored.test(part)));
  if (!selected.length) throw new Error('The chosen folder has no source files after excluding hidden and generated files.');
  if (selected.length > 2_000 || selected.reduce((sum, item) => sum + item.file.size, 0) > 100_000_000 || selected.some((item) => item.file.size > 25_000_000)) {
    throw new Error('The chosen folder exceeds 2,000 files, 100 MB total, or 25 MB for one file.');
  }
  const response = await fetch('/api/uploads', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: selected[0]?.parts[0] }) });
  const upload = await readApi<UploadCreated>(response);
  if (!response.ok) throw new Error(upload.error || 'Could not start folder upload.');
  try {
    for (const [index, item] of selected.entries()) {
      feedback.textContent = `Copying selected folder to this computer… ${index + 1}/${selected.length}`;
      const path = item.parts.slice(1).join('/');
      const saved = await fetch(`/api/uploads/${upload.id}/files?path=${encodeURIComponent(path)}`, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: item.file });
      if (!saved.ok) throw new Error((await readApi<object>(saved)).error || `Could not copy ${path}.`);
    }
  } catch (error) {
    await fetch(`/api/uploads/${upload.id}`, { method: 'DELETE' }).catch(() => {});
    throw error;
  }
  return upload.id;
}
let pollTimer: number | undefined;
let elapsedTimer: number | undefined;
let currentJobId: string | undefined;

async function loadLibrary(): Promise<void> {
  const list = $('#library-list');
  const count = $('#library-count');
  try {
    const response = await fetch('/api/jobs');
    const data = await readApi<JobsResponse>(response);
    if (!response.ok) throw new Error(data.error || 'Could not load saved films.');
    count.textContent = `${data.jobs.length} saved ${data.jobs.length === 1 ? 'film' : 'films'}`;
    if (!data.jobs.length) {
      const empty = document.createElement('p');
      empty.className = 'library-empty';
      empty.textContent = 'Your films will appear here when you start a production.';
      list.replaceChildren(empty);
      return;
    }
    list.replaceChildren(...data.jobs.map((job: JobSummary) => {
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
      title.textContent = sourceLabel(job);
      const date = document.createElement('p');
      date.textContent = `${new Date(job.createdAt ?? Number.NaN).toLocaleString()} · ${job.provider === 'claude' ? 'Claude Code' : 'Codex'}${job.model ? ` · ${job.model}` : ''}`;
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
    message.textContent = messageOf(error);
    list.replaceChildren(message);
  }
}

function duration(seconds: number | undefined): string {
  const value = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

function updateElapsed(job: JobStatus): void {
  const total = (new Date(job.finishedAt || Date.now()).getTime() - new Date(job.createdAt ?? Number.NaN).getTime()) / 1000;
  const step = job.activeSince ? (Date.now() - new Date(job.activeSince).getTime()) / 1000 : 0;
  $('#progress-elapsed').textContent = `${job.state === 'running' ? `Current step ${duration(step)} · ` : ''}Total elapsed ${duration(total)}`;
}

function renderEvents(events: JobStatus['events'] = []): void {
  const list = $('#event-list');
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
    detail.textContent = event.detail || (event.node === 'resume' ? `Attempt ${event.attempt}: reusing ${['source', 'plan', 'composition'].filter((name) => event.reuse?.[name as 'source' | 'plan' | 'composition']).join(', ')}.` : event.error || (event.seconds != null ? `Finished in ${duration(event.seconds)}` : ''));
    const time = document.createElement('time');
    time.textContent = event.at ? new Date(event.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
    body.append(title, detail);
    item.append(status, body, time);
    list.append(item);
  }
}

function showJob(job: JobStatus): void {
  currentJobId = job.id;
  window.clearTimeout(pollTimer);
  window.clearInterval(elapsedTimer);
  $('#job-result').classList.remove('hidden');
  $('#job-state').textContent = job.state.toUpperCase();
  $('#job-heading').textContent = job.state === 'complete' ? 'Ready to review' : job.state === 'failed' ? 'Stopped at a fixable step' : job.state === 'interrupted' ? 'Run interrupted' : 'In production';
  $('#site-title').textContent = sourceLabel(job.input);
  $('#site-description').textContent = `${[job.input.websiteUrl, job.input.repositoryName || job.input.repositoryUrl].filter(Boolean).join(' · ')} · ${job.input.provider === 'claude' ? 'Claude Code' : 'Codex'} ${job.input.model || 'CLI default'}`;
  $('#runner-message').textContent = names[job.stage] || (job.state === 'complete' ? 'Film ready' : 'Starting the pipeline');
  $('#runner-detail').textContent = job.state === 'complete' ? `${job.render?.durationSeconds || '—'} seconds · ${job.render?.width || '—'} × ${job.render?.height || '—'}` : `Attempt ${job.attempt || 1} · ${job.id}`;
  const activePhase = phaseFor[job.stage];
  for (const [phase, id] of Object.entries(phaseIds)) {
    const status = job.phases[phase as keyof JobStatus['phases']] ? 'DONE' : phase === activePhase ? job.state === 'failed' ? 'BLOCKED' : 'WORKING' : 'WAITING';
    const badge = document.getElementById(id);
    if (!badge) continue;
    badge.textContent = status;
    badge.className = status.toLowerCase();
  }
  const warning = $('#job-warning');
  warning.classList.toggle('hidden', job.state === 'running' || !job.error && !job.finding);
  warning.textContent = [job.error, job.finding].filter(Boolean).join('\n');
  $('#activity-line').textContent = job.state === 'running' ? job.activity?.message || `${names[job.stage] || 'Working'}…` : job.state === 'complete' ? 'All stages finished' : 'Run stopped';
  $('#progress-updated').textContent = job.activity?.at ? `Latest action ${new Date(job.activity.at).toLocaleTimeString()}` : job.state === 'running' ? 'Checking for updates every 2 seconds' : 'Saved locally';
  updateElapsed(job);
  if (job.state === 'running') elapsedTimer = window.setInterval(() => updateElapsed(job), 1000);
  renderEvents(job.events);
  const resumePanel = $('#resume-panel');
  resumePanel.classList.toggle('hidden', !job.resume?.eligible);
  if (job.resume?.eligible) {
    const saved = ['source', job.resume.plan && 'approved plan', job.resume.composition && 'composition'].filter(Boolean).join(', ');
    $('#resume-detail').textContent = `Saved: ${saved}. Resume at the ${job.resume.from}; earlier AI work is reused.`;
  }
  if (job.filmReady) {
    const base = `/api/jobs/${job.id}`;
    $<HTMLVideoElement>('#film').src = `${base}/film.mp4`;
    $<HTMLVideoElement>('#film').poster = `${base}/poster.jpg`;
    $<HTMLAnchorElement>('#film-download').href = `${base}/film.mp4`;
    $<HTMLAnchorElement>('#poster-download').href = `${base}/poster.jpg`;
    $<HTMLAnchorElement>('#manifest-link').href = `${base}/source-manifest.json`;
    $<HTMLAnchorElement>('#review-link').href = `${base}/visual-review.md`;
    $<HTMLAnchorElement>('#sheet-link').href = `${base}/contact-sheet.jpg`;
    $('#sheet-link').classList.toggle('hidden', !job.review?.contactSheet);
    $('#film-review-note').textContent = job.review?.status === 'unreviewed' ? 'Visual review was unavailable; inspect the film yourself before sharing.' : 'The visual review is an advisory report; inspect the film yourself before sharing.';
    $('#film-wrap').classList.remove('hidden');
    const audioNote = $('#film-audio-note');
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
  if (job.state === 'running') pollTimer = window.setTimeout(() => { void poll(job.id); }, 1800);
  else { updateProvider(); feedback.textContent = job.state === 'complete' ? 'Your film is ready to review.' : job.resume?.eligible ? 'You can continue from the saved checkpoint below.' : job.error || 'The job stopped.'; }
}

async function poll(id: string): Promise<void> {
  try {
    const response = await fetch(`/api/jobs/${id}`);
    const job = await readApi<JobStatus>(response);
    if (!response.ok) throw new Error(job.error || 'Could not read the job.');
    showJob(job);
  } catch (error) { feedback.textContent = messageOf(error); updateProvider(); }
}

$('#resume-job').addEventListener('click', async () => {
  if (!currentJobId) return;
  const button = $<HTMLButtonElement>('#resume-job');
  button.disabled = true;
  feedback.textContent = 'Resuming from saved work…';
  try {
    const response = await fetch(`/api/jobs/${currentJobId}/resume`, { method: 'POST' });
    const result = await readApi<object>(response);
    if (!response.ok) throw new Error(result.error || 'Could not resume this film.');
    await poll(currentJobId);
    await loadLibrary();
  } catch (error) { feedback.textContent = messageOf(error); }
  finally { button.disabled = false; }
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  window.clearTimeout(pollTimer);
  submit.disabled = true;
  feedback.textContent = 'Starting the film pipeline…';
  let uploadId: string | null | undefined;
  try {
    const input: CreateJobRequest = { websiteUrl: $<HTMLInputElement>('#website').value.trim(), repositoryUrl: repositoryInput.value.trim(), goal: $<HTMLTextAreaElement | HTMLInputElement>('#goal').value.trim(), provider: provider.value, model: model.value.trim(), musicMode: $<HTMLSelectElement>('#music-mode').value };
    const files = [...(folderPicker.files ?? [])];
    if (!input.websiteUrl && !input.repositoryUrl && !files.length) throw new Error('Enter a website URL, a repository URL or path, or choose a local folder.');
    if (files.length && input.repositoryUrl) throw new Error('Choose either a repository URL or path, or a folder from the picker.');
    if (files.length) { uploadId = await uploadFolder(files); input.uploadId = uploadId; }
    const response = await fetch('/api/jobs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
    const job = await readApi<JobStatus>(response);
    if (!response.ok) throw new Error(job.error);
    uploadId = null;
    history.replaceState(null, '', `?job=${job.id}`);
    await poll(job.id);
    await loadLibrary();
  } catch (error) {
    if (uploadId) await fetch(`/api/uploads/${uploadId}`, { method: 'DELETE' }).catch(() => {});
    feedback.textContent = messageOf(error);
    updateProvider();
  }
});

const resumed = new URL(location.href).searchParams.get('job');
if (resumed && /^[0-9a-f-]{36}$/.test(resumed)) void poll(resumed).then(() => {
  if (location.hash === '#job-result') $('#job-result').scrollIntoView();
});
void loadLibrary();
setInterval(() => { void loadLibrary(); }, 15000);

const topBar = document.querySelector('#top-bar');
const syncBar = () => topBar?.classList.toggle('is-scrolled', window.scrollY > 8);
window.addEventListener('scroll', syncBar, { passive: true });
syncBar();
