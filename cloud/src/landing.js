import { layout, googleButton } from './pages.js';
export function landingPage({ ready }) {
  return layout('Study Notebook', `<div class="sheet"><h1>Study Notebook</h1><p>Study with Claude; your notes save themselves.</p>
  <div class="actions">${ready ? googleButton('/app/') : '<p class="muted">Sign-in opens soon.</p>'}</div></div>`);
}
