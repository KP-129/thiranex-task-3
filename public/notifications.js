function localDayKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function dueReminderTasks() {
  const today = localDayKey();
  return state.tasks.filter(task => task.status !== 'done' && task.dueDate && task.dueDate <= today).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}
function renderReminders() {
  const tasks = dueReminderTasks();
  const badge = $('#notification-badge');
  badge.hidden = tasks.length === 0;
  badge.textContent = tasks.length > 9 ? '9+' : String(tasks.length);
  $('#notification-count').textContent = String(tasks.length);
  const list = $('#notification-list');
  list.innerHTML = tasks.length ? tasks.map(task => {
    const overdue = task.dueDate < localDayKey();
    return `<button class="notification-item" data-reminder-task="${task.id}"><span class="reminder-mark ${overdue ? 'is-overdue' : ''}">${overdue ? '!' : '◷'}</span><span class="reminder-copy"><strong>${escapeHtml(task.title)}</strong><small>${overdue ? `Overdue · ${formatDate(task.dueDate)}` : 'Due today'} · ${task.priority} priority</small></span><span class="reminder-arrow">↗</span></button>`;
  }).join('') : '<div class="reminder-empty"><span>✦</span><strong>You’re all caught up.</strong><small>No tasks due today or overdue.</small></div>';
  const permission = 'Notification' in window ? Notification.permission : 'unsupported';
  const enable = $('#enable-notifications');
  const hint = $('#notification-hint');
  enable.hidden = permission === 'granted' || permission === 'denied' || permission === 'unsupported';
  hint.textContent = permission === 'granted' ? 'Browser reminders are on. We’ll send one daily summary while Taskflow is open.' : permission === 'denied' ? 'Browser alerts are blocked. Allow notifications for this site in your browser settings.' : permission === 'unsupported' ? 'This browser does not support desktop notifications. Your in-app reminders are still here.' : 'See your due and overdue tasks here. Turn on browser alerts for a daily nudge.';
}
function checkDueNotification() {
  if (!state.user || !('Notification' in window) || Notification.permission !== 'granted') return;
  const tasks = dueReminderTasks();
  if (!tasks.length) return;
  const key = `taskflow-reminder-${state.user.id}-${localDayKey()}`;
  try { if (localStorage.getItem(key)) return; } catch { return; }
  const overdue = tasks.filter(task => task.dueDate < localDayKey()).length;
  const today = tasks.length - overdue;
  const summary = [today ? `${today} due today` : '', overdue ? `${overdue} overdue` : ''].filter(Boolean).join(' · ');
  try {
    const notification = new Notification(`Taskflow · ${tasks.length} task${tasks.length === 1 ? '' : 's'} to check`, { body: summary, tag: key });
    notification.onclick = () => { window.focus(); $('#notification-panel').hidden = false; $('#notification-button').setAttribute('aria-expanded', 'true'); renderReminders(); notification.close(); };
    localStorage.setItem(key, 'sent');
  } catch { /* In-app reminders remain available if browser alerts are unavailable. */ }
}
const notificationButton = $('#notification-button');
const notificationPanel = $('#notification-panel');
notificationButton.addEventListener('click', () => {
  const opening = notificationPanel.hidden;
  notificationPanel.hidden = !opening;
  notificationButton.setAttribute('aria-expanded', String(opening));
  if (opening) renderReminders();
});
$('#enable-notifications').addEventListener('click', async () => {
  if (!('Notification' in window)) return;
  try {
    const permission = await Notification.requestPermission();
    renderReminders();
    if (permission === 'granted') { checkDueNotification(); toast('Browser reminders are on.'); }
  } catch { toast('Could not enable browser reminders.'); }
});
notificationPanel.addEventListener('click', event => {
  const item = event.target.closest('[data-reminder-task]');
  if (!item) return;
  const task = state.tasks.find(entry => entry.id === item.dataset.reminderTask);
  if (!task) return;
  state.view = 'all'; state.status = 'all'; state.query = '';
  $('#search-input').value = '';
  $$('.chip').forEach(chip => chip.classList.toggle('active', chip.dataset.status === 'all'));
  render();
  notificationPanel.hidden = true;
  notificationButton.setAttribute('aria-expanded', 'false');
  document.querySelector(`[data-id="${task.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
});
document.addEventListener('click', event => {
  if (!event.target.closest('.notification-wrap')) {
    notificationPanel.hidden = true;
    notificationButton.setAttribute('aria-expanded', 'false');
  }
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkDueNotification(); });
setInterval(() => {
  if (state.user) {
    renderReminders();
    checkDueNotification();
  }
}, 30000);