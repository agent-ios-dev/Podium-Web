import Foundation

var ram: BrowserMemory?
var cpu: ARMv7CPU?

@_cdecl("podium_create")
func create(_ megabytes: Int32) -> Int32 {
    guard megabytes >= 1, megabytes <= 512 else { return -1 }
    cpu = nil; ram = BrowserMemory(length: Int(megabytes) * 1024 * 1024)
    cpu = ARMv7CPU(memory: ram!); cpu!.reset()
    return 0
}
@_cdecl("podium_write32")
func write32(_ address: UInt32, _ value: UInt32) -> Int32 {
    guard let ram else { return -1 }
    do { try ram.writeWord32(value, at: address); return 0 } catch { return -2 }
}
@_cdecl("podium_read32")
func read32(_ address: UInt32) -> UInt32 { (try? ram?.readWord32(at: address)) ?? 0 }
@_cdecl("podium_register")
func getRegister(_ index: Int32) -> UInt32 { guard let cpu, index >= 0, index < 16 else { return 0 }; return cpu.registers[Int(index)] }
@_cdecl("podium_set_register")
func setRegister(_ index: Int32, _ value: UInt32) -> Int32 {
    guard let cpu, index >= 0, index < 16 else { return -1 }; cpu.registers[Int(index)] = value; return 0
}
@_cdecl("podium_run")
func run(_ instructions: Int32) -> Int32 {
    guard let cpu, instructions > 0, instructions <= 100_000 else { return -1 }
    for _ in 0..<instructions {
        cpu.step()
        if cpu.lastError != nil { return -2 }
    }
    return instructions
}
@_cdecl("podium_thumb")
func thumb(_ enabled: Int32) { cpu?.cpsr.thumbState = enabled != 0 }
@_cdecl("podium_cpsr")
func cpsr() -> UInt32 { cpu?.cpsr.rawValue ?? 0 }

// A normal executable with exports also supports deterministic Node WASI tests.
print("Podium ARMv7 Wasm initialized. Guest iOS boot has not been verified.")
