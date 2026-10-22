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
    let count = machine.cpu.run(maxUnits: Int(budget))
    if let error = machine.cpu.lastError { print("Guest CPU halted: \(error)"); return -2 }
    if let address = machine.cpu.hitBreakpoint { print("Guest stop breakpoint \(address.hexString8)"); return -3 }
    return Int32(count)
}
@_cdecl("podium_machine_pc")
func machinePC() -> UInt32 { machine?.cpu.registers.pc ?? 0 }
@_cdecl("podium_frame")
func frame() -> UnsafeMutableRawPointer? {
    guard let machine else { return nil }
    machine.display.copyCurrentFrame(into: UnsafeMutableRawBufferPointer(start: machine.pixels, count: 640 * 960 * 4))
    return machine.pixels
}
@_cdecl("podium_button")
func button(_ code: Int32, _ down: Int32) {
    guard let machine else { return }
    let event: InputEvent
    switch code { case 0: event = .homeButton(pressed: down != 0); case 1: event = .powerButton(pressed: down != 0)
    case 2: event = .volumeDown(pressed: down != 0); case 3: event = .volumeUp(pressed: down != 0); default: return }
    machine.platform.handle(event)
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
