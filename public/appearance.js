const appearanceButton = document.querySelector('#appearance-button');
const appearancePanel = document.querySelector('#appearance-panel');
const appearanceIcon = document.querySelector('#appearance-icon');
function setAppearance(theme, save = true) {
  const selected = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = selected;
  appearanceIcon.innerHTML = selected === 'dark'
    ? '<path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z"/>'
    : '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/>';
  appearanceButton.setAttribute('aria-label', `${selected === 'dark' ? 'Dark' : 'Light'} appearance selected`);
  document.querySelectorAll('[data-theme-choice]').forEach(button => {
    const active = button.dataset.themeChoice === selected;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  if (save) { try { localStorage.setItem('taskflow-theme', selected); } catch { /* Appearance still applies for this session. */ } }
}
appearanceButton.addEventListener('click', () => {
  const opening = appearancePanel.hidden;
  appearancePanel.hidden = !opening;
  appearanceButton.setAttribute('aria-expanded', String(opening));
});
appearancePanel.addEventListener('click', event => {
  const option = event.target.closest('[data-theme-choice]');
  if (!option) return;
  setAppearance(option.dataset.themeChoice);
  appearancePanel.hidden = true;
  appearanceButton.setAttribute('aria-expanded', 'false');
});
document.addEventListener('click', event => {
  if (!event.target.closest('.appearance-wrap')) {
    appearancePanel.hidden = true;
    appearanceButton.setAttribute('aria-expanded', 'false');
  }
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    appearancePanel.hidden = true;
    appearanceButton.setAttribute('aria-expanded', 'false');
  }
});
try { setAppearance(localStorage.getItem('taskflow-theme') || 'light', false); }
catch { setAppearance('light', false); }