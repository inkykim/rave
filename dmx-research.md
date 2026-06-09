# DMX Signal Processing — Martin MX-4 & Chauvet Legend 5000X

Research notes for building custom software to drive the rig. Both fixtures speak
**USITT DMX512 (1990)** over 3-pin XLR — so the same wire, the same driver, and the
same packet format reach both. The only thing that changes per-fixture is the
channel map and value semantics.

> **Identification note on "Legend 5000":** The closest match for "Legend 5000" in
> the moving-head market is the **Chauvet Legend 5000X (HMI-575)**. Chauvet shipped
> the 5000X and the 6000X as a family — same control architecture, different lamp /
> output. The Chauvet PDF for the 5000X is offline (404 on the official CDN); the
> protocol below is drawn from the publicly archived **Legend 6000X** manual, which
> is structurally identical to the 5000X. Verify channel order against your physical
> fixture's display menu before going live.

---

## 1. The physical layer (what's actually on the wire)

DMX512 is a one-way **EIA-485** differential serial bus.

| Property            | Value                                    |
|---------------------|------------------------------------------|
| Signaling           | EIA-485 differential, unidirectional     |
| Baud rate           | 250 000 bps                              |
| UART framing        | 8 data, no parity, 2 stop (**8N2**)      |
| Slots per universe  | 512 (channels 1–512)                     |
| Connector           | 3-pin or 5-pin XLR (both fixtures: 3-pin)|
| Pinout              | 1 = shield/GND, 2 = data − (cold), 3 = data + (hot) |
| Cable               | 120 Ω twisted pair (mic cable is *not* spec — works short, fails long) |
| Topology            | Daisy-chain, terminate the last fixture with a 120 Ω plug |

### Packet shape

Every DMX frame is a continuous burst out of the transmitter:

1. **BREAK** — line held low ≥ 88 µs (resets all receivers)
2. **MAB** (Mark After Break) — line high ≥ 8 µs
3. **Start Code** — one byte, 0x00 for standard dimmer data
4. **Data slots** — up to 512 bytes, each one a UART frame (start bit, 8 data, 2 stop)

Refresh rate is whatever you can clock out — typically 30–44 Hz. Receivers latch
the last value they saw until the next break.

### Why this matters for software

- You do not bit-bang DMX from a normal computer's UART. You use a USB → DMX bridge
  (Enttec Open DMX, Enttec USB Pro, uDMX, ESP32 with MAX485, etc.) and write a
  512-byte buffer; the bridge handles BREAK/MAB timing.
- Your "signal processing" code is really just **writing bytes into a 512-byte
  array** at the right channel offsets and flushing it at ~30 Hz. Smoothing,
  ramps, chases, music-reactivity — all of that happens in your buffer, before
  the bridge serializes it.

---

## 2. Martin MX-4 — channel map

The MX-4 is a **mirror scanner** with a 150 W discharge lamp. DIP-switch pin 11
plus an internal jumper (PL118) selects the mode:

- **1-channel** (pin 11 ON) — stand-alone trigger only, almost useless for custom
  software.
- **6-channel** (pin 11 OFF, jumper = 6) — full effect control. **Use this.**
- **7-channel** (pin 11 OFF, jumper = 7) — adds color/gobo wheel speed.

Address is the DMX start channel; the fixture consumes 6 or 7 consecutive slots
from there.

### 6/7-channel protocol

| Ch | Name                       | DMX value | Effect                                                              |
|----|----------------------------|-----------|---------------------------------------------------------------------|
| 1  | Shutter / Lamp / Reset     | 0–9       | Shutter closed (blackout)                                           |
|    |                            | 10–19     | **Lamp on**                                                         |
|    |                            | 20–99     | Shutter open                                                        |
|    |                            | 100–159   | Strobe, fast → slow                                                 |
|    |                            | 160–179   | Shutter closed                                                      |
|    |                            | 180–204   | Stand-alone w/ music trigger                                        |
|    |                            | 205–229   | Stand-alone w/ auto trigger                                         |
|    |                            | 230–239   | Shutter closed                                                      |
|    |                            | 240–249   | **Reset** (hold ≥ 5 s)                                              |
|    |                            | 250–255   | **Lamp off** (requires ch2 & ch3 > 252, hold ≥ 5 s)                 |
| 2  | Color wheel                | 0–209     | 15 full + 2 split colors in 6-DMX-unit steps (see color table)      |
|    |                            | 210–255   | Stand-alone color action (trigger via ch1)                          |
| 3  | Gobo wheel                 | 0–239     | 19 gobos + open, 12-DMX-unit steps (see gobo table)                 |
|    |                            | 240–255   | Stand-alone gobo action (trigger via ch1)                           |
| 4  | Pan                        | 0–255     | Left → right, 230° span, **127 = neutral**                          |
| 5  | Tilt                       | 0–255     | Up → down, 76.5° span, **127 = neutral**                            |
| 6  | Pan/Tilt speed             | 0–2       | Tracking mode (speed function off — controller crossfades)          |
|    |                            | 3–255     | Fast → slow                                                         |
| 7* | Color/Gobo wheel speed     | 0–255     | Fast → slow *(only if 7-channel jumper set)*                        |

