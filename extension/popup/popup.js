// Popup script.
const $ = id => document.getElementById(id);

async function init() {
  const { reachApi, reachToken, reachStats } = await chrome.storage.local.get([
    'reachApi', 'reachToken', 'reachStats',
  ]);
  $('api').value = reachApi || '';
  $('token').value = reachToken || '';
  renderStats(reachStats || {});
  checkPing();
}

function renderStats(s) {
  $('stat-people').textContent = (s.people || 0).toLocaleString();
  $('stat-edges').textContent = (s.edges || 0).toLocaleString();
  $('stat-posts').textContent = (s.posts || 0).toLocaleString();
  $('stat-messages').textContent = (s.messages || 0).toLocaleString();
  if (s.last_at) {
    const at = new Date(s.last_at);
    $('last-at').textContent = `last seen ${at.toLocaleString()}`;
  }
}

async function save() {
  const api = $('api').value.trim().replace(/\/$/, '');
  const token = $('token').value.trim();
  await chrome.storage.local.set({ reachApi: api, reachToken: token });
  $('status-text').textContent = 'Saved.';
  setTimeout(checkPing, 300);
}

function checkPing() {
  chrome.runtime.sendMessage({ type: 'reach:ping' }, res => {
    if (!res) {
      $('status-dot').className = 'status-dot err';
      $('status-text').textContent = 'No response from background.';
      return;
    }
    if (res.ok) {
      $('status-dot').className = 'status-dot ok';
      $('status-text').textContent = 'Connected to Reach.';
    } else if (res.status === 401) {
      $('status-dot').className = 'status-dot err';
      $('status-text').textContent = 'Token rejected (401).';
    } else if (res.status) {
      $('status-dot').className = 'status-dot err';
      $('status-text').textContent = `Server returned ${res.status}.`;
    } else {
      $('status-dot').className = 'status-dot err';
      $('status-text').textContent = res.error || 'Connection failed.';
    }
  });
}

$('save').addEventListener('click', save);
$('ping').addEventListener('click', checkPing);
$('open-app').addEventListener('click', async (e) => {
  e.preventDefault();
  const { reachApi } = await chrome.storage.local.get('reachApi');
  if (reachApi) chrome.tabs.create({ url: reachApi });
});

init();
