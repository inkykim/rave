<script lang="ts">
  import { stores } from "./lib/stores.svelte"
  import { wsClient } from "./main"
  import { onMount } from "svelte"

  // Reactive shortcuts
  const connection = $derived(stores.connection.state)
  const tick = $derived(stores.buffer.tick)
  const bytes = $derived(stores.buffer.bytes)
  const rig = $derived(stores.rig.rig)
  const layoutPads = $derived(stores.rig.effectiveLayout?.pages[0]?.pads.length ?? 0)
  const presetsCount = $derived(stores.presets.presets.length)
  const errors = $derived(stores.errors.entries)
  const url = $derived(stores.connection.url)

  // First 64 bytes for a quick hex dump
  const hexDump = $derived.by(() => {
    const lines: string[] = []
    for (let row = 0; row < 4; row++) {
      const offset = row * 16
      const hex = Array.from(bytes.slice(offset, offset + 16))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(" ")
      lines.push(`${offset.toString(16).padStart(4, "0")}  ${hex}`)
    }
    return lines.join("\n")
  })

  onMount(() => {
    wsClient.connect()
  })
</script>

<header>
  <strong>rave</strong>
  <span class="chip {connection}" data-conn-state={connection}>
    <span class="dot"></span>
    {connection}
  </span>
  <span>tick {tick}</span>
  {#if rig}
    <span>{rig.fixtures.length} fixtures</span>
    <span>{layoutPads} pads</span>
    <span>{presetsCount} presets</span>
  {/if}
  <span class="url">{url}</span>
</header>

<main>
  {#if connection === "connecting" || connection === "awaiting_hello"}
    <p>Connecting to daemon…</p>
  {:else if connection === "ready"}
    <h2>Buffer (first 64 bytes)</h2>
    <pre class="hex-dump">{hexDump}</pre>
  {:else if connection === "reconnecting"}
    <p>Reconnecting…</p>
  {:else}
    <p>Daemon offline.</p>
  {/if}
</main>

<div class="errors" role="alert" aria-live="polite">
  {#each errors.slice(-3) as err (err.id)}
    <div class="err">{err.code}: {err.message}</div>
  {/each}
</div>