### MX-4 color wheel (channel 2)

The wheel snaps between named gel positions; "split" values straddle two filters.

| Value   | Color                              |
|---------|------------------------------------|
| 0–5     | White                              |
| 12–17   | Light blue 101                     |
| 24–29   | Fern green 205                     |
| 36–41   | Red 304                            |
| 48–53   | Yellow 603                         |
| 60–65   | Magenta 507                        |
| 72–77   | Medium blue 108                    |
| 84–89   | Deep orange 302                    |
| 96–101  | Light green 204                    |
| 108–113 | Cyan 104                           |
| 120–125 | Pink 312                           |
| 132–137 | Blue 111                           |
| 144–149 | Amber 604                          |
| 156–161 | Primary red 308                    |
| 168–173 | Primary green 206                  |
| 180–185 | Orange 306                         |
| 192–197 | Split-color 1                      |
| 204–209 | Split-color 2                      |

(Intermediate values like 6–11 = "white / light blue 101" produce a wheel-spin
between adjacent positions.)

### MX-4 gobo wheel (channel 3)

| Value     | Gobo          |
|-----------|---------------|
| 0–11      | Open          |
| 12–23     | Worms 2       |
| 24–35     | Web           |
| 36–47     | Petals        |
| 48–59     | Spokes        |
| 60–71     | Cone 2        |
| 72–83     | Maze          |
| 84–95     | Crater        |
| 96–107    | Holes 2       |
| 108–119   | Cross 2       |
| 120–131   | Jagged cross  |
| 132–143   | Atomic        |
| 144–155   | Dot circle    |
| 156–167   | Nordic        |
| 168–179   | Aim           |
| 180–191   | Spokes 2      |
| 192–203   | Tie           |
| 204–215   | Nova          |
| 216–227   | Triple beam   |
| 228–239   | Dot 2         |

### Operational gotchas

- **Discharge lamp strike inrush.** When sending lamp-on commands to multiple
  fixtures, stagger by 5 s. Simultaneous strikes can trip breakers or fail to
  ignite. Bake this into your software's startup routine.
- **Hot restart.** A hot lamp must cool ~several minutes before restriking. If
  ignition fails, send lamp-off and wait.
- **Lamp-off guard.** The lamp-off command (ch1 = 250–255) is only honored when
  ch2 *and* ch3 are also > 252. This is a hardware interlock against accidental
  shutdowns — your software must set all three together and hold ≥ 5 s.
- **Reset** (ch1 = 240–249) clears any stuck mirror/wheel state; useful as a
  startup or panic command. Also requires a ≥ 5 s hold.
- **Tracking mode** (ch6 = 0–2) hands movement smoothing back to the controller.
  Use this if your software does its own pan/tilt ramps; use ch6 = 3–255 if you
  want the fixture to interpolate.

---

## 3. Chauvet Legend 5000X — channel map

Moving-yoke fixture with HMI-575 lamp, CMY color mix, color wheel, zoom, and
remote shutter. Two personalities, set from the on-fixture menu:

- **16-bit Pan/Tilt** — 15 channels, fine resolution on movement.
- **8-bit Pan/Tilt** — 13 channels, coarser movement, fewer slots used.

### 16-bit personality (15 channels)

