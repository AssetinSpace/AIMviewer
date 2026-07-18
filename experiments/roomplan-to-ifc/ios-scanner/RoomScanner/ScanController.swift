// Scan lifecycle + JSON export. ⚠️ Untested without hardware — see RoomScannerApp.swift.

import Foundation
import RoomPlan

/// Owns the RoomCaptureView (UIKit) and receives the processed CapturedRoom.
final class ScanController: NSObject, ObservableObject, RoomCaptureViewDelegate {

    enum Phase {
        case idle, scanning, processing
        case done(CapturedRoom)
        case failed(String)
    }

    @Published var phase: Phase = .idle
    /// Written after a successful scan; fed to the share sheet.
    @Published var exportedJSONURL: URL?

    /// One capture view reused across the app's lifetime (RoomPlan docs pattern).
    /// ⚠️ Guess: recreating it per scan may also work, but reuse is the documented path.
    lazy var captureView: RoomCaptureView = {
        let view = RoomCaptureView(frame: .zero)
        view.delegate = self
        return view
    }()

    static var isSupported: Bool { RoomCaptureSession.isSupported }

    func startScan() {
        phase = .scanning
        exportedJSONURL = nil
        captureView.captureSession.run(configuration: RoomCaptureSession.Configuration())
    }

    func stopScan() {
        phase = .processing
        // Triggers RoomPlan post-processing; result arrives in captureView(didPresent:error:).
        captureView.captureSession.stop()
    }

    // MARK: - RoomCaptureViewDelegate

    /// Return true so RoomPlan runs its built-in post-processing/preview.
    func captureView(shouldPresent roomDataForProcessing: CapturedRoomData, error: Error?) -> Bool {
        true
    }

    /// Final processed result. This is the moment we get the `CapturedRoom` value.
    func captureView(didPresent processedResult: CapturedRoom, error: Error?) {
        if let error {
            phase = .failed(error.localizedDescription)
            return
        }
        do {
            exportedJSONURL = try exportJSON(processedResult)
            phase = .done(processedResult)
        } catch {
            phase = .failed("JSON export failed: \(error.localizedDescription)")
        }
    }

    // MARK: - JSON export

    /// KEY NUANCE (the reason this app exists): `CapturedRoom.export(to:exportOptions:)`
    /// only writes USD/USDZ (+ optionally a plist). To get the JSON our Track A
    /// converter consumes we must encode the Codable struct ourselves:
    private func exportJSON(_ room: CapturedRoom) throws -> URL {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = try encoder.encode(room)

        let stamp = ISO8601DateFormatter().string(from: Date())
            .replacingOccurrences(of: ":", with: "-")
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("room-scan-\(stamp).json")
        try data.write(to: url, options: .atomic)
        return url
    }
}
