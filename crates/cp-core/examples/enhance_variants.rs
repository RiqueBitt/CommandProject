//! Variantes do realce para comparar visualmente (desenvolvimento).
use cp_core::dds::{self, DdsFormat, Quality, Rgba};
use cp_core::enhance;
fn main() {
    let a: Vec<String> = std::env::args().collect();
    let gt = dds::from_png(&std::fs::read(&a[1]).unwrap()).unwrap();
    let low = dds::downsample(&gt);
    let (_, mut dec) = dds::decode(&dds::encode(&low, DdsFormat::Dxt1, 1, Quality::Normal).unwrap()).unwrap();
    enhance::deblock(&mut dec, 0.5);
    let (w, h) = (gt.width, gt.height);
    let lan = enhance::upscale_lanczos(&dec, w, h);
    let save = |n: &str, img: &Rgba| std::fs::write(format!("{}_{n}.png", a[2]), dds::to_png(img).unwrap()).unwrap();
    for steps in [0usize, 1, 2, 4] {
        let mut x = if steps == 0 {
            lan.clone()
        } else {
            enhance::back_project(&dec, lan.clone(), steps)
        };
        save(&format!("ibp{steps}"), &x);
        enhance::sharpen(&mut x, 0.6);
        save(&format!("ibp{steps}_sharp"), &x);
    }
}