| Ch | Name              | DMX value | Effect                                              |
|----|-------------------|-----------|-----------------------------------------------------|
| 1  | Dimmer            | 0–255     | Closed → open (0–100 %)                             |
| 2  | Shutter / Strobe  | 0–1       | Blackout                                            |
|    |                   | 2–7       | Open                                                |
|    |                   | 8–63      | Strobe slow → fast (max 7 fps)                      |
|    |                   | 64–71     | Open                                                |
|    |                   | 72–127    | Pulse strobe (dark → bright) slow → fast            |
|    |                   | 128–135   | Open                                                |
|    |                   | 136–191   | Pulse strobe (bright → dark) slow → fast            |
|    |                   | 192–199   | Open                                                |
|    |                   | 200–253   | Random strobe slow → fast                           |
|    |                   | 254–255   | Open                                                |
| 3  | Color wheel       | 0–17      | White (open)                                        |
|    |                   | 18–35     | Red                                                 |
|    |                   | 36–51     | Blue                                                |
|    |                   | 52–71     | Green                                               |
|    |                   | 72–89     | Purple                                              |
|    |                   | 90–107    | 5000 K correction                                   |
|    |                   | 108–127   | 3200 K correction                                   |
|    |                   | 128–187   | Rainbow spin CW, fast → slow                        |
|    |                   | 188–195   | Stop                                                |
|    |                   | 196–255   | Rainbow spin CCW, slow → fast                       |
| 4  | Cyan              | 0–255     | 0 → 100 %                                           |
| 5  | Magenta           | 0–255     | 0 → 100 %                                           |
| 6  | Yellow            | 0–255     | 0 → 100 %                                           |
| 7  | Color macro       | 0–7       | None                                                |
|    |                   | 8–255     | Macros 1–31, 8-unit blocks                          |
| 8  | Beam              | 0–63      | Full beam                                           |
|    |                   | 64–127    | Frost filter                                        |
|    |                   | 128–143   | Flat/wide beam, 0°                                  |
|    |                   | 144–255   | Flat/wide beam, 90° adjustment                      |
| 9  | Zoom              | 0–255     | 10° → 30° linear                                    |
| 10 | Pan (coarse)      | 0–255     | 0° → 570°, **128 = center**                         |
| 11 | Tilt (coarse)     | 0–255     | 0° → 270°, **128 = center**                         |
| 12 | Pan fine          | 0–255     | LSB of 16-bit pan                                   |
| 13 | Tilt fine         | 0–255     | LSB of 16-bit tilt                                  |
| 14 | Control           | 0–7       | Smooth Pan/Tilt (internal ramp on)                  |
|    |                   | 8–63      | Fast Pan/Tilt (internal ramp off)                   |
|    |                   | 64–127    | Color calibration mode — ch3/4/5/12/13 reassign     |
|    |                   | 128–191   | Save calibration (hold 3 s)                         |
|    |                   | 192–255   | Reset all motors (hold 3 s)                         |
| 15 | Lamp on/off       | 0–47      | Standby                                             |
|    |                   | 48–95     | Hold 3 s for **lamp on**                            |
|    |                   | 96–159    | Standby                                             |
|    |                   | 160–207   | Hold 3 s for **lamp off**                           |
|    |                   | 208–255   | Standby                                             |

### 8-bit personality (13 channels)

Same as 16-bit but channels 12 and 13 (pan fine, tilt fine) are removed; control
and lamp on/off shift down to channels 12 and 13.

### 16-bit pan/tilt math

Compose a 16-bit value `v` from two bytes:

```
v       = (coarse << 8) | fine        # 0..65535
coarse  = v >> 8
fine    = v & 0xFF
```

Pan range is 0–570°, tilt 0–270°. To target an angle:

```
pan_value  = round(angle_deg / 570 * 65535)
tilt_value = round(angle_deg / 270 * 65535)
```

### Operational gotchas

- **HMI strike inrush.** Same warning as the MX-4 — stagger lamp-on commands.
  Both fixtures share the same risk profile.
- **3-second holds.** Lamp on/off, reset, and save-calibration all require the
  DMX value to be held for 3 s. Your software needs a "hold" primitive, not a
  fire-and-forget.
- **Don't dim with a dimmer pack.** Discharge lamps must not be fed through a
  rheostat. Use the channel-1 dimmer (mechanical) for intensity, not upstream AC
  control.
- **Color macro vs. CMY.** When channel 7 (macro) is non-zero, it overrides the
  CMY mix on channels 4–6. Decide in software which one is authoritative for a
  given cue.
