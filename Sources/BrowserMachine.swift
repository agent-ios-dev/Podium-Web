import Foundation
import BrowserHost
import WASILibc

/// Page-sized guest disk I/O stays outside Wasm linear memory. The Worker owns
/// a synchronous OPFS handle and validates all offsets independently.
final class FileBackedStorage {
    struct IOError: Error { let code: Int32 }
    let byteCount: UInt64
    init() throws {
        byteCount = browser_disk_size()
        guard byteCount == UInt64(8) * 1024 * 1024 * 1024 else { throw IOError(code: EINVAL) }
    }
    func read(at offset: UInt64, count: Int) throws -> Data {
        guard count >= 0, count <= 16 << 20, offset <= byteCount, UInt64(count) <= byteCount - offset else { throw IOError(code: EINVAL) }
        var data = Data(count: count)
        let result = data.withUnsafeMutableBytes { browser_disk_read(offset, $0.baseAddress, Int32(count)) }
        guard result == count else { throw IOError(code: EIO) }; return data
    }
    func write(_ data: Data, at offset: UInt64) throws {
        guard data.count <= 16 << 20, offset <= byteCount, UInt64(data.count) <= byteCount - offset else { throw IOError(code: EINVAL) }
        let result = data.withUnsafeBytes { browser_disk_write(offset, $0.baseAddress, Int32(data.count)) }
        guard result == data.count else { throw IOError(code: EIO) }
    }
    func synchronize() throws { guard browser_disk_flush() == 0 else { throw IOError(code: EIO) } }
}

