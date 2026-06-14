import "./app.css"
import { mount } from "svelte"
import App from "./App.svelte"
import { stores } from "./lib/stores.svelte"
import { WSClient } from "./lib/ws-client"

// HMR-surviving singleton WSClient. globalThis registration keeps a single
// instance across Vite hot reloads; the dispose hook detaches per-module
// listeners without closing the live socket.
type WSHolder = { client: WSClient }
const holder: WSHolder =
  ((globalThis as { __raveWS?: WSHolder }).__raveWS) ?? { client: new WSClient(stores) }
;(globalThis as unknown as { __raveWS: WSHolder }).__raveWS = holder

export const wsClient = holder.client

if (import.meta.hot) {
  import.meta.hot.accept()
  import.meta.hot.dispose(() => {
    holder.client.detachModuleListeners()
  })
}

const target = document.getElementById("app")
if (!target) throw new Error("missing #app element")

const app = mount(App, { target })

export default app
