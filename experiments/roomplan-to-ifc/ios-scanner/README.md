# RoomScanner — iOS RoomPlan → JSON scaffold (Track B)

Minimal single-screen SwiftUI app: scan a room with RoomPlan, encode the resulting
`CapturedRoom` to JSON, hand it off via the share sheet (Save to Files / AirDrop).
The JSON is the input for `../converter/roomplan_to_ifc.py`.

> ⚠️ **Entirely untested scaffold.** This environment has no LiDAR hardware, no iOS
> simulator, and no Xcode — the code compiles "on paper" against the documented
> RoomPlan API but has never been run. Expect to fix small things on first build.
> Comments mark the specific guesses (`⚠️`).

## Hardware requirement (hard)

RoomPlan needs a **physical device with a LiDAR scanner**: iPhone 12 Pro or newer
Pro/Pro Max, or a LiDAR-equipped iPad Pro, running **iOS 16+**. It does not work in
the Simulator (`RoomCaptureSession.isSupported == false`); the app shows a notice
instead of crashing there.

## Setup (no .xcodeproj committed)

1. Xcode → New Project → iOS App → name `RoomScanner`, interface SwiftUI.
2. Delete the template `ContentView.swift`/`…App.swift`, drag in the three files
   from `RoomScanner/`.
3. Target settings: iOS 16.0 deployment target; Info.plist key
   `NSCameraUsageDescription` = "Scans the room with LiDAR".
4. Build to a physical LiDAR device (needs a dev-signing team, default settings fine).

## Flow

`Start scan` → walk the room (RoomPlan's built-in overlay guides you) → `Stop &
process` → RoomPlan post-processes → `Export JSON` → share sheet → **Save to Files**
or AirDrop to a Mac → run the converter:

```bash
python3 ../converter/roomplan_to_ifc.py room-scan-<timestamp>.json
```

## The one important nuance

`CapturedRoom.export(to:exportOptions:)` **only writes USD/USDZ** (plus optionally a
plist). The JSON our converter consumes is produced by encoding the `Codable` struct
directly — `JSONEncoder().encode(capturedRoom)` — see `ScanController.exportJSON`.
Do not swap it for `.export()`.
