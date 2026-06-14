/**
 * FeedbackSpec registry. v1 web renderer uses these names to derive pad/cell
 * colors from buffer state. v2 Launchpad daemon will consume the same names
 * to drive MIDI SysEx RGB output.
 *
 * Functions execute renderer-side, NOT on the daemon. The daemon only knows
 * about the name; each renderer holds its own implementation of the named
 * function. This keeps the layout schema pure data and the daemon ignorant
 * of layout.
 */
export type FeedbackFnName = "constant" | "lampState" | "fixtureColor" | "presetActive"

export const FEEDBACK_FN_NAMES: ReadonlyArray<FeedbackFnName> = [
  "constant",
  "lampState",
  "fixtureColor",
  "presetActive",
]

export type FeedbackFnDescriptor = {
  name: FeedbackFnName
  /** Human-readable description used by `describe`. */
  description: string
  /** Names of args this function reads (for docs / discoverability). */
  argNames: ReadonlyArray<string>
}

export const FEEDBACK_REGISTRY: Record<FeedbackFnName, FeedbackFnDescriptor> = {
  constant: {
    name: "constant",
    description: "Constant CSS color, ignores state.",
    argNames: ["color"],
  },
  lampState: {
    name: "lampState",
    description: "Bright when the fixture's lamp byte is in lamp-on range; dim otherwise.",
    argNames: ["fixture"],
  },
  fixtureColor: {
    name: "fixtureColor",
    description: "Color derived from the fixture's wheel byte or CMY mix.",
    argNames: ["fixture"],
  },
  presetActive: {
    name: "presetActive",
    description: "Bright when the named preset matches the current buffer state.",
    argNames: ["name"],
  },
}