final class BrowserMachine {
    let memory: BrowserMemory
    let bus: SegmentedMemoryBus
    let cpu: ARMv7CPU
    let platform: S5L8930XPlatform
    let display: DisplayScanout
    let disk: FileBackedStorage?
    let pixels: UnsafeMutableRawPointer
    private var paceAnchor: (host: Double, virtual: UInt64)?
    private var buttons: [Int32: (host: Double, virtual: UInt64)] = [:]
    private var releases: [Int32: UInt64] = [:]
    private static let virtualPerSecond = 384_000_000.0
    private func now() -> Double {
        browser_monotonic_seconds()
    }
    func paceLimit() -> UInt64 {
        let host = now(), virtual = cpu.virtualTime
        guard let anchor = paceAnchor else { paceAnchor = (host, virtual); return virtual }
        let allowed = anchor.virtual &+ UInt64(max(0, host - anchor.host) * Self.virtualPerSecond)
        if allowed > virtual, Double(allowed - virtual) / Self.virtualPerSecond > 0.25 {
            paceAnchor = (host, virtual); return virtual
        }
        return allowed
    }
    private func event(_ code: Int32, _ down: Bool) -> InputEvent? {
        switch code { case 0: return .homeButton(pressed: down); case 1: return .powerButton(pressed: down)
        case 2: return .volumeDown(pressed: down); case 3: return .volumeUp(pressed: down); default: return nil }
    }
    func button(_ code: Int32, _ down: Bool) {
        guard let event = event(code, down) else { return }
        if down { buttons[code] = (now(), cpu.virtualTime); platform.handle(event) }
        else if let pressed = buttons.removeValue(forKey: code) {
            let held = min(max(now() - pressed.host, 0), 3)
            releases[code] = pressed.virtual &+ UInt64(held * Self.virtualPerSecond)
        } else { platform.handle(event) }
    }
    func applyReleases() {
        for (code, due) in releases where cpu.virtualTime >= due {
            releases[code] = nil
            if let event = event(code, false) { platform.handle(event) }
        }
    }
    init(kernel: Data, tree: Data, requireDisk: Bool = true) throws {
        // Check the disk and exact kernel before reserving a GiB of guest RAM.
        disk = requireDisk ? try FileBackedStorage() : nil
        let patched = requireDisk ? try GuestDiskBridge.patch(kernel) : kernel
        memory = BrowserMemory(length: GuestMemoryLayout.ramSize, base: GuestMemoryLayout.ramPhysicalBase)
        bus = SegmentedMemoryBus(regions: [memory, BrowserMemory(length: GuestMemoryLayout.lowSRAMSize)])
        cpu = ARMv7CPU(memory: bus)
        cpu.linearMap = (GuestMemoryLayout.kernelVirtualBase, GuestMemoryLayout.ramPhysicalBase, UInt32(GuestMemoryLayout.ramSize))
        GuestAccommodations.install(on: cpu)
        platform = S5L8930XPlatform(cpu: cpu)
        for region in platform.regions { bus.addRegion(region) }
        display = DisplayScanout(memory: bus, dart: platform.dart2, bootFramebuffer: GuestFramebuffer(memory: memory,
            baseAddress: GuestMemoryLayout.framebufferPhysicalAddress, pixelWidth: 640, pixelHeight: 960))
        let boot = try KernelBootstrap.prepare(kernel: patched, deviceTree: tree, on: bus, ramDiskSize: requireDisk ? 4096 : nil)
        if let disk { GuestDiskBridge.install(on: cpu, disk: disk) }
        cpu.reset(); cpu.loadInitialRegisters(boot.initialRegisters)
        cpu.breakpoints = [0x8001_7C10, 0x8001_7F28, 0x801D_F6E8]
        pixels = .allocate(byteCount: 640 * 960 * 4, alignment: 16)
        pixels.initializeMemory(as: UInt8.self, repeating: 0, count: 640 * 960 * 4)
        print("Original 10B500 kernel loaded. This is not SpringBoard/UI proof.")
    }
    deinit { pixels.deallocate() }
}
var machine: BrowserMachine?
var staging: [UnsafeMutableRawPointer: Int] = [:]
@_cdecl("podium_allocate")
func allocate(_ count: Int32) -> UnsafeMutableRawPointer? {
    guard count > 0, count <= 128 << 20, staging.count < 2 else { return nil }
    let p = UnsafeMutableRawPointer.allocate(byteCount: Int(count), alignment: 16); staging[p] = Int(count); return p
}
@_cdecl("podium_release")
func release(_ pointer: UnsafeMutableRawPointer?) { if let pointer, staging.removeValue(forKey: pointer) != nil { pointer.deallocate() } }
@_cdecl("podium_boot")
func boot(_ kernel: UnsafeMutableRawPointer?, _ kernelSize: Int32, _ tree: UnsafeMutableRawPointer?, _ treeSize: Int32) -> Int32 {
    guard machine == nil, let kernel, let tree, staging[kernel] == Int(kernelSize), staging[tree] == Int(treeSize) else { return -1 }
    do {
        machine = try BrowserMachine(kernel: Data(bytes: kernel, count: Int(kernelSize)), tree: Data(bytes: tree, count: Int(treeSize)))
        return 0
    } catch { print("Guest boot preparation failed: \(error)"); return -2 }
}
@_cdecl("podium_machine_run")
func machineRun(_ budget: Int32) -> Int32 {
    guard let machine, budget > 0, budget <= 100_000 else { return -1 }
    machine.applyReleases()
    machine.cpu.idleSkipLimit = machine.paceLimit()
    let count = machine.cpu.run(maxUnits: Int(budget))
    if let error = machine.cpu.lastError { print("Guest CPU halted: \(error)"); return -2 }
    if let address = machine.cpu.hitBreakpoint { print("Guest stop breakpoint \(address.hexString8)"); return -3 }
    return Int32(count)
}
@_cdecl("podium_machine_pc")
func machinePC() -> UInt32 { machine?.cpu.registers.pc ?? 0 }
@_cdecl("podium_guest_ram")
func guestRAM() -> UnsafeMutableRawPointer? { machine?.memory.pointer }
@_cdecl("podium_guest_register")
func guestRegister(_ index: Int32) -> UInt32 { guard let machine, index >= 0, index < 16 else { return 0 }; return machine.cpu.registers[Int(index)] }
@_cdecl("podium_guest_retired")
func guestRetired() -> UInt64 { machine?.cpu.retiredInstructionCount ?? 0 }
@_cdecl("podium_frame")
func frame() -> UnsafeMutableRawPointer? {
    guard let machine else { return nil }
    machine.display.copyCurrentFrame(into: UnsafeMutableRawBufferPointer(start: machine.pixels, count: 640 * 960 * 4))
    return machine.pixels
}
@_cdecl("podium_button")
func button(_ code: Int32, _ down: Int32) {
    guard let machine else { return }
    machine.button(code, down != 0)
}
@_cdecl("podium_touch")
func touch(_ phase: Int32, _ x: Double, _ y: Double) {
    guard let machine, x >= 0, x <= 640, y >= 0, y <= 960 else { return }
    let point = TouchPoint(x: x, y: y, touchID: 0)
    switch phase { case 0: machine.platform.handle(.touchBegan(point)); case 1: machine.platform.handle(.touchMoved(point));
    case 2: machine.platform.handle(.touchEnded(point)); default: break }
}
@_cdecl("podium_flush")
func flush() -> Int32 { do { try machine?.disk?.synchronize(); return 0 } catch { return -1 } }

/// Explicit read-only kernel execution probe without any guest root disk.
/// Success is only CPU/loader progress, never iOS userspace or UI proof.
@_cdecl("podium_kernel_probe")
func kernelProbe(_ kernel: UnsafeMutableRawPointer?, _ kernelSize: Int32, _ tree: UnsafeMutableRawPointer?, _ treeSize: Int32) -> Int32 {
    guard machine == nil, let kernel, let tree, staging[kernel] == Int(kernelSize), staging[tree] == Int(treeSize) else { return -1 }
    do {
        machine = try BrowserMachine(kernel: Data(bytes: kernel, count: Int(kernelSize)), tree: Data(bytes: tree, count: Int(treeSize)), requireDisk: false)
        return 0
    } catch { print("Read-only kernel probe failed: \(error)"); return -2 }
}
