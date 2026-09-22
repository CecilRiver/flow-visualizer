import { createApp } from 'vue'

import App from './App.vue'
import { bootstrap } from './app/bootstrap'

// Vue Flow's structural styles must come first so the project's own tokens and
// overrides win on equal specificity.
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'
import '@vue-flow/minimap/dist/style.css'

import './styles/tokens.css'
import './styles/element-overrides.css'
import './styles/app.css'

const app = createApp(App)

bootstrap(app)

app.mount('#app')
