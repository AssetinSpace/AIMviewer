// RoomScanner — minimal RoomPlan -> CapturedRoom JSON exporter (AIM experiment D-078).
//
// ⚠️ UNTESTED SCAFFOLD: written without access to a LiDAR device or even Xcode.
// RoomPlan REQUIRES a physical device with a LiDAR scanner (iPhone 12 Pro or newer
// Pro-line iPhone, or a LiDAR iPad Pro) and iOS 16+. It does not work in the
// Simulator at all (RoomCaptureSession.isSupported == false there).
//
// Project setup (no .xcodeproj is committed — create one, it's 2 minutes):
//   1. Xcode -> New Project -> iOS App, name "RoomScanner", SwiftUI lifecycle.
//   2. Replace the generated source files with the files in this folder.
//   3. Info.plist: add NSCameraUsageDescription ("Scans the room with LiDAR").
//   4. Deployment target iOS 16.0+, run on a physical LiDAR device.

import SwiftUI

@main
struct RoomScannerApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
