//! Compara o realce de texturas com outros métodos, usando uma imagem como "verdade".
//! A imagem é reduzida 2x e comprimida em DXT1 (como no jogo) e depois ampliada de volta.
//!
//! cargo run -p cp-core --release --example enhance_compare -- verdade.png saida_prefixo
use cp_core::dds::{self, DdsFormat, Quality, Rgba};
use cp_core::enhance::{self, EnhanceOptions, TextureClass};

fn psnr(a: &Rgba, b: &Rgba) -> f64 {
    let mse: f64 = a
        .pixels
        .chunks_exact(4)
        .zip(b.pixels.chunks_exact(4))
        .map(|(p, q)| (0..3).map(|c| (p[c] as f64 - q[c] as f64).powi(2)).sum::<f64>())
        .sum::<f64>()
        / (a.pixels.len() as f64 / 4.0 * 3.0);
    10.0 * (255.0f64.powi(2) / mse.max(1e-9)).log10()
}

fn resize(img: &Rgba, w: u32, h: u32, f: image::imageops::FilterType) -> Rgba {
    let src = image::RgbaImage::from_raw(img.width, img.height, img.pixels.clone()).unwrap();
    Rgba {
        width: w,
        height: h,
        pixels: image::imageops::resize(&src, w, h, f).into_raw(),
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let gt = dds::from_png(&std::fs::read(&args[1]).unwrap()).unwrap();
    let (w, h) = (gt.width & !7, gt.height & !7);
    let gt = resize(&gt, w, h, image::imageops::FilterType::Lanczos3);
    let low = dds::downsample(&gt);
    let (_, dec) = dds::decode(&dds::encode(&low, DdsFormat::Dxt1, 1, Quality::Normal).unwrap()).unwrap();
    use image::imageops::FilterType::*;
    let near = resize(&dec, w, h, Nearest);
    let bil = resize(&dec, w, h, Triangle);
    let lan = resize(&dec, w, h, Lanczos3);
    let ours = enhance::enhance_image(
        &dec,
        TextureClass::Color,
        w,
        h,
        DdsFormat::Dxt1,
        &EnhanceOptions::default(),
    );
    for (n, img) in [
        ("vizinho", &near),
        ("bilinear", &bil),
        ("lanczos", &lan),
        ("commandproject", &ours),
    ] {
        println!("{n:15} PSNR {:.2} dB", psnr(img, &gt));
        std::fs::write(format!("{}_{n}.png", args[2]), dds::to_png(img).unwrap()).unwrap();
    }
    std::fs::write(format!("{}_original.png", args[2]), dds::to_png(&gt).unwrap()).unwrap();
}
