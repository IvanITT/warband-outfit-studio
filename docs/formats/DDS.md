# DDS textures in Warband

**Status: VERIFIED** (header parsed from real files; path conventions confirmed in `mb_warband.exe` strings).

## Header

```
offset  size  field
0       4     magic "DDS " (0x20534444)
4       4     header size = 124
8       4     flags
12      4     height
16      4     width
20      4     pitch or linear size
24      4     depth
28      4     mipmap count
32      44    reserved[11]
76      4     pixel format size (32)
80      4     pixel format flags
84      4     fourCC: "DXT1", "DXT3", "DXT5", "DX10", ...
88      4     RGB bit count
92      16    channel masks
108     4     caps
...     ...   caps2, caps3, caps4, reserved2
```

For `DX10`, a 20-byte extension follows (DXGI format, resource dimension, misc, array size, misc flags).

The studio reads width, height, mipmaps and format, which is enough to detect truncated/corrupt textures and show dimensions in the UI.

## Resolution rules

Search order implemented by `engine/resources/textureResolver.js`:

1. `<module>/Textures/<name>.dds`
2. `<install>/Textures/<name>.dds`
3. `<install>/Textures/languages/<lang>/<name>.dds`

Names are matched case-insensitively (Windows). BRF texture entries usually include `.dds`; material references usually do not. Both are accepted.

The engine format string `%sTextures/%s_%d.dds` (found in the executable) means textures can be split into numbered pages; the resolver reports them as `pages`.

`*_degraded_.dds` variants are used by `use_texture_degration_cache` in `module.ini`.

## Verified example

`itm_mail_shirt` → mesh `mail_shirt_a` (armors_g.brf) → material `mail_shirt_a` (materials.brf) → textures
`mail_shirt_a.dds`, `mail_shirt_a_normalmap.dds`, `mail_shirt_a_specular.dds` in `Textures/`, all 1024×1024.
