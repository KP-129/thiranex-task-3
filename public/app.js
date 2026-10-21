const state = { user: null, tasks: [], view: 'all', status: 'all', query: '', sort: 'due', editing: null };
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const authView = $('#auth-view'), appView = $('#app-view');

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(result.error || 'Something went wrong.'); error.status = response.status; throw error; }
  return result;
}
function showAuth() { const wasSignedIn = Boolean(state.user); state.user = null; if (wasSignedIn) window.dispatchEvent(new Event('taskflow:signedout')); appView.hidden = true; authView.hidden = false; }
function showApp(user) {
  state.user = user; window.dispatchEvent(new Event('taskflow:signedin')); authView.hidden = true; appView.hidden = false;
  $('#profile-name').textContent = user.name; $('#profile-email').textContent = user.email;
  $('#user-avatar').textContent = user.name.trim().charAt(0).toUpperCase(); $('#top-avatar').textContent = user.name.trim().charAt(0).toUpperCase();
  const hour = new Date().getHours();
  $('#greeting').textContent = `${hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'}, ${user.name.split(' ')[0]}.`;
  $('#today-label').textContent = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date());
}
async function loadTasks() { const result = await api('/api/tasks'); state.tasks = result.tasks; render(); }
function localDate(date) { return new Date(`${date}T00:00:00`); }
function formatDate(date) { if (!date) return 'No due date'; const today = new Date(); today.setHours(0,0,0,0); const d = localDate(date); const delta = Math.round((d-today)/86400000); if (delta === 0) return 'Today'; if (delta === 1) return 'Tomorrow'; return new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric'}).format(d); }
function visibleTasks() {
  const today = new Date(); today.setHours(0,0,0,0);
  let list = state.tasks.filter(task => {
    const view = state.view;
    if (view === 'today' && task.dueDate !== new Date().toISOString().slice(0,10)) return false;
    if (view === 'upcoming' && (!task.dueDate || localDate(task.dueDate) <= today || task.status === 'done')) return false;
    if (view === 'completed' && task.status !== 'done') return false;
    if (state.status !== 'all' && task.status !== state.status) return false;
    const text = `${task.title} ${task.description}`.toLowerCase();
    return text.includes(state.query.toLowerCase());
  });
  const priority = { high: 0, medium: 1, low: 2 };
  if (state.sort === 'created') list.sort((a,b) => b.createdAt.localeCompare(a.createdAt));
  else if (state.sort === 'priority') list.sort((a,b) => priority[a.priority] - priority[b.priority]);
  else list.sort((a,b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
  return list;
}
function render() {
  const tasks = state.tasks, done = tasks.filter(t => t.status === 'done').length, progress = tasks.filter(t => t.status === 'in-progress').length, todo = tasks.filter(t => t.status === 'todo').length;
  $('#count-all').textContent = tasks.length; $('#count-today').textContent = tasks.filter(t => t.dueDate === new Date().toISOString().slice(0,10) && t.status !== 'done').length;
  $('#stat-total').textContent = tasks.length; $('#stat-progress').textContent = progress; $('#stat-done').textContent = done;
  $('#stat-done-note').textContent = done ? 'look how far you’ve come' : 'you’re just getting started';
  const pct = tasks.length ? Math.round(done / tasks.length * 100) : 0;
  $('#progress-percent').textContent = `${pct}%`; $('#progress-bar').style.width = `${pct}%`;
  $('#progress-caption').textContent = tasks.length ? `${done} of ${tasks.length} tasks completed. Keep going.` : 'A fresh week is full of possibility.';
  $('#chip-all').textContent = tasks.length; $('#chip-todo').textContent = todo; $('#chip-progress').textContent = progress; $('#chip-done').textContent = done;
  const labels = { all: 'All tasks', today: 'Today', upcoming: 'Upcoming', completed: 'Completed' };
  $('#page-label').textContent = labels[state.view]; $('#list-heading').childNodes[0].textContent = labels[state.view] + ' ';
  $$('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.filter === state.view));
  const shown = visibleTasks(); $('#list-count').textContent = shown.length;
  $('#task-list').innerHTML = shown.map(task => {
    const date = task.dueDate && task.dueDate < new Date().toISOString().slice(0,10) && task.status !== 'done';
    const statusText = task.status === 'in-progress' ? 'In progress' : task.status === 'done' ? 'Done' : 'To do';
    return `<article class="task-row ${task.status === 'done' ? 'is-done' : ''}" data-id="${task.id}"><input class="task-check" type="checkbox" aria-label="Mark ${escapeHtml(task.title)} complete" ${task.status === 'done' ? 'checked' : ''}><div class="task-main"><div class="task-title">${escapeHtml(task.title)}</div>${task.description ? `<div class="task-description">${escapeHtml(task.description)}</div>` : ''}</div><span class="task-date ${date ? 'overdue' : ''}">${date ? 'Overdue · ' : ''}${formatDate(task.dueDate)}</span><span class="priority-badge priority-${task.priority}">${task.priority.charAt(0).toUpperCase()+task.priority.slice(1)}</span><button class="status-badge ${task.status === 'in-progress' ? 'status-progress' : task.status === 'done' ? 'status-done' : 'status-todo'}" data-action="cycle" title="Change status">${statusText}</button><div class="task-row-menu"><button class="task-more" aria-label="Task options">···</button><div class="task-menu-pop" hidden><button data-action="edit">✎ &nbsp; Edit task</button><button data-action="delete" class="delete">⌫ &nbsp; Delete task</button></div></div></article>`;
  }).join('');
  const empty = shown.length === 0; $('#empty-state').hidden = !empty; $('#task-list').hidden = empty;
  $('#empty-title').textContent = state.query ? 'No matching tasks.' : state.view === 'completed' ? 'Your next win is waiting.' : 'A little breathing room.';
  $('#empty-copy').textContent = state.query ? 'Try another search or clear your search.' : 'Nothing on your list just yet. Add a task when you’re ready.';
  $('#empty-add').hidden = state.view === 'completed' || Boolean(state.query);
  $('#focus-title').textContent = tasks.length ? (tasks.find(t => t.status !== 'done')?.title || 'You made space for what matters.') : 'A clear mind starts with one small step.';
  $('#focus-text').textContent = tasks.length ? (tasks.find(t => t.status !== 'done')?.description || 'Choose a task, give it your attention, and let the rest wait.') : 'Choose a task, give it your attention, and let the rest wait.';
  $('#footer-summary').textContent = tasks.length ? `${done} of ${tasks.length} tasks complete · you’ve got this.` : 'You’ve got this.';
}
function escapeHtml(text) { return String(text).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
let toastTimer;
function toast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2400); }
function setAuthMode(mode) {
  const register = mode === 'register';
  $$('.auth-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.mode === mode));
  $('#name-field').hidden = !register; $('#name-field input').required = register;
  $('#auth-title').textContent = register ? 'A fresh start feels good.' : 'Good to have you back.';
  $('#auth-subtitle').textContent = register ? 'Create your space and make room for what matters.' : 'Sign in to pick up where you left off.';
  $('#auth-submit').textContent = register ? 'Create my account' : 'Sign in';
  $('#auth-form [name=password]').autocomplete = register ? 'new-password' : 'current-password';
  $('#auth-error').textContent = '';
}
$$('.auth-tab').forEach(tab => tab.addEventListener('click', () => setAuthMode(tab.dataset.mode)));
$('#auth-form').addEventListener('submit', async event => {
  event.preventDefault(); const form = new FormData(event.currentTarget); const mode = $('.auth-tab.active').dataset.mode;
  const payload = { email: form.get('email'), password: form.get('password') }; if (mode === 'register') payload.name = form.get('name');
  const button = $('#auth-form button[type=submit]'); button.disabled = true; $('#auth-error').textContent = '';
  try { const result = await api(`/api/auth/${mode === 'register' ? 'register' : 'login'}`, { method: 'POST', body: JSON.stringify(payload) }); showApp(result.user); await loadTasks(); }
  catch (error) { $('#auth-error').textContent = error.message; }
  finally { button.disabled = false; }
});
$$('.nav-item').forEach(button => button.addEventListener('click', () => { state.view = button.dataset.filter; state.status = 'all'; $$('.chip').forEach(chip => chip.classList.toggle('active', chip.dataset.status === 'all')); $('#sidebar').classList.remove('open'); render(); }));
$$('.chip').forEach(button => button.addEventListener('click', () => { state.status = button.dataset.status; $$('.chip').forEach(chip => chip.classList.toggle('active', chip === button)); render(); }));
$('#search-input').addEventListener('input', event => { state.query = event.target.value; render(); });
$('#sort-select').addEventListener('change', event => { state.sort = event.target.value; render(); });
$('#add-task').addEventListener('click', () => openModal()); $('#empty-add').addEventListener('click', () => openModal());
function openModal(task = null) {
  state.editing = task?.id || null; const form = $('#task-form'); form.reset();
  $('#modal-title').textContent = task ? 'Make a little progress.' : 'Make a little progress.';
  $('#save-task').innerHTML = task ? 'Save changes <span>→</span>' : 'Save task <span>→</span>';
  if (task) for (const key of ['title','description','dueDate','priority','status']) form.elements[key].value = task[key] || (key === 'priority' ? 'medium' : '');
  $('#task-error').textContent = ''; $('#task-modal').hidden = false; document.body.style.overflow = 'hidden';
  setTimeout(() => form.elements.title.focus(), 30);
}
function closeModal() { $('#task-modal').hidden = true; document.body.style.overflow = ''; state.editing = null; }
$('#close-modal').addEventListener('click', closeModal); $('#cancel-modal').addEventListener('click', closeModal);
$('#task-modal').addEventListener('click', event => { if (event.target === $('#task-modal')) closeModal(); });
$('#task-form').addEventListener('submit', async event => {
  event.preventDefault(); const form = new FormData(event.currentTarget); const payload = Object.fromEntries(form.entries());
  const button = $('#save-task'); button.disabled = true; $('#task-error').textContent = '';
  try {
    const editing = state.editing; const result = await api(editing ? `/api/tasks/${editing}` : '/api/tasks', { method: editing ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
    if (editing) state.tasks = state.tasks.map(task => task.id === editing ? result.task : task); else state.tasks.push(result.task);
    closeModal(); render(); toast(editing ? 'Your changes are saved.' : 'A new task, ready when you are.');
  } catch (error) { $('#task-error').textContent = error.message; }
  finally { button.disabled = false; }
});
$('#task-list').addEventListener('click', async event => {
  const row = event.target.closest('.task-row'); if (!row) return; const task = state.tasks.find(item => item.id === row.dataset.id); if (!task) return;
  if (event.target.classList.contains('task-more')) { const pop = row.querySelector('.task-menu-pop'); const opening = pop.hidden; $$('.task-menu-pop').forEach(menu => menu.hidden = true); pop.hidden = !opening; return; }
  const action = event.target.dataset.action; if (!action) return;
  if (action === 'edit') { row.querySelector('.task-menu-pop').hidden = true; openModal(task); }
  if (action === 'delete') {
    row.querySelector('.task-menu-pop').hidden = true;
    if (!confirm(`Delete “${task.title}”?`)) return;
    try { await api(`/api/tasks/${task.id}`, { method: 'DELETE' }); state.tasks = state.tasks.filter(item => item.id !== task.id); render(); toast('Task removed from your list.'); }
    catch (error) { toast(error.message); }
  }
  if (action === 'cycle') {
    const next = task.status === 'todo' ? 'in-progress' : task.status === 'in-progress' ? 'done' : 'todo';
    await updateTask(task, { status: next });
  }
});
$('#task-list').addEventListener('change', async event => {
  if (!event.target.classList.contains('task-check')) return;
  const row = event.target.closest('.task-row'), task = state.tasks.find(item => item.id === row.dataset.id);
  await updateTask(task, { status: event.target.checked ? 'done' : 'todo' });
});
async function updateTask(task, changes) {
  try { const result = await api(`/api/tasks/${task.id}`, { method: 'PATCH', body: JSON.stringify(changes) }); state.tasks = state.tasks.map(item => item.id === task.id ? result.task : item); render(); }
  catch (error) { toast(error.message); }
}
$('#profile-button').addEventListener('click', () => { $('#profile-menu').hidden = !$('#profile-menu').hidden; });
$('#logout-button').addEventListener('click', async () => { await api('/api/auth/logout', { method: 'POST', body: '{}' }); $('#profile-menu').hidden = true; state.tasks = []; showAuth(); });
$('#mobile-menu').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
$('#focus-action').addEventListener('click', () => { const next = state.tasks.find(t => t.status !== 'done'); if (next) { state.view = 'all'; state.status = 'all'; state.query = ''; $('#search-input').value = ''; render(); document.querySelector(`[data-id="${next.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); } else openModal(); });
document.addEventListener('click', event => { if (!event.target.closest('.task-row-menu')) $$('.task-menu-pop').forEach(menu => menu.hidden = true); if (!event.target.closest('.profile-button') && !event.target.closest('.profile-popover')) $('#profile-menu').hidden = true; });
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeModal(); if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !appView.hidden) { event.preventDefault(); $('#search-input').focus(); } if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n' && !appView.hidden) { event.preventDefault(); openModal(); } });

(async function init() { try { const result = await api('/api/auth/me'); showApp(result.user); await loadTasks(); } catch { showAuth(); } })();
