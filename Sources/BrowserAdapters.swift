import Foundation

// Native AArch64 code cannot execute in Wasm. These adapters always choose the
// original interpreter. They do not emulate successful JIT compilation.
final class DBTEngine {
    static let standardFPCR: UInt64 = 0x0300_0000
    enum Outcome { case notTranslated, ran, deopted }
    func setStopAddresses(_ addresses: Set<UInt32>) {}
    func run(budget: UInt64) -> Outcome { .notTranslated }
    func codeWasWritten(physicalPage: UInt32) {}
    func registerSnippet(at: UInt32, thumb: Bool, exit: UInt32, body: @escaping (ARMv7CPU) -> Bool) {}
}
final class JITEngine {
    func block(at: UInt32, thumbState: Bool, memory: MemoryBus) -> UnavailableNativeBlock? { nil }
    func reportMemoryBlockOutcome(_ block: UnavailableNativeBlock, at: UInt32, thumbState: Bool, madeProgress: Bool) {}
}
final class UnavailableNativeBlock {
    var instructionCount: Int { 0 }
    var containsMemoryAccess: Bool { false }
    func byteLength(afterCompleting: Int) -> Int { 0 }
    func run(registers: UnsafeMutablePointer<UInt32>, ramHostPointer: UnsafeMutableRawPointer? = nil,
             ramGuestBase: UInt32 = 0, ramGuestLength: UInt32 = 0, cpsr: UnsafeMutablePointer<UInt32>) -> Int {
        fatalError("Native ARM64 JIT is unavailable in the browser")
    }
}

/// Wasm linear memory replaces Darwin mmap. No host file mappings or implicit I/O.
final class BrowserMemory: MemoryBus {
    let length: Int
    let base: UInt32
    var baseAddress: UInt32 { base }
    let pointer: UnsafeMutableRawPointer
    var window: (first: UInt32, count: UInt64)? { (base, UInt64(length)) }
    init(length: Int, base: UInt32 = 0) {
        self.length = length; self.base = base
        pointer = .allocate(byteCount: length, alignment: 16)
        pointer.initializeMemory(as: UInt8.self, repeating: 0, count: length)
    }
    convenience init(length: Int, baseAddress: UInt32) { self.init(length: length, base: baseAddress) }
    deinit { pointer.deallocate() }
    private func offset(_ address: UInt32, _ width: Int) throws -> Int {
        guard address >= base, UInt64(address - base) + UInt64(width) <= UInt64(length) else {
            throw MemoryAccessError.outOfBounds(address: address, length: width)
        }
        return Int(address - base)
    }
    func readByte(at a: UInt32) throws -> UInt8 { pointer.load(fromByteOffset: try offset(a, 1), as: UInt8.self) }
    func readWord16(at a: UInt32) throws -> UInt16 { pointer.loadUnaligned(fromByteOffset: try offset(a, 2), as: UInt16.self).littleEndian }
    func readWord32(at a: UInt32) throws -> UInt32 { pointer.loadUnaligned(fromByteOffset: try offset(a, 4), as: UInt32.self).littleEndian }
    func writeByte(_ v: UInt8, at a: UInt32) throws { pointer.storeBytes(of: v, toByteOffset: try offset(a, 1), as: UInt8.self) }
    func writeWord16(_ v: UInt16, at a: UInt32) throws {
        let p = pointer + (try offset(a, 2)); var value = v.littleEndian
        withUnsafeBytes(of: &value) { p.copyMemory(from: $0.baseAddress!, byteCount: 2) }
    }
    func writeWord32(_ v: UInt32, at a: UInt32) throws {
        let p = pointer + (try offset(a, 4)); var value = v.littleEndian
        withUnsafeBytes(of: &value) { p.copyMemory(from: $0.baseAddress!, byteCount: 4) }
    }
    func fastPathRegion(for address: UInt32) -> (pointer: UnsafeMutableRawPointer, regionBaseAddress: UInt32, regionLength: Int)? {
        guard address >= base, UInt64(address - base) < UInt64(length) else { return nil }
        return (pointer, base, length)
    }
    func readBytes(_ count: Int, at address: UInt32) throws -> Data {
        guard count >= 0 else { throw MemoryAccessError.outOfBounds(address: address, length: count) }
        return Data(bytes: pointer + (try offset(address, count)), count: count)
    }
    func writeBytes(_ bytes: Data, at address: UInt32) throws {
        let target = pointer + (try offset(address, bytes.count))
        if !bytes.isEmpty { bytes.withUnsafeBytes { target.copyMemory(from: $0.baseAddress!, byteCount: bytes.count) } }
    }
}
typealias FlatPhysicalMemory = BrowserMemory
