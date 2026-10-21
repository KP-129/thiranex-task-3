let taskSocket = null;
function connectTaskSocket() {
  if (!state.user || !window.io) return;
  if (taskSocket) taskSocket.disconnect();
  taskSocket = window.io({ withCredentials: true });
  taskSocket.on('tasks:changed', async () => {
    if (!state.user) return;
    try { await loadTasks(); }
    catch (error) { console.warn('Live task refresh failed:', error.message); }
  });
  taskSocket.on('connect_error', error => console.warn('Live updates unavailable:', error.message));
}
window.addEventListener('taskflow:signedin', connectTaskSocket);
window.addEventListener('taskflow:signedout', () => {
  if (taskSocket) taskSocket.disconnect();
  taskSocket = null;
});
if (state.user) connectTaskSocket();