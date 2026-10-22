// Used only by the explicitly PRIVATE fixture preparation workflow.
import XCTest
import CryptoKit
@testable import Podium

final class WebFixtureExportTests: XCTestCase {
    func testPreparePrivateBrowserFixture() throws {
        let repo = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
        let ipsw = repo.appendingPathComponent(".reference-firmware/iPod4,1_6.1.6_10B500_Restore.ipsw")
        let output = repo.appendingPathComponent(".browser-fixture", isDirectory: true)
        try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
        let parsed = try IPSWParser.parse(fileURL: ipsw)
        let firmware = ImportedFirmware(id: UUID(), metadata: parsed.metadata, compatibility: parsed.compatibility,
                                       importedAt: Date(), storedFileName: ipsw.lastPathComponent, isActive: true)
        let bundle = Bundle.main
        func resource(_ name: String, _ ext: String) throws -> Data {
            try Data(contentsOf: XCTUnwrap(bundle.url(forResource: name, withExtension: ext)))
        }
        let image = try RootFilesystemPreparer.prepare(firmwareAt: ipsw,
            keybagBootstrap: Array(try resource("keybag_bootstrap", "bin")),
            syncDaemon: Array(try resource("podium_syncd", "bin")),
            firstBootState: try resource("first_boot_state", "plist"),
            bootReadFiles: String(decoding: try resource("boot_read_files", "txt"), as: UTF8.self).split(separator: "\n").map(String.init))
        try RootFilesystemPreparer.validateGuestDiskBackup(at: image)
        let kernel = try KernelcacheExtractor.extractKernelMachO(from: firmware, storedAt: ipsw)
        let tree = try DeviceTreeExtractor.extractDeviceTree(from: firmware, storedAt: ipsw)
        XCTAssertEqual(SHA256.hash(data: kernel).map { String(format: "%02x", $0) }.joined(),
                       "415717e559c48fcf8a2aedec05d3ed2efa6312b11de942acd1c56629b72192ef")
        try kernel.write(to: output.appendingPathComponent("kernel.macho"))
        try tree.write(to: output.appendingPathComponent("devicetree.bin"))
        try FileManager.default.moveItem(at: image, to: output.appendingPathComponent("root.hfs"))
        let manifest: [String: Any] = ["version": 1, "device": "iPod4,1", "build": "10B500", "ios": "6.1.6",
            "kernel": "kernel.macho", "deviceTree": "devicetree.bin", "disk": "root.hfs",
            "diskSize": UInt64(8) * 1024 * 1024 * 1024, "guestBootVerified": false,
            "note": "Prepared disk only. Browser SpringBoard and graphics are NOT verified."]
        try JSONSerialization.data(withJSONObject: manifest, options: [.sortedKeys, .prettyPrinted])
            .write(to: output.appendingPathComponent("manifest.json"))
        print("PRIVATE_BROWSER_FIXTURE_PREPARED: kernel, device tree and validated 8 GiB HFS volume; guest boot unverified")
    }
}

