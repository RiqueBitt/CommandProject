//! Gera um textures.scd falso (texturas DXT em vários grupos) para testar as Texturas HD.
use cp_core::dds::{self, DdsFormat, Quality, Rgba};
fn main() {
    let out = std::env::args().nth(1).unwrap();
    let png = dds::from_png(&std::fs::read(std::env::args().nth(2).unwrap()).unwrap()).unwrap();
    let crop = |x0: u32, y0: u32, s: u32| {
        let mut px = Vec::new();
        for y in y0..y0 + s {
            for x in x0..x0 + s {
                let i = ((y * png.width + x) * 4) as usize;
                px.extend_from_slice(&png.pixels[i..i + 4]);
            }
        }
        Rgba {
            width: s,
            height: s,
            pixels: px,
        }
    };
    let flat_normal = Rgba {
        width: 128,
        height: 128,
        pixels: [128u8, 128, 255, 255].repeat(128 * 128),
    };
    let mut b = cp_core::scd::ScdBuilder::create(std::path::Path::new(&out)).unwrap();
    let mut n = 0;
    for i in 0..24u32 {
        let img = crop((i * 37) % 700, (i * 53) % 300, 256);
        b.add_bytes(
            &format!("units/uel{i:04}/uel{i:04}_albedo.dds"),
            &dds::encode(&img, DdsFormat::Dxt1, 0, Quality::Fast).unwrap(),
        )
        .unwrap();
        b.add_bytes(
            &format!("units/uel{i:04}/uel{i:04}_normalsts.dds"),
            &dds::encode(&flat_normal, DdsFormat::Dxt5, 0, Quality::Fast).unwrap(),
        )
        .unwrap();
        b.add_bytes(
            &format!("units/uel{i:04}/uel{i:04}_specteam.dds"),
            &dds::encode(&crop(10, 10, 128), DdsFormat::Dxt5, 0, Quality::Fast).unwrap(),
        )
        .unwrap();
        n += 3;
    }
    for i in 0..10u32 {
        b.add_bytes(
            &format!("env/terrain/ground{i}.dds"),
            &dds::encode(&crop(i * 50, 0, 512), DdsFormat::Dxt1, 0, Quality::Fast).unwrap(),
        )
        .unwrap();
        b.add_bytes(
            &format!("textures/ui/common/game/panel{i}.dds"),
            &dds::encode(&crop(i * 20, 400, 128), DdsFormat::Dxt5, 1, Quality::Fast).unwrap(),
        )
        .unwrap();
        n += 2;
    }
    b.add_bytes(
        "textures/environment/ramp_water.dds",
        &dds::encode(&crop(0, 0, 64), DdsFormat::Bgra8, 1, Quality::Fast).unwrap(),
    )
    .unwrap();
    b.finish().unwrap();
    println!("{} texturas", n + 1);
}
