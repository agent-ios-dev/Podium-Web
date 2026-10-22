import Foundation
import BrowserHost

@_cdecl("podium_hardware_test")
func hardwareTest() -> Int32 {
    var tick: UInt64 = 0
    var irq = false
    let timer = S5L8930XTimer(currentTick: { tick }, deadlineChanged: {}, setInterruptLine: { irq = $0 })
    timer.writeRegister(1, at: 0x10)
    timer.writeRegister(20, at: 8)
    tick = 19; timer.advance(toTick: tick)
    guard !irq, timer.readRegister(at: 8) == 1 else { return -1 }
    tick = 20; timer.advance(toTick: tick)
    guard irq, timer.readRegister(at: 0x10) == 3 else { return -2 }
    timer.writeRegister(3, at: 0x10)
    guard !irq else { return -3 }
    let memory = BrowserMemory(length: 4096)
    let bus = SegmentedMemoryBus(regions: [memory])
    let cpu = ARMv7CPU(memory: bus)
    let platform = S5L8930XPlatform(cpu: cpu)
    for region in platform.regions { bus.addRegion(region) }
    do {
        // A4 timebase alias must be handled by its MMIO device, not plain RAM.
        let value = try bus.readWord32(at: 0xBF10_2000)
        guard value == 0 else { return -4 }
        try bus.writeWord32(123, at: 0xBF10_2008)
        guard try bus.readWord32(at: 0xBF10_2008) == 123 else { return -5 }
    } catch { return -6 }
    return 0
}
@_cdecl("podium_aes_test")
func aesTest() -> Int32 {
    // FIPS 197 AES-128 ECB known-answer vector, then independent decrypt.
    let plaintext = Data(hex: "00112233445566778899aabbccddeeff")
    let key = Array(Data(hex: "000102030405060708090a0b0c0d0e0f"))
    let ciphertext = Data(hex: "69c4e0d86a7b0430d8cdb78070b4c55a")
    let encrypted = S5L8930XCDMA.aes(plaintext, key: key, iv: Array(repeating: 0, count: 16), encrypt: true, cbc: false)
    guard encrypted == ciphertext else { return -1 }
    return S5L8930XCDMA.aes(ciphertext, key: key, iv: Array(repeating: 0, count: 16), encrypt: false, cbc: false) == plaintext ? 0 : -2
}
@_cdecl("podium_storage_test")
func storageTest() -> Int32 {
    let source: [UInt8] = [80, 79, 68, 73, 85, 77, 87, 69, 66, 45, 79, 80, 70, 83, 49, 10]
    guard browser_disk_size() == 16 else { return -1 }
    let written = source.withUnsafeBytes { browser_disk_write(0, $0.baseAddress, 16) }
    guard written == 16, browser_disk_flush() == 0 else { return -2 }
    var result = [UInt8](repeating: 0, count: 16)
    let read = result.withUnsafeMutableBytes { browser_disk_read(0, $0.baseAddress, 16) }
    return read == 16 && result == source ? 0 : -3
}