- **Pan/Tilt invert and DMX channel reassign** live in the on-fixture menu, not
  DMX. Lock these to a known state at install time.

---

## 4. Hardware bridges (PC ↔ DMX)

Pick one. The first column dictates your software stack.

| Bridge                        | Protocol            | Notes                                                                                  |
|-------------------------------|---------------------|----------------------------------------------------------------------------------------|
| **Enttec DMX USB Pro**        | FTDI + framed serial| Industry standard. Bridge handles BREAK/MAB. Best Python/Node/Go support. ~$140.       |
| Enttec Open DMX USB           | FTDI raw            | Cheaper. Host CPU must generate BREAK timing → jitter on non-realtime OS. ~$70.        |
| uDMX (Anyma / clones)         | USB control xfer    | Cheap, fine for small rigs. Supported by libusb-based libraries.                       |
| ESP32 + MAX485                | UART + RMT          | DIY. ESP32 UART at 250 kbps + RMT for BREAK. Great for WiFi-bridged setups.            |
| Art-Net / sACN node           | UDP over Ethernet   | If you go network-first. Most "lighting consoles" speak Art-Net natively.              |

For a custom-software project on a laptop or Pi, **Enttec USB Pro + OLA or a
Python library** is the standard path. If you want zero hardware, build an
Art-Net source in software and route it to a $30 Art-Net-to-DMX node.

---

## 5. Software stack options

### Python (fastest path to "lights move from a script")

- **OLA** (Open Lighting Architecture) — daemon (`olad`) that abstracts every
  bridge and network protocol; your code just writes to a universe. C++ core,
  Python client. Linux/macOS first-class, Windows partial.
- **DMXEnttecPro** — direct Pro support, auto-flush on channel change.
- **pySimpleDMX** / **DmxPy** — minimal wrappers around the Pro's serial frame.
- **PyDMXControl** — higher-level fixture/scene model; supports Open DMX, uDMX.

### Other ecosystems

- **Node.js** — `dmx`, `node-dmx-ts`, `enttec-open-dmx-usb` (Open DMX via FTDI).
- **Go** — `go-dmx`, OLA Go bindings.
- **C/C++** — talk to OLA directly, or libftdi for Open DMX.
- **Rust** — `dmx-serial`, `open-dmx`.

### Recommended baseline

```
Your code  ──►  Universe buffer (512 bytes)  ──►  OLA  ──►  Enttec USB Pro  ──►  XLR  ──►  MX-4  ──►  Legend 5000X
```

OLA gives you Art-Net, sACN, multiple bridges, and a web UI for free. Your
software writes to `dmx.send_dmx(universe=1, data=bytearray(...))` and stops
caring about wire details.

---

## 6. Software architecture for the custom command layer

What "custom commands" probably needs underneath:

1. **Universe buffer** — single 512-byte `bytearray`, source of truth.
2. **Fixture abstraction** — per-fixture class that knows its start address and
   channel map; exposes semantic setters (`mx4.color("Red 304")`,
   `legend.point(pan=270, tilt=135)`, `legend.cmy(0, 255, 64)`).
3. **Tick loop** — flush buffer to the bridge at 30–44 Hz, regardless of whether
   anything changed. Receivers expect continuous frames; long gaps re-trigger
   BREAK handling and can cause flicker.
4. **Ramp/curve engine** — interpolate target values over time. Necessary because
   raw DMX writes step instantly; smooth fades and chases live in software.
5. **Hold primitive** — for the 3–5 s lamp/reset commands. Don't open-loop these.
6. **Strike scheduler** — sequence lamp-on commands with ≥ 5 s gaps.
7. **Cue / scene layer** — named groups of fixture states; transitions between
   them with timing.
8. **Trigger surface** — MIDI in, audio FFT for beat-reactive, OSC, keyboard,
   web UI — whatever wants to fire cues.

### Skeleton (Python + OLA, illustrative)

