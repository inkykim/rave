import { resolve } from "node:path"
import { loadProfiles } from "./profile-loader"
import { loadRig } from "./rig-loader"
import { UniverseBuffer } from "./buffer"
import { TickLoop } from "./tick"
import { IdentityTransform } from "./buffer-transform"
import { NullSink } from "./sinks/null-sink"
import { PresetController } from "./preset-controller"
import { AuditLog } from "./audit-log"
import { startWsServer } from "./ws-server"

const ROOT = resolve(import.meta.dir, "../../..")
const PROFILES_DIR = resolve(ROOT, "profiles")
const RIG_PATH = resolve(ROOT, "config/rig.example.json")
const PRESETS_PATH = resolve(ROOT, "presets.json")
const LAYOUT_PATH = resolve(ROOT, "apps/web/src/layouts/default-v1.json")
const AUDIT_PATH = resolve(ROOT, "audit.log")

const ALLOW_DESTRUCTIVE = process.env.RAVE_ALLOW_DESTRUCTIVE === "true"

async function main(): Promise<void> {
  console.log(`[rave] starting…`)

  const profiles = await loadProfiles(PROFILES_DIR)
  console.log(`[rave]   profiles: ${Object.keys(profiles).join(", ")}`)

  const rig = await loadRig(RIG_PATH, profiles)
  console.log(`[rave]   rig: ${rig.fixtures.length} fixtures on universe ${rig.config.universe}`)
  for (const f of rig.fixtures) {
    console.log(`[rave]     - ${f.id}: ${f.profile}/${f.mode} @ ${f.start}..${f.start + f.width - 1}`)
  }

  const universes = Array.from(new Set(rig.fixtures.map((f) => f.universe ?? rig.config.universe)))
  const buffer = new UniverseBuffer(universes)

  const presets = new PresetController(PRESETS_PATH, buffer, rig.config.universe)
  await presets.load()
  console.log(`[rave]   presets: ${presets.list().length} loaded from ${PRESETS_PATH}`)

  const audit = new AuditLog(AUDIT_PATH)
  const sink = new NullSink()
  const transform = new IdentityTransform()

  const tick = new TickLoop({
    buffer,
    transform,
    sink,
    universes,
  })
  tick.start()
  console.log(`[rave]   tick: 40 Hz on universe(s) ${universes.join(", ")}`)
  console.log(`[rave]   destructive verbs: ${ALLOW_DESTRUCTIVE ? "ENABLED" : "blocked (set RAVE_ALLOW_DESTRUCTIVE=true to enable)"}`)

  const server = await startWsServer({
    rig,
    profiles,
    buffer,
    presets,
    layoutPath: LAYOUT_PATH,
    audit,
    allowDestructive: ALLOW_DESTRUCTIVE,
  })

  console.log(`[rave] ready`)

  const stop = (signal: string): void => {
    console.log(`\n[rave] received ${signal}, shutting down…`)
    tick.stop()
    server.stop(true)
    process.exit(0)
  }
  process.on("SIGINT", () => stop("SIGINT"))
  process.on("SIGTERM", () => stop("SIGTERM"))
}

main().catch((err) => {
  console.error(`[rave] fatal:`, err)
  process.exit(1)
})
