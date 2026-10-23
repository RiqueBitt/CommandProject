//! Mostra o checksum PE gravado e o calculado de um executável, e o resultado do patch de 4 GB.
fn main() {
    for p in std::env::args().skip(1) {
        let d = std::fs::read(&p).unwrap();
        let (stored, calc) = cp_core::laa::checksums(&d).unwrap();
        let patched = cp_core::laa::set_flag(&d, true).unwrap();
        let (ps, pc) = cp_core::laa::checksums(&patched).unwrap();
        println!("{p}: gravado {stored:#010x} calculado {calc:#010x} | depois do patch gravado {ps:#010x} calculado {pc:#010x}");
        std::fs::write(format!("{p}.laa"), patched).unwrap();
    }
}
