// Single-screen UI: capture view + start/stop + share exported JSON.
// ⚠️ Untested without hardware — see RoomScannerApp.swift.

import SwiftUI
import RoomPlan

struct ContentView: View {
    @StateObject private var controller = ScanController()
    @State private var showShareSheet = false

    var body: some View {
        ZStack(alignment: .bottom) {
            if ScanController.isSupported {
                RoomCaptureViewRepresentable(controller: controller)
                    .ignoresSafeArea()
            } else {
                // Simulator or non-LiDAR device
                Text("RoomPlan needs a LiDAR device\n(iPhone 12 Pro+ / LiDAR iPad Pro)")
                    .multilineTextAlignment(.center)
                    .padding()
            }
            controls
        }
        .sheet(isPresented: $showShareSheet) {
            if let url = controller.exportedJSONURL {
                // "Save to Files" in this sheet, then AirDrop to a Mac and feed
                // the JSON to converter/roomplan_to_ifc.py by hand.
                ShareSheet(items: [url])
            }
        }
    }

    @ViewBuilder private var controls: some View {
        VStack(spacing: 12) {
            switch controller.phase {
            case .idle:
                Button("Start scan") { controller.startScan() }
                    .buttonStyle(.borderedProminent)
            case .scanning:
                Button("Stop & process") { controller.stopScan() }
                    .buttonStyle(.borderedProminent)
                    .tint(.red)
            case .processing:
                ProgressView("Processing scan…")
            case .done:
                Label("Scan captured", systemImage: "checkmark.circle.fill")
                    .foregroundStyle(.green)
                Button("Export JSON") { showShareSheet = true }
                    .buttonStyle(.borderedProminent)
                Button("Scan again") { controller.startScan() }
            case .failed(let message):
                Text("Failed: \(message)").foregroundStyle(.red)
                Button("Retry") { controller.startScan() }
                    .buttonStyle(.borderedProminent)
            }
        }
        .padding()
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 16))
        .padding(.bottom, 24)
    }
}

/// SwiftUI wrapper for the UIKit RoomCaptureView owned by ScanController.
struct RoomCaptureViewRepresentable: UIViewRepresentable {
    let controller: ScanController

    func makeUIView(context: Context) -> RoomCaptureView { controller.captureView }
    func updateUIView(_ uiView: RoomCaptureView, context: Context) {}
}

/// UIActivityViewController wrapper (share sheet -> Save to Files / AirDrop).
struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }
    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}
