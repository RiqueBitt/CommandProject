// Lista entradas do TOC do jogo que contêm um texto: cargo run --example toc_find -- <toc> <texto>
fn main() {
    let a: Vec<String> = std::env::args().collect();
    let data = std::fs::read(&a[1]).unwrap();
    let toc = cp_core::toc::Toc::parse(&data).unwrap();
    for f in toc.files().unwrap() {
        if f.key.contains(&a[2].to_ascii_lowercase()) {
            println!("{} archive={:?} win={}", f.key, f.archive, f.win);
        }
    }
}
