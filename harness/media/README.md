# Bundled soundtrack library

These source MP3 files are an optional library. The default workflow composes a new score for each film. Each asset page identifies its track as CC0. Artist credit is included here even though CC0 does not require it. The YouIAgent Apache 2.0 license applies to code; these tracks retain their own CC0 dedication.

| File | Artist | Source and license declaration | SHA-256 |
| --- | --- | --- | --- |
| `music/airy.mp3` | SRG774 | [Dark Sci-Fi Audio Pack](https://opengameart.org/content/dark-sci-fi-audio-pack) | `2880297bb0bace79448ea47732aa7db78ea526663ce2791d733e353b6f8adf87` |
| `music/urgent.mp3` | SRG774 | [Dark Sci-Fi Audio Pack](https://opengameart.org/content/dark-sci-fi-audio-pack) | `4aba1f1a01f328e0337a3764eb89d8d69e13ea2a86929840c787f4d736565b82` |
| `music/magic-space.mp3` | CodeManu | [Magic Space](https://opengameart.org/content/magic-space) | `4b64e483ed54fd2a35b90c47d79403ac72480116bb7c58c958a2a2e7a568da81` |
| `music/party-sector.mp3` | Joth | [Party Sector](https://opengameart.org/content/party-sector) | `77e1ad0bd0a7c5625a12eaa1c8099408ede6959b2ee2dbf5bace85d09a602ada` |

The files are copied into each film job only when library music is selected. The planner chooses from a per-job catalog based on the story. `FILM_AUDIO_DIR` replaces this catalog with the operator's own licensed tracks. The web app also offers original music and a no-music option.
