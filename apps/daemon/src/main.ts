import { resolve } from "node:path"
import { loadProfiles } from "./profile-loader"
import { loadRig } from "./rig-loader"
import { UniverseBuffer } from "./buffer"
import { TickLoop } from "./tick"
import { IdentityTransform } from "./buffer-transform"
import { NullSink } from "./sinks/null-sink"

const ROOT = resolve(import.meta.dir, "../../..")
const PROFILES_DIR = resolve(ROOT, "profiles")
const RIG_PATH = resolve(ROOT, "config/rig.example.json")

async function main(): Promise<void> {
  console.log(`[rave] starting…`)
  console.log(`[rave]   profiles: ${PROFILES_DIR}`)
  console.log(`[rave]   rig:      ${RIG_PATH}`)

  const profiles = await loadProfiles(PROFILES_DIR)
  console.log(`[rave]   loaded ${Object.keys(profiles).length} profiles: ${Object.keys(profiles).join(", ")}`)

  const rig = await loadRig(RIG_PATH, profiles)
  console.log(`[rave]   loaded rig with ${rig.fixtures.length} fixtures on universe ${rig.config.universe}`)
  for (const f of rig.fixtures) {
    console.log(`[rave]     - ${f.id}: ${f.profile}/${f.mode} @ ${f.start}..${f.start + f.width - 1}`)
  }

  const universes = Array.from(new Set(rig.fixtures.map((f) => f.universe ?? rig.config.universe)))
  const buffer = new UniverseBuffer(universes)
  const sink = new NullSink()
  const transform = new IdentityTransform()

  const tick = new TickLoop({
    buffer,
    transform,
    sink,
    universes,
    onBroadcast: ({ tick, universe }) => {
      if (tick % 200 === 0) {
        console.log(`[tick] universe ${universe} tick ${tick}`)
      }
    },
  })
  tick.start()
  console.log(`[rave] ready — 40 Hz tick running on universe(s) ${universes.join(", ")}`)

  // Graceful shutdown
  const stop = (signal: string): void => {
    console.log(`\n[rave] received ${signal}, shutting down…`)
    tick.stop()
    process.exit(0)
  }
  process.on("SIGINT", () => stop("SIGINT"))
  process.on("SIGTERM", () => stop("SIGTERM"))
}

main().catch((err) => {
  console.error(`[rave] fatal:`, err)
  process.exit(1)
})
