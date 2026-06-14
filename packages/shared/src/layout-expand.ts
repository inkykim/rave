import type { ControlSurfaceLayout, PadDef } from "./layout"
import type { RigConfig } from "./rig"
import type { Profile } from "./profile"

/**
 * Expands an authored layout with procedurally generated per-fixture rows.
 *
 * The author writes only the master-controls page. For each fixture in the
 * rig, this function appends a row with a color picker pad and (if the
 * fixture has a Gobo channel) a gobo picker pad.
 *
 * Used by both the daemon (when constructing `hello.effectiveLayout`) and
 * the web app's Palette renderer. Keeping it in `@rave/shared` means agents
 * reading `describe` see the same surface the human UI shows.
 */
export function expandLayout(
  authored: ControlSurfaceLayout,
  rig: RigConfig,
  profiles: Record<string, Profile>,
): ControlSurfaceLayout {
  const masterPage = authored.pages.find((p) => p.name === "main")
  if (!masterPage) return authored

  const masterRows = computeMaxRow(masterPage.pads) + 1
  const fixturePads: PadDef[] = []

  for (let i = 0; i < rig.fixtures.length; i++) {
    const f = rig.fixtures[i]!
    const row = masterRows + i
    const profile = profiles[f.profile]
    if (!profile) continue
    const mode = profile.modes[f.mode]
    if (!mode) continue

    const hasColorWheel = mode.channels.some((c) => c.type === "ColorWheel")
    const hasCMY = mode.channels.some((c) => c.type === "ColorCMY")
    const hasGobo = mode.channels.some((c) => c.type === "Gobo")

    if (hasColorWheel || hasCMY) {
      // Token pad: client renders an interactive picker; agent sees the intent shape.
      fixturePads.push({
        row,
        col: 0,
        label: `${f.id}: color`,
        pressIntent: hasCMY
          ? { verb: "color", fixture: f.id, spec: { kind: "rgb", hex: "#ffffff" } }
          : { verb: "color", fixture: f.id, spec: { kind: "named", name: "White" } },
      })
    }
    if (hasGobo) {
      fixturePads.push({
        row,
        col: 1,
        label: `${f.id}: gobo`,
        pressIntent: { verb: "gobo", fixture: f.id, name: "open" },
      })
    }
  }

  const totalRows = Math.max(masterPage.grid.rows, masterRows + rig.fixtures.length)
  const expandedMain = {
    ...masterPage,
    grid: { rows: totalRows, cols: masterPage.grid.cols },
    pads: [...masterPage.pads, ...fixturePads],
  }

  return {
    ...authored,
    pages: authored.pages.map((p) => (p.name === "main" ? expandedMain : p)),
  }
}

function computeMaxRow(pads: ReadonlyArray<PadDef>): number {
  let max = -1
  for (const p of pads) if (p.row > max) max = p.row
  return max
}
