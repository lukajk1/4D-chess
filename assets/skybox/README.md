# Skybox

[Cloudy Skyboxes](https://opengameart.org/content/cloudy-skyboxes-0) by Screaming Brain Studios,
released under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (public domain).
No restrictions, commercial or not, credit optional. Credited anyway.

`cloudy-05.png` is `Cubemap_Sky_05-512x512.png` from that pack, renamed and
otherwise unchanged: a 2048x1536 horizontal cross of six 512px faces, with the
four corner tiles black.

```
        [ +Y ]
  [ -X ][ +Z ][ +X ][ -Z ]
        [ -Y ]
```

Seam continuity was checked across all four ring joins and both pole joins;
every one matches to under 1/255 mean channel difference, so the cross is
consistent and needs no reordering or flipping. `src/ui/skybox.js` cuts the six
faces at load time rather than shipping them separately, which keeps the file
byte-identical to the download and keeps the project free of a build step.