```python
from ola.ClientWrapper import ClientWrapper
import array, threading, time

UNIVERSE = 1
FRAME = array.array('B', [0] * 512)
LOCK = threading.Lock()

def set_channel(addr, value):
    with LOCK:
        FRAME[addr - 1] = value & 0xFF

class MX4:
    def __init__(self, start):
        self.start = start
    def lamp_on(self):  set_channel(self.start + 0, 15)
    def open(self):     set_channel(self.start + 0, 50)
    def color(self, v): set_channel(self.start + 1, v)
    def gobo(self, v):  set_channel(self.start + 2, v)
    def pan(self, v):   set_channel(self.start + 3, v)
    def tilt(self, v):  set_channel(self.start + 4, v)
    def speed(self, v): set_channel(self.start + 5, v)

class Legend5000X:
    def __init__(self, start):
        self.start = start
    def dim(self, v):     set_channel(self.start + 0, v)
    def cmy(self, c, m, y):
        set_channel(self.start + 3, c)
        set_channel(self.start + 4, m)
        set_channel(self.start + 5, y)
    def point16(self, pan16, tilt16):
        set_channel(self.start + 9,  (pan16  >> 8) & 0xFF)
        set_channel(self.start + 10, (tilt16 >> 8) & 0xFF)
        set_channel(self.start + 11,  pan16  & 0xFF)
        set_channel(self.start + 12,  tilt16 & 0xFF)

def pump(wrapper):
    client = wrapper.Client()
    def tick():
        with LOCK:
            client.SendDmx(UNIVERSE, FRAME, lambda s: None)
        wrapper.AddEvent(25, tick)   # ~40 Hz
    tick()

if __name__ == "__main__":
    mx4    = MX4(start=1)            # ch 1–6
    legend = Legend5000X(start=10)   # ch 10–24
    wrapper = ClientWrapper()
    pump(wrapper)
    wrapper.Run()
```

This is intentionally bare — no scenes, no ramps, no MIDI. It's the minimum
viable signal-processing layer: a buffer, a 40 Hz pump, and semantic helpers
mapped to the channel tables above.

---

## 7. Practical addressing recommendation

Lay out the universe with headroom between fixtures so personality changes
(6-ch vs 7-ch on MX-4, 13-ch vs 15-ch on Legend) don't force renumbering.

| Fixture          | Start | End | Mode used in this doc |
|------------------|-------|-----|-----------------------|
| MX-4 #1          | 1     | 7   | 7-channel             |
| MX-4 #2          | 11    | 17  | 7-channel             |
| Legend 5000X #1  | 21    | 35  | 16-bit (15 ch)        |
| Legend 5000X #2  | 41    | 55  | 16-bit (15 ch)        |

Set each fixture's start address via its on-board menu (Legend) or DIP switches
(MX-4). Document this in your software config — it's the only thing the host
program needs to know to find each fixture in the buffer.

---

## 8. Things to verify against your actual rig before writing code

- [ ] Confirm Legend model number on the fixture nameplate (5000X vs 6000X vs
      something else marketed as "Legend 5000").
- [ ] Walk the on-fixture menu and note the **personality** (16-bit vs 8-bit)
      and **DMX start address** of each Legend.
- [ ] On each MX-4, read DIP switch state for **DMX mode** (pin 11) and check
      the **6/7-ch jumper** (PL118) inside the head.
- [ ] Confirm cabling: 3-pin XLR, daisy-chained, 120 Ω terminator on the last
      fixture. Mic cable works but introduces errors over distance.
- [ ] Pick the bridge: Enttec USB Pro is the safe default.
- [ ] Pick the stack: OLA + Python is the safe default.

---

## 9. Sources

- Martin MX-4 user manual (lightparts.com PDF mirror) — full DMX protocol,
  channel maps, color and gobo tables.
- Chauvet Legend 6000X user manual (Internet Archive, manualzz-id-1208512) —
  DMX channel summary and value tables for the Legend family.
- Chauvet Legend 5000X product page (Solotech, B&H, Musician's Friend) —
  HMI-575, 14/16-channel personalities confirmed.
- USITT DMX512-A (1990 + 2008 revisions) — physical-layer and packet format.
- Open Lighting Architecture — <https://www.openlighting.org/ola/>
- DMXEnttecPro — <https://pypi.org/project/DMXEnttecPro/>
- PyDMXControl — <https://pypi.org/project/PyDMXControl/>
- pySimpleDMX — <https://github.com/c0z3n/pySimpleDMX>
- DMX512 on Wikipedia — packet timing reference.
- Adafruit "Intro to DMX" — physical-layer primer.
