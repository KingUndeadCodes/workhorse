import { mount } from 'svelte'
import './app.css'
// Side-effect import: sets data-theme on <html> as soon as the app boots (see stores/theme.ts),
// not just once Settings happens to be visited — otherwise a saved dark-mode choice wouldn't
// apply until the user opened the tab that imports it.
import './lib/stores/theme'
import App from './App.svelte'

const app = mount(App, {
  target: document.getElementById('app')!,
})

export default app
