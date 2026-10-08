const form = document.querySelector('#source-form');
const feedback = document.querySelector('#form-feedback');
const submit = document.querySelector('#submit-job');
const labels = { capture: 'stage-capture', prepare: 'stage-capture', plan: 'stage-plan', planGate: 'stage-plan', repairPlan: 'stage-plan', audio: 'stage-compose', compose: 'stage-compose', check: 'stage-compose', repairComposition: 'stage-compose', render: 'stage-render' };
const descriptions = { capture: 'Reading the website and repository', prepare: 'Building the source and design packet', plan: 'Finding the story', planGate: 'Checking source claims', repairPlan: 'Refining the plan', audio: 'Choosing the soundtrack', compose: 'Creating motion scenes', check: 'Checking the composition', repairComposition: 'Repairing the composition', render: 'Rendering the film' };
let pollTimer;

function showJob(job) {
  document.querySelector('#job-result').classList.remove('hidden');
  document.querySelector('#job-state').textContent = job.state.toUpperCase();
  document.querySelector('#site-title').textContent = new URL(job.input.websiteUrl).hostname;
  document.querySelector('#site-description').textContent = job.input.repositoryUrl;
  document.querySelector('#runner-message').textContent = descriptions[job.stage] || (job.state === 'complete' ? 'Film ready' : 'Starting the pipeline');
  document.querySelector('#runner-detail').textContent = job.state === 'complete' ? `${job.render?.durationSeconds || '—'} seconds · ${job.render?.width || '—'} × ${job.render?.height || '—'} · ${job.render?.hasAudio ? `Music: ${job.music?.title || job.musicChoice || 'included'}` : 'No music'}` : `Job ${job.id} · ${job.stage}`;
  for (const id of new Set(Object.values(labels))) document.getElementById(id).textContent = 'WAITING';
  for (const [node, state] of Object.entries(job.stages || {})) if (labels[node]) document.getElementById(labels[node]).textContent = state.toUpperCase();
  const warning = document.querySelector('#job-warning');
  warning.classList.toggle('hidden', !job.error);
  warning.textContent = job.error || '';
  if (job.filmReady) {
    const base = `/api/jobs/${job.id}`;
    document.querySelector('#film').src = `${base}/film.mp4`;
    document.querySelector('#film').poster = `${base}/poster.jpg`;
    document.querySelector('#film-download').href = `${base}/film.mp4`;
    document.querySelector('#poster-download').href = `${base}/poster.jpg`;
    document.querySelector('#manifest-link').href = `${base}/source-manifest.json`;
    const credit = document.querySelector('#music-credit');
    credit.replaceChildren();
    if (job.music?.choice && job.music.choice !== 'none') {
      credit.append(document.createTextNode(`Soundtrack: ${job.music.title || job.music.choice}${job.music.author ? ` by ${job.music.author}` : ''}${job.music.license ? ` · ${job.music.license}` : ' · Your own audio'}`));
      if (job.music.sourceUrl) {
        const source = new URL(job.music.sourceUrl);
        if (source.protocol === 'https:' && source.hostname === 'opengameart.org') {
          const link = document.createElement('a');
          link.href = source.href;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent = 'Track source ↗';
          credit.append(document.createTextNode(' · '), link);
        }
      }
    } else credit.textContent = 'No background music was selected.';
    document.querySelector('#film-wrap').classList.remove('hidden');
    document.querySelector('#job-heading').textContent = 'Ready to review';
  }
  if (job.state === 'running') pollTimer = setTimeout(() => poll(job.id), 2500);
  else { submit.disabled = false; feedback.textContent = job.state === 'complete' ? 'Your film is ready. Watch and review it before sharing.' : job.error || 'The job stopped. Inspect its local log for details.'; }
}

async function poll(id) {
  try {
    const response = await fetch(`/api/jobs/${id}`);
    const job = await response.json();
    if (!response.ok) throw new Error(job.error || 'Could not read the job.');
    showJob(job);
  } catch (error) { feedback.textContent = error.message; submit.disabled = false; }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearTimeout(pollTimer);
  submit.disabled = true;
  feedback.textContent = 'Starting the film pipeline…';
  try {
    const input = { websiteUrl: document.querySelector('#website').value.trim(), repositoryUrl: document.querySelector('#repository').value.trim(), goal: document.querySelector('#goal').value.trim(), musicMode: document.querySelector('#music-mode').value };
    const response = await fetch('/api/jobs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
    const job = await response.json();
    if (!response.ok) throw new Error(job.error);
    history.replaceState(null, '', `?job=${job.id}`);
    showJob({ ...job, stage: 'starting', stages: {}, filmReady: false });
    await poll(job.id);
  } catch (error) { feedback.textContent = error.message; submit.disabled = false; }
});

const resumed = new URL(location.href).searchParams.get('job');
if (/^[0-9a-f-]{36}$/.test(resumed || '')) poll(resumed);
