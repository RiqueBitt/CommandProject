//! Mede o tempo de realce de uma textura DXT1/DXT5 de 512x512 → 1024x1024.
use cp_core::dds::{self, DdsFormat, Quality, Rgba};
use cp_core::enhance::{self, EnhanceOptions, Mode};
fn main() {
    let mut px = Vec::new();
    for y in 0..512u32 {
        for x in 0..512u32 {
            let v = ((x ^ y) % 97 + (x / 13) * 3 % 60) as u8;
            px.extend_from_slice(&[v, v / 2 + 40, 200 - v / 2, 255]);
        }
    }
    let img = Rgba {
        width: 512,
        height: 512,
        pixels: px,
    };
    for f in [DdsFormat::Dxt1, DdsFormat::Dxt5] {
        let d = dds::encode(&img, f, 0, Quality::Fast).unwrap();
        let t = std::time::Instant::now();
        let n = 8;
        for _ in 0..n {
            enhance::enhance_dds("/units/a/a_albedo.dds", &d, Mode::Upscale, &EnhanceOptions::default()).unwrap();
        }
        let (_, dec) = dds::decode(&d).unwrap();
        let t2 = std::time::Instant::now();
        let up = enhance::enhance_image(
            &dec,
            enhance::TextureClass::Color,
            1024,
            1024,
            f,
            &EnhanceOptions::default(),
        );
        let proc = t2.elapsed().as_millis();
        for q in [Quality::Fast, Quality::Normal] {
            let t4 = std::time::Instant::now();
            dds::encode(&up, f, 0, q).unwrap();
            println!("  encode {q:?}: {} ms", t4.elapsed().as_millis());
        }
        println!("  processamento (sem codificar): {proc} ms");
        println!(
            "{f:?}: {:.0} ms por textura 512→1024 ({} threads)",
            t.elapsed().as_millis() as f64 / n as f64,
            rayon::current_num_threads()
        );
    }
}
