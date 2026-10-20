# execution-sensitive: files 1–300 of 1599

[Catalogue index](index.md). [Method and limits](../hvsc-rom-requirements.md).

K-only removes BASIC; B-only removes KERNAL. All rows include duration, evidence class, reference RMS/write count, and the three removal outcomes. `derived` marks proven zero-read equivalence, not a separate render.

## 128 Byte Blues

Path: `DEMOS/0-9/128_Byte_Blues_BASIC.sid`

Author: Leonard J. Paul (Freaky DNA) · Release/year: 2005 Freaky DNA

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `7ea765fce6c0f92570b18adc7bf52f54`; SHA-256: `eeb9f82e62441738a78b28fdc4c963cd19d3d3ef0259baa4579a8d786c490681`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 60 | both-sensitive | 7.736e-2; 7031 | ΔRMS 7.735e-2; writes 1; prefix 1; drift 0 | ΔRMS 7.853e-2; writes 850; prefix 1; drift 0 | ΔRMS 1.097e-1; writes 17991; prefix 7; drift 12 |

STIL (full available entry and applicable directory notes):

> COMMENT: "When I first had a look at the 512b/1k Tiny SID compo, I thought it'd
>          be a great way to get back into doing some assembly language on the
>          C=64 (which I haven't done for a long time). I spent a fair amount of
>          time thinking of the best way to reduce the size and decided that one
>          of the best ways would be to really challenge myself and to squeeze
>          some music out of 128 bytes just for fun.
>          I really wanted to feature the nature of the C=64, so I thought about
>          several ways to best store the note and instrument data. After a few
>          sketches, I found that I seemed to be wasting a lot of space trying to
>          store both the note and duration data, so I decided that the best way
>          would be to derive the notes and durations directly from the C=64
>          memory and just index into a basic blues scale and generate some
>          music. It took a bit of playing around with techniques, but I found
>          that utilizing individual bits to step up or down within the scale
>          generated the most musical results. Somewhat of a 1-bit DPCM technique
>          except for successive music notes in a scale instead of successive
>          samples. So, the code basically cycles through the bits which are
>          displayed in the screen memory and uses them to generate the notes.
>          The note duration is set by combining the jiffy clock and the cursor
>          countdown to give some flex to the tempo. I found that staying in one
>          note sequence was boring, so I made it step through two blues scales.
>          I tried to squeeze out more space by removing the low byte of the
>          frequency but found that it either made the music too out of tune or
>          too high in pitch. I also attempted to add a second voice, but ran out
>          of space. I really liked the idea of adding something to watch while
>          it's playing, so the colours change as it is reading through the bytes
>          of screen memory. Rolling the bits of screen memory had the additional
>          benefit that the bytes would return to their original form after
>          passing over them eight times when the sequence repeats. Since the
>          tempo is partially derived from the cursor blink, it is possible to
>          change the tempo while moving the cursor. The sequence of notes can
>          also be modified by typing in the upper portion of the screen.
>          It should sound fine on any C=64 (NTSC/PAL), SID (6581/8580) or good
>          emulator (VICE, PowerPC etc..). I've had great fun working on this
>          piece and hope others have fun listening and playing around with it as
>          well." (Freaky DNA)

## 3. Oversample

Path: `DEMOS/0-9/3_Oversample.sid`

Author: The Earl · Release/year: 1987 New Dimension

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `625e1172cb1da5df9299c017edffb190`; SHA-256: `9188dc6c5cf68269eed402a5c4819d320193e37f1eece60eac876963b3198e3c`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 5.967e-2; 73472 | ΔRMS 4.925e-2; writes 73490; prefix 243; drift 576; derived | identical PCM; writes 73472; prefix 73472; drift 0; derived | ΔRMS 4.925e-2; writes 73490; prefix 243; drift 576 |

STIL (full available entry and applicable directory notes):

> TITLE: Get Ready
>  ARTIST: Jeroen Tel
> COMMENT: Same as /MUSICIANS/T/Tel_Jeroen/Get_Ready.sid, but with digis
>          added and with voice 1 largely muted.

## Abyss Zone Demo

Path: `DEMOS/A-F/Abyss_Zone_Demo.sid`

Author: Jukka Tapanimäki &lt;?&gt; · Release/year: 198? Jukka Tapanimäki

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `c5280d2998693dea2161ca4b823c53b8`; SHA-256: `4e9248133af1d0548116f7c75f59e090d2c024cd50290e2be8bd524bf0d3d10a`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 9.459e-2; 45476 | ΔRMS 5.159e-2; writes 45476; prefix 326; drift 242; derived | identical PCM; writes 45476; prefix 45476; drift 0; derived | ΔRMS 5.159e-2; writes 45476; prefix 326; drift 242 |

STIL (full available entry and applicable directory notes):

> TITLE: Summer Tempest
>  ARTIST: Wally Beben
> COMMENT: /MUSICIANS/B/Beben_Wally/Octapolis.sid, Tune #1, with added digis.

## Aces High (tune 2)

Path: `DEMOS/A-F/Aces_High_tune_2.sid`

Author: Starion · Release/year: 198? Damage Incorporated 2019

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `61ab7b2a1b43bb87e09a8318bb9b7201`; SHA-256: `8e159adc1cf922c447010861599271b560e675b0ce7e88d2981dab81d8077791`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 9.748e-2; 39873 | ΔRMS 3.928e-2; writes 39881; prefix 438; drift 93; derived | identical PCM; writes 39873; prefix 39873; drift 0; derived | ΔRMS 3.928e-2; writes 39881; prefix 438; drift 93 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Ahoy! Magazine

Path: `DEMOS/A-F/Ahoy_Magazine_BASIC.sid`

Author: David Barron · Release/year: 1986 Ahoy! Magazine

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `6f2e60ac5cac5433be0d45c4f2fb3d0d`; SHA-256: `e9898cd225971f25508d136dac5f13929b44b3e0292267a2754a7ccd2f55576f`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 7.404e-2; 147 | ΔRMS 7.479e-2; writes 1; prefix 1; drift 0 | ΔRMS 7.631e-2; writes 148; prefix 1; drift 0 | ΔRMS 7.479e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Anchors Aweigh (Song of the Navy)
>  ARTIST: Charles A. Zimmerman (music), Alfred Hart Miles (lyrics)

## Air - Bach

Path: `DEMOS/A-F/Air-Bach_BASIC.sid`

Author: Alex Fielding · Release/year: 1985 Alex Fielding

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `e188884c92eb73ef8e51d934fd3259e3`; SHA-256: `93ac68e002e46edffb2ca3bba76da6b00423a1b164e64b39b03d33b097556a2f`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 6.778e-2; 456 | ΔRMS 1.447e-1; writes 1; prefix 1; drift 0 | ΔRMS 1.381e-1; writes 155; prefix 1; drift 0 | ΔRMS 1.447e-1; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Air [from Orchestral Suite No. 3 (BWV 1068)]
>  ARTIST: Johann Sebastian Bach

## All Micronet (part 2)

Path: `DEMOS/A-F/All_Micronet_part_2.sid`

Author: Mr. Reckless &amp; Magic Mind · Release/year: 1987 Micronet

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `05fcf773b596d432fa2e170820976c5e`; SHA-256: `26a9aee967752768693a5750b0621f74fb8f5619e565871090861ab627f59bd1`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 8.512e-2; 93863 | ΔRMS 3.670e-2; writes 94005; prefix 727; drift 181; derived | identical PCM; writes 93863; prefix 93863; drift 0; derived | ΔRMS 3.670e-2; writes 94005; prefix 727; drift 181 |

STIL (full available entry and applicable directory notes):

> TITLE: What's That?
>  ARTIST: Jozi (STP Sound System)
> COMMENT: Same as /MUSICIANS/S/STP_Sound_System/Whats_That.sid with added samples.

## America

Path: `DEMOS/A-F/America_BASIC.sid`

Author: Darren Boyd · Release/year: 1984 D.B. Productions

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `9c54528f01602df6655de24099189ac8`; SHA-256: `3d97e3429d4e7ccd767bbc06d67f0d0593750087eebefe74397ba2ccedf20d0f`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 1.097e-1; 288 | ΔRMS 1.150e-1; writes 1; prefix 1; drift 0 | ERROR: Illegal instruction $32 at address $4557; writes 44; prefix 1; drift 0 | ΔRMS 1.150e-1; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## American Flag

Path: `DEMOS/A-F/American_Flag_BASIC.sid`

Author: Perry F. Crabill · Release/year: 1982 Perry F. Crabill

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `89a02651e88252c82165dcc9f919b35c`; SHA-256: `9eeae1caf9cc5ada2be251986f478854cd1937cb9704a9f67aaa0e5229dec821`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 7.007e-2; 277 | ΔRMS 7.021e-2; writes 1; prefix 1; drift 0 | ΔRMS 7.319e-2; writes 155; prefix 1; drift 0 | ΔRMS 7.021e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: The Star Spangled Banner (National Anthem of the U.S.A.)
>  ARTIST: Sir Francis Scott Key (lyrics), John Stafford Smith (music)

## Arrival of the Queen of Sheba

Path: `DEMOS/A-F/Arrival_of_the_Queen_of_Sheba_BASIC.sid`

Author: Jeff Aughton · Release/year: 1984 PCW&amp;Century Communications

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `735efcb116b760ba802d8bc5b34c9112`; SHA-256: `4bb887a6b8e7c37b310806725032e29276330244dc12fd6cfaeb55707c638924`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 7.955e-2; 319 | ΔRMS 9.261e-2; writes 1; prefix 1; drift 0 | ΔRMS 9.839e-2; writes 148; prefix 1; drift 0 | ΔRMS 9.261e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Arrival of the Queen of Sheba [from Solomon]
>  ARTIST: Georg Friedrich Händel

## Axel-F Remix

Path: `DEMOS/A-F/Axel-F_Remix.sid`

Author: The Generator · Release/year: 1988 The Last Generation

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `da38b9b8706133c8559899b26857dde8`; SHA-256: `dde0a7b6cc912390910374f53db183db1c694649943a49bcec1f7a15b542baee`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 2.658e-2; 39211 | ΔRMS 1.529e-2; writes 39211; prefix 57; drift 0; derived | identical PCM; writes 39211; prefix 39211; drift 0; derived | ΔRMS 1.529e-2; writes 39211; prefix 57; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Axel F [from the movie Beverly Hills Cop]
>  ARTIST: Harold Faltermeyer
> COMMENT: Edit of /MUSICIANS/H/Huelsbeck_Chris/Axel_F.sid with digis from
>          /MUSICIANS/H/Huelsbeck_Chris/Antics_Chip_War.sid added.

## Baby Elephant Walk

Path: `DEMOS/A-F/Baby_Elephant_Walk_BASIC.sid`

Author: John Winter · Release/year: 1985 Electronics Today Int.

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `35cc5fab3da0920964a0aec250fe8f8f`; SHA-256: `a8df5e7917917495c3a945ba4c131a79b20faf42043e70760cbb9a62defd8f8e`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 5.896e-2; 150 | ΔRMS 5.894e-2; writes 1; prefix 1; drift 0 | ΔRMS 6.427e-2; writes 148; prefix 1; drift 0 | ΔRMS 5.894e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Baby Elephant Walk [from the movie Hatari!]
>  ARTIST: Henry Mancini

## Bach's Prelude in C

Path: `DEMOS/A-F/Bachs_Prelude_in_C_BASIC.sid`

Author: Brian L. Lightfoot · Release/year: 1983 Power/Play Magazine

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `300838e176c9e97650632c7da6172dea`; SHA-256: `eb1914bda324fde7c000a357f188c867d68180a894ac5eed8362dacfb0729775`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 7.933e-2; 191 | ΔRMS 7.927e-2; writes 1; prefix 1; drift 0 | ΔRMS 8.321e-2; writes 155; prefix 1; drift 0 | ΔRMS 7.927e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Prelude No. 1 (BWV 846)
>  ARTIST: Johann Sebastian Bach

## Bad

Path: `DEMOS/A-F/Bad.sid`

Author: Dr. Funk · Release/year: 1987 Crackmission

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `a48dff038bbc25559b0c2cd3cbc16021`; SHA-256: `b6f306e0b33312f43f0ce39bd31772821a0f4c6be5565e966e1758b4edf79575`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 6.448e-2; 37288 | ΔRMS 2.313e-2; writes 37288; prefix 1033; drift 199; derived | identical PCM; writes 37288; prefix 37288; drift 0; derived | ΔRMS 2.313e-2; writes 37288; prefix 1033; drift 199 |

STIL (full available entry and applicable directory notes):

> TITLE: Bad [from Bad]
>  ARTIST: Michael Jackson

## Ballet

Path: `DEMOS/A-F/Ballet.sid`

Author: Alessandro Brunetti &lt;?&gt; · Release/year: 1985 Softidea

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `6074584d021990cc2ea8c524a2b7693c`; SHA-256: `fb67075b26a2c605439f269d9462e2d0e56fc1730298c886160198b7b57fa5ef`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 8.476e-2; 1322 | ΔRMS 1.115e-1; writes 1340; prefix 1322; drift 103754; derived | identical PCM; writes 1322; prefix 1322; drift 0; derived | ΔRMS 1.115e-1; writes 1340; prefix 1322; drift 103754 |

STIL (full available entry and applicable directory notes):

> TITLE: Tico-Tico no Fubá
>  ARTIST: Zequinha de Abreu
> COMMENT: A famous Brazilian choro tune composed in 1917.

## Barb's Boat

Path: `DEMOS/A-F/Barbs_Boat_BASIC.sid`

Author: D. Ritter &lt;?&gt; · Release/year: 1984 D. Ritter &lt;?&gt;

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `36a1d38b62949fb23b3ba0e272a6bd20`; SHA-256: `d605606613e2fda3ad0243e1ef6dea7b78e55c799bf7c09516d4e1546d5f0b54`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 6.751e-2; 147 | ΔRMS 6.744e-2; writes 1; prefix 1; drift 0 | ΔRMS 7.196e-2; writes 155; prefix 1; drift 0 | ΔRMS 6.744e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Basic Music 2

Path: `DEMOS/A-F/Basic_Music_2_BASIC.sid`

Author: Thorsten Joedicke &amp; T. Horchert · Release/year: 1987 T. Joedicke &amp; T. Horchert

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `99183b695719dda284fb6322653ab39e`; SHA-256: `f7ff853a0d2a963db80c9f1d56d884f03d570838bcce69bfc31dccbc830eb146`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 1.167e-1; 603 | ΔRMS 3.037e-1; writes 1; prefix 1; drift 0 | ΔRMS 2.958e-1; writes 237; prefix 1; drift 0 | ΔRMS 3.037e-1; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Battle Hymn

Path: `DEMOS/A-F/Battle_Hymn_BASIC.sid`

Author: Bob Roth · Release/year: 198? Bob Roth

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `d0d412e0d78351d6a5894d63fd67c9d0`; SHA-256: `ad35d6e2a8c5d180e70c55ec27f605d2ccad6ae93a843c5174bad36ebda5d2bb`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 5.334e-2; 281 | ΔRMS 5.326e-2; writes 1; prefix 1; drift 0 | ΔRMS 5.895e-2; writes 155; prefix 1; drift 0 | ΔRMS 5.326e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Battle Hymn of the Republic
>  ARTIST: Julia Ward Howe

## Battle Hymn of the Republic v1

Path: `DEMOS/A-F/Battle_Hymn_of_the_Republic_v1_BASIC.sid`

Author: Nicholas Ashworth · Release/year: 198? Nicholas Ashworth

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `aea1388b8e87cd7d25e3cf838d24a36c`; SHA-256: `418a24136efb9b2990f70f36543660192166b59856efbbe94a7e729ed7cde6c1`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 1.425e-1; 266 | ΔRMS 1.853e-1; writes 1; prefix 1; drift 0 | ΔRMS 1.818e-1; writes 155; prefix 1; drift 0 | ΔRMS 1.853e-1; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> NAME: Battle Hymn of the Republic v1 (Two Violins)
>   TITLE: The Battle Hymn of the Republic
>  ARTIST: William Steffe (music), Julia Ward Howe (lyrics)

## Battle Hymn of the Republic v2

Path: `DEMOS/A-F/Battle_Hymn_of_the_Republic_v2_BASIC.sid`

Author: Nicholas Ashworth · Release/year: 198? Nicholas Ashworth

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `e012d4c9c27c6d85146901daf5c84173`; SHA-256: `b496984ac335db16e31b3ee1e8efbde140a7108c7939c20330f614c9e5dfb1b1`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 9.649e-2; 266 | ΔRMS 1.270e-1; writes 1; prefix 1; drift 0 | ΔRMS 1.245e-1; writes 155; prefix 1; drift 0 | ΔRMS 1.270e-1; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> NAME: Battle Hymn of the Republic v2 (Electric Guitars)
>   TITLE: The Battle Hymn of the Republic
>  ARTIST: William Steffe (music), Julia Ward Howe (lyrics)

## Beat Dis

Path: `DEMOS/A-F/Beat_Dis_BASIC.sid`

Author: Jihad · Release/year: 1989 Vision

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `c67498edc2aa966f9fb5f5c3c50c84e9`; SHA-256: `724376755df75a2655d91e812640d2b69fc63ee0323069c79549b4b7c398e407`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 8.894e-2; 132146 | ERROR: Illegal instruction $32 at address $0806; writes 1; prefix 1; drift 0 | ΔRMS 9.050e-2; writes 237; prefix 1; drift 0 | ΔRMS 8.946e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Beat Dis [from Into The Dragon]
>  ARTIST: Bomb the Bass

## Bedlam (tune 2)

Path: `DEMOS/A-F/Bedlam_tune_2.sid`

Author: Péter Szucs (TSO) · Release/year: 1990 Cross

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `13cdd17b1c07a019a63910898af392d4`; SHA-256: `cf8d4558983ad2b571d010f393a8d16136d821b516e6017c59a66b088b3f8e34`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 5.229e-2; 79220 | ΔRMS 1.464e-2; writes 79220; prefix 151; drift 11; derived | identical PCM; writes 79220; prefix 79220; drift 0; derived | ΔRMS 1.464e-2; writes 79220; prefix 151; drift 11 |

STIL (full available entry and applicable directory notes):

> COMMENT: Edit of /MUSICIANS/N/Nordic_Beat/Smooth_Dimension.sid with added digis.

## Beethoven Sinfonia No 5

Path: `DEMOS/A-F/Beethoven_Sinfonia_No_5_BASIC.sid`

Author: Markus &amp; Ilkka Pirttimaa · Release/year: 1986 Mikrobitti

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `5746e8742cfe09f885dbfeb5e3dcb43d`; SHA-256: `62960cddcab8618b9090bd7315e0dd156ab8948d7704ee9444a735527b2f64da`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 8.394e-2; 469 | ΔRMS 1.184e-1; writes 1; prefix 1; drift 0 | ΔRMS 1.126e-1; writes 148; prefix 1; drift 0 | ΔRMS 1.184e-1; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Symphony No. 5 in c-Moll Opus 67
>  ARTIST: Ludwig van Beethoven
> COMMENT: The tune covers a disco remake of the original classic, namely Walter
>          Murphy's "A Fifth of Beethoven".

## Black Box V8 Demo

Path: `DEMOS/A-F/Black_Box_V8_Demo_BASIC.sid`

Author: Romuald Drahokaupil · Release/year: 1991 Rom-Bit

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `76fd2244cd3a113259f8f842c5a3296f`; SHA-256: `e7abd61c2348d84f34082f0136ea123ef48a48be511149f53a86d5ef94bebaf8`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 5.029e-2; 61292 | ΔRMS 8.131e-2; writes 1; prefix 1; drift 0 | ΔRMS 9.124e-2; writes 226; prefix 1; drift 0 | ΔRMS 8.131e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Plynie Wisla, plynie (0:44-1:06)
>  ARTIST: Edmund Wasilewski (lyrics), Kazimierz Hofman (music)
> COMMENT: Polish patriotic song.
>   TITLE: Aura Lea (1:11-2:05)
>  ARTIST: George R. Poulton
> COMMENT: Covers the version "Love Me Tender" by Elvis Presley.

## Brain Wash

Path: `DEMOS/A-F/Brain_Wash.sid`

Author: Magnus Starseth (Thorin) · Release/year: 1987 Cracking Team of Darkness

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `cb1c24b3086e8b9ef7e527ff2c4622f8`; SHA-256: `32b5f8db6a5944dd77b139030bb8bca9a596f6dd1de2a30c2c14cd199434cc6c`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 4.790e-2; 21102 | ΔRMS 2.178e-2; writes 21107; prefix 385; drift 193; derived | identical PCM; writes 21102; prefix 21102; drift 0; derived | ΔRMS 2.178e-2; writes 21107; prefix 385; drift 193 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## The Brandenburg

Path: `DEMOS/A-F/Brandenburg_BASIC.sid`

Author: Jim Kim · Release/year: 1984 Jim Kim

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `e8e063ba2b943810577bd564f248e3d5`; SHA-256: `be2c89116e5960f6fb4f7d821bbe5180c9c3bccb16b12bd3c6cda18d28125b15`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 5.738e-2; 381 | ΔRMS 5.740e-2; writes 1; prefix 1; drift 0 | ΔRMS 6.207e-2; writes 244; prefix 1; drift 0 | ΔRMS 5.740e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Bugle Boy

Path: `DEMOS/A-F/Bugle_Boy_BASIC.sid`

Author: Don Barker · Release/year: 1990 Loadstar

RSID; BASIC flag set; 6 subtunes. Complete-file MD5: `0abd3403504a324100ac70168a2e8d3c`; SHA-256: `9ba83da18bfd7bb13bf11bbddcf45d12a188b4383f5181fc553d3ef41fd0dade`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 2.022e-2; 72 | ΔRMS 2.000e-2; writes 1; prefix 1; drift 0 | ΔRMS 3.223e-2; writes 155; prefix 1; drift 0 | ΔRMS 2.000e-2; writes 1; prefix 1; drift 0 |
| 2 | 10 | both-sensitive | 2.021e-2; 69 | ΔRMS 2.000e-2; writes 1; prefix 1; drift 0 | ΔRMS 3.223e-2; writes 155; prefix 1; drift 0 | ΔRMS 2.762e-2; writes 72; prefix 69; drift 136494 |
| 3 | 60 | both-sensitive | 1.169e-2; 109 | ERROR: Illegal instruction $02 at address $bf54; writes 1; prefix 1; drift 0 | ΔRMS 1.783e-2; writes 880; prefix 1; drift 0 | ΔRMS 1.571e-2; writes 109; prefix 109; drift 195823 |
| 4 | 10 | both-sensitive | 1.928e-2; 69 | ΔRMS 1.905e-2; writes 1; prefix 1; drift 0 | ΔRMS 3.162e-2; writes 155; prefix 1; drift 0 | ΔRMS 2.706e-2; writes 73; prefix 69; drift 136133 |
| 5 | 60 | both-sensitive | 1.724e-2; 241 | ΔRMS 1.720e-2; writes 1; prefix 1; drift 0 | ΔRMS 2.195e-2; writes 880; prefix 1; drift 0 | ΔRMS 2.382e-2; writes 241; prefix 241; drift 313940 |
| 6 | 60 | both-sensitive | 1.864e-2; 101 | ΔRMS 1.860e-2; writes 1; prefix 1; drift 0 | ΔRMS 2.300e-2; writes 880; prefix 1; drift 0 | ΔRMS 2.660e-2; writes 101; prefix 101; drift 480238 |

STIL (full available entry and applicable directory notes):

> COMMENT: All subtunes start after 7 seconds.
> (#1)
>   TITLE: First Call
>  ARTIST: Military Traditional
> (#2)
>   TITLE: Reveille
>  ARTIST: Military Traditional
> (#3)
>   TITLE: Assembly
>  ARTIST: Military Traditional
> (#4)
>   TITLE: Mess Call
>  ARTIST: Military Traditional
> (#5)
>   TITLE: Retreat
>  ARTIST: Military Traditional
> (#6)
>   TITLE: Taps
>  ARTIST: Daniel Butterfield

## Cancion de cuna

Path: `DEMOS/A-F/Cancion_de_cuna_BASIC.sid`

Author: Manuel Garrido Perez · Release/year: 1986 Editorial Alhambra

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `4f92ac6e323a7e947c5f24f225bc861b`; SHA-256: `676e1e16992c137fa8e85d8a8ba03f40a80f16dafb852f5fdcd78e66782fde30`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 7.999e-2; 75 | ΔRMS 8.014e-2; writes 1; prefix 1; drift 0 | ΔRMS 8.231e-2; writes 148; prefix 1; drift 0 | ΔRMS 8.014e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Wiegenlied: Guten Abend, gute Nacht [from Op. 49 No. 4]
>  ARTIST: Johannes Brahms
> COMMENT: Also known as "Brahms' Lullaby"

## Can't Help Falling in Love

Path: `DEMOS/A-F/Cant_Help_Falling_in_Love_BASIC.sid`

Author: Gary · Release/year: 1987 Welsh Code Breakers

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `63582cf1d9bea2ac8ec4c3dbc3420780`; SHA-256: `166f7200e706a5e1a25fbf6e3678660c7dfb953970c9c44ae4221edfa3d15f88`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 1.184e-1; 303 | ΔRMS 1.275e-1; writes 1; prefix 1; drift 0 | ΔRMS 1.252e-1; writes 148; prefix 1; drift 0 | ΔRMS 1.275e-1; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Can't Help Falling in Love [from Blue Hawaii]
>  ARTIST: George Weiss, Luigi Creatore, Hugo Peretti, performed by Elvis Presley.

## Cathode Chaos

Path: `DEMOS/A-F/Cathode_Chaos.sid`

Author: Toby Eglesfield (Tob) · Release/year: 1986 Tob

PSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `02f4e57b7bbe6dc31c4bcb858c410c96`; SHA-256: `78318c7a691e6504dfec5b06c6b5b9a32826c6934440e7c0daf6ca66256504a4`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 1.073e-1; 7938 | ΔRMS 9.967e-2; writes 7938; prefix 1244; drift 56; derived | identical PCM; writes 7938; prefix 7938; drift 0; derived | ΔRMS 9.967e-2; writes 7938; prefix 1244; drift 56 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Chess Offenbach

Path: `DEMOS/A-F/Chess_Offenbach_BASIC.sid`

Author: Jon &amp; Tony Laerda, Lars Artun · Release/year: 1984 Mikrodata

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `744e1d83941ef561ea76c14273104f1e`; SHA-256: `fcd0cf10ce09986c33e174da6b53cb9c748167b19b5e436a1d36bdc3a16f751a`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 1.523e-1; 584 | ΔRMS 1.523e-1; writes 1; prefix 1; drift 0 | ERROR: Illegal instruction $32 at address $203c; writes 44; prefix 1; drift 0 | ΔRMS 1.523e-1; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Galop Infernal [from the comic opera Orphée aux enfers]
>  ARTIST: Jacques Offenbach
> COMMENT: Famously known as the "can-can" tune.

## The Chinese Wall Song Nr.2

Path: `DEMOS/A-F/Chinese_Wall_Song_Nr_2.sid`

Author: Joost Honig (Honey) · Release/year: 1986 Honey

PSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `5faebc07eccbadfd9a861795959fdbc0`; SHA-256: `dee679bc34ccdcb9042daa327eaef0cfab1c10e25831f821dc4d7d00b87be744`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 9.593e-2; 7371 | ΔRMS 9.850e-2; writes 7371; prefix 804; drift 56; derived | identical PCM; writes 7371; prefix 7371; drift 0; derived | ΔRMS 9.850e-2; writes 7371; prefix 804; drift 56 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Christmas Music

Path: `DEMOS/A-F/Christmas_Music.sid`

Author: James Westhues · Release/year: 1985 James Westhues

PSID; BASIC flag clear; 6 subtunes. Complete-file MD5: `f77c100cd56eb3694b56f4063597e184`; SHA-256: `4f4c6271f39480883383fdbba26e241b36d5108128ec0935074c4d88c8c84d1e`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 1.318e-1; 10553 | ΔRMS 1.803e-2; writes 10553; prefix 1077; drift 61; derived | identical PCM; writes 10553; prefix 10553; drift 0; derived | ΔRMS 1.803e-2; writes 10553; prefix 1077; drift 61 |
| 2 | 2 | pcm-difference-with-similar-write-sequence | 4.412e-2; 1193 | ΔRMS 8.049e-5; writes 1193; prefix 1193; drift 57; derived | identical PCM; writes 1193; prefix 1193; drift 0; derived | ΔRMS 8.049e-5; writes 1193; prefix 1193; drift 57 |
| 3 | 2 | pcm-difference-with-similar-write-sequence | 3.278e-2; 1467 | ΔRMS 3.067e-3; writes 1467; prefix 1467; drift 60; derived | identical PCM; writes 1467; prefix 1467; drift 0; derived | ΔRMS 3.067e-3; writes 1467; prefix 1467; drift 60 |
| 4 | 2 | pcm-difference-with-similar-write-sequence | 5.025e-2; 1181 | ΔRMS 4.473e-2; writes 1181; prefix 1181; drift 56; derived | identical PCM; writes 1181; prefix 1181; drift 0; derived | ΔRMS 4.473e-2; writes 1181; prefix 1181; drift 56 |
| 5 | 2 | pcm-difference-with-similar-write-sequence | 6.234e-2; 90 | ΔRMS 1.462e-4; writes 90; prefix 90; drift 15; derived | identical PCM; writes 90; prefix 90; drift 0; derived | ΔRMS 1.462e-4; writes 90; prefix 90; drift 15 |
| 6 | 2 | pcm-difference-with-similar-write-sequence | 2.892e-2; 85 | ΔRMS 7.150e-3; writes 85; prefix 85; drift 13; derived | identical PCM; writes 85; prefix 85; drift 0; derived | ΔRMS 7.150e-3; writes 85; prefix 85; drift 13 |

STIL (full available entry and applicable directory notes):

> (#1)
>   TITLE: Gloria in Excelsis Deo
>  ARTIST: French Carol
> COMMENT: Also known as "Angels We Have Heard on High".
> (#2)
>   TITLE: Antioch (Joy to the World)
>  ARTIST: Isaac Watts (lyrics), Lowell Mason (music)
> COMMENT: Mason borrowed two phrases from Händel's Messiah, "Lift Up Your
>          Heads," and "Comfort Ye", when writing this melody.
> (#3)
>   TITLE: The First Nowell
>  ARTIST: Traditional
> (#4)
>   TITLE: O Come All Ye Faithful (Adeste Fideles)
>  ARTIST: John Francis Wade
> (#5)
>   TITLE: Oh, du Fröhliche
>  ARTIST: Johann Gottfried Herder
> (#6)
>   TITLE: God Rest Ye Merry, Gentlemen
>  ARTIST: Traditional
> COMMENT: English carol.

## Christmas Tree

Path: `DEMOS/A-F/Christmas_Tree_BASIC.sid`

Author: Rick Anding · Release/year: 1987 Rick Anding

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `254f09f7a2c4d9e2fc5312d3300711ce`; SHA-256: `5bb50145be1b6a78a05d611fdb9e7a03064b865de5437d3ee5d4bd92b8bbe916`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 60 | both-sensitive | 9.075e-2; 1011 | ΔRMS 9.074e-2; writes 1; prefix 1; drift 0 | ΔRMS 9.173e-2; writes 880; prefix 1; drift 0 | ΔRMS 9.074e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Hark! The Herald Angels Sing
>  ARTIST: Charles Wesley, Felix Mendelssohn Bartholdy &amp; William H. Cummings

## Chromatic Boogie

Path: `DEMOS/A-F/Chromatic_Boogie_BASIC.sid`

Author: Corné Smiesing · Release/year: 19?? Corné Smiesing

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `033647890a603606c86ab6648bc40e4f`; SHA-256: `cc19b08bb72f04231822fe1bc779b7b7bcb8defb3e7db79d0a0278aff232ae92`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 5.062e-2; 232 | ΔRMS 8.705e-2; writes 1; prefix 1; drift 0 | ΔRMS 9.781e-2; writes 148; prefix 1; drift 0 | ΔRMS 8.705e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Come Together

Path: `DEMOS/A-F/Come_Together.sid`

Author: Marco Vlemmix (Yawn) · Release/year: 19?? Riffs/TSM

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `6b01191930f7c37f7179129f58e8864e`; SHA-256: `75375f6e6a7e82ee3b33f4ec67959b86e7ae89b825c56e02e88c787c94c0fb7b`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 5.294e-2; 113812 | ΔRMS 4.579e-2; writes 113930; prefix 377; drift 89; derived | identical PCM; writes 113812; prefix 113812; drift 0; derived | ΔRMS 4.579e-2; writes 113930; prefix 377; drift 89 |

STIL (full available entry and applicable directory notes):

> TITLE: Come Together [from Abbey Road]
>  ARTIST: The Beatles

## Crosshatch

Path: `DEMOS/A-F/Crosshatch.sid`

Author: Matthias Kramm (Quiss) · Release/year: 2025 Reflex

PSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `d4f0f69c16b169b01a39f12f42d6d0d3`; SHA-256: `f4570b1acc69e9dba72ebe024b4aba7c0ef43f15b77bfdb02519795fcfccb90b`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 5.764e-2; 364267 | ΔRMS 1.714e-2; writes 364267; prefix 1494; drift 63; derived | identical PCM; writes 364267; prefix 364267; drift 0; derived | ΔRMS 1.714e-2; writes 364267; prefix 1494; drift 63 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Deutschland Nationalhymne

Path: `DEMOS/A-F/Deutschland_Nationalhymne_BASIC.sid`

Author: Charley · Release/year: 19?? Charly

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `739b71905b29e88ccd098c63d8241f2e`; SHA-256: `37e3afbb740425847d8545be5fab930e621144b9cd14293e85580e24464efdce`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 5.525e-2; 203 | ΔRMS 5.520e-2; writes 1; prefix 1; drift 0 | ΔRMS 6.068e-2; writes 148; prefix 1; drift 0 | ΔRMS 5.520e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Deutschlandlied (German National Anthem)
>  ARTIST: Franz Joseph Haydn (music), A. H. Hoffmann von Fallersleben (lyrics)

## Deutschlandlied

Path: `DEMOS/A-F/Deutschlandlied_2_BASIC.sid`

Author: Volker Orlemann · Release/year: 198? V.Orlemann &amp; H.Hartenbach

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `c1fbb8c87d47a92c0196cd5775e212ec`; SHA-256: `bbc39e042b3fccae08208985114efb62a14bfd37db735db5e9d5397c373a3a08`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 60 | both-sensitive | 8.403e-2; 387 | ΔRMS 9.795e-2; writes 1; prefix 1; drift 0 | ΔRMS 9.387e-2; writes 850; prefix 1; drift 0 | ΔRMS 9.795e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Deutschlandlied (German National Anthem)
>  ARTIST: Franz Joseph Haydn (music), A. H. Hoffmann von Fallersleben (lyrics)

## Deutschlandlied

Path: `DEMOS/A-F/Deutschlandlied_BASIC.sid`

Author: Hamann · Release/year: 198? Hamann

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `b76cb00fa7b59154c86f676590d61b5c`; SHA-256: `e295ab2499ecb7e559ef03440a3b22878fdf33ccf25a3ebb790069341c11e82f`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 6.051e-2; 218 | ΔRMS 6.079e-2; writes 1; prefix 1; drift 0 | ΔRMS 6.398e-2; writes 148; prefix 1; drift 0 | ΔRMS 6.079e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Deutschlandlied (German National Anthem)
>  ARTIST: Franz Joseph Haydn (music), A. H. Hoffmann von Fallersleben (lyrics)

## Digi Music V2

Path: `DEMOS/A-F/Digi_Music_V2.sid`

Author: Schellack · Release/year: 1987 Schellack

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `0c1c16918a7ca8128e625d566087698e`; SHA-256: `6b21a5f2fb5f151e831414db33220e5d0b45dd5a686bbfe397e50226659df13c`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 7.382e-2; 58784 | ΔRMS 8.395e-2; writes 58864; prefix 283; drift 109; derived | identical PCM; writes 58784; prefix 58784; drift 0; derived | ΔRMS 8.395e-2; writes 58864; prefix 283; drift 109 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Ding Dong Bells

Path: `DEMOS/A-F/Ding_Dong_Bells_BASIC.sid`

Author: Jim Green &amp; Jaggy Tu · Release/year: 1985 Jim Green &amp; Jaggy Tu

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `51b3a7559fe7fdb5ea9097f470266c94`; SHA-256: `032f7c136b0df930683ec74b42fc5fdc3d502e45903b4bb93bcf56d6b6adb484`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 60 | both-sensitive | 3.310e-2; 715 | ΔRMS 3.310e-2; writes 1; prefix 1; drift 0 | ΔRMS 3.573e-2; writes 850; prefix 1; drift 0 | ΔRMS 3.310e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: One Horse Open Sleigh (0:24-0:52)
>  ARTIST: James Lord Pierpont

## Drumm Action

Path: `DEMOS/A-F/Drumm_Action.sid`

Author: Deltaforce · Release/year: 1986 Deltaforce

PSID; BASIC flag clear; 7 subtunes. Complete-file MD5: `055d22f04e9bb59403faed7a16f73ada`; SHA-256: `3e1eed80288dbfdd8def5a51396995872ab6f1d799e30a6bd017eebc46c8c63c`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 2 | pcm-difference-with-similar-write-sequence | 3.301e-2; 165 | ΔRMS 9.719e-3; writes 165; prefix 165; drift 13; derived | identical PCM; writes 165; prefix 165; drift 0; derived | ΔRMS 9.719e-3; writes 165; prefix 165; drift 13 |
| 2 | 10 | kernal-sensitive | 3.763e-2; 798 | ΔRMS 5.124e-2; writes 798; prefix 80; drift 55; derived | identical PCM; writes 798; prefix 798; drift 0; derived | ΔRMS 5.124e-2; writes 798; prefix 80; drift 55 |
| 3 | 2 | pcm-difference-with-similar-write-sequence | 4.329e-2; 242 | ΔRMS 1.326e-2; writes 242; prefix 242; drift 54; derived | identical PCM; writes 242; prefix 242; drift 0; derived | ΔRMS 1.326e-2; writes 242; prefix 242; drift 54 |
| 4 | 10 | kernal-sensitive | 4.063e-2; 962 | ΔRMS 4.089e-2; writes 962; prefix 167; drift 55; derived | identical PCM; writes 962; prefix 962; drift 0; derived | ΔRMS 4.089e-2; writes 962; prefix 167; drift 55 |
| 5 | 2 | pcm-difference-with-similar-write-sequence | 3.896e-2; 289 | ΔRMS 2.689e-2; writes 289; prefix 289; drift 55; derived | identical PCM; writes 289; prefix 289; drift 0; derived | ΔRMS 2.689e-2; writes 289; prefix 289; drift 55 |
| 6 | 10 | kernal-sensitive | 4.600e-2; 1042 | ΔRMS 4.137e-2; writes 1042; prefix 39; drift 54; derived | identical PCM; writes 1042; prefix 1042; drift 0; derived | ΔRMS 4.137e-2; writes 1042; prefix 39; drift 54 |
| 7 | 10 | kernal-sensitive | 5.039e-2; 1288 | ΔRMS 5.818e-2; writes 1288; prefix 32; drift 13; derived | identical PCM; writes 1288; prefix 1288; drift 0; derived | ΔRMS 5.818e-2; writes 1288; prefix 32; drift 13 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## EST Calls (tune 2)

Path: `DEMOS/A-F/EST_Calls_tune_2.sid`

Author: The Scrap Yard Projects · Release/year: 198? EST

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `30c8d93825fe41a015ce89317db8eb6e`; SHA-256: `96cb58f0a1a5ed89c7ec573ce556afc8e94072b6547e36d691d2138b813e7e04`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 6.818e-2; 56149 | ΔRMS 2.307e-2; writes 56152; prefix 57; drift 0; derived | identical PCM; writes 56149; prefix 56149; drift 0; derived | ΔRMS 2.307e-2; writes 56152; prefix 57; drift 0 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## English Tune

Path: `DEMOS/A-F/English_Tune_BASIC.sid`

Author: Johan Michael Lane · Release/year: 1983 Johan Michael Lane

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `66955d45d8a42b324023ed0d3ab969bf`; SHA-256: `0ea5c9e271004cedae3eeabe959d73904d5cc91578465e971337e47c7f04f20e`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 60 | both-sensitive | 5.388e-2; 530 | ΔRMS 5.388e-2; writes 1; prefix 1; drift 0 | ΔRMS 5.577e-2; writes 880; prefix 1; drift 0 | ΔRMS 5.388e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Equality

Path: `DEMOS/A-F/Equality.sid`

Author: Nigel Griffiths (Nige) · Release/year: 1985 Nige

PSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `aab50e6598b1bdaaf89d60f102e4b685`; SHA-256: `f2974a2a4ba82bd9d8c58e2edf4b6286e776c4f12d58cf5d3c7cb6a01a5fdfcb`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 1.217e-1; 8893 | ΔRMS 6.560e-2; writes 8893; prefix 1024; drift 57; derived | identical PCM; writes 8893; prefix 8893; drift 0; derived | ΔRMS 6.560e-2; writes 8893; prefix 1024; drift 57 |

STIL (full available entry and applicable directory notes):

> TITLE: Equality [from Human's Lib]
>  ARTIST: Howard Jones

## Fanfare

Path: `DEMOS/A-F/Fanfare_BASIC.sid`

Author: Gregg Peele · Release/year: 1983 COMPUTE!'s Gazette

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `651c3554cfdd38f8a6805988f38aecb1`; SHA-256: `7cec40d5d26a59e1ce671f0a74553d9523620adb877069ad0e18092ce46cf45e`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 3.057e-2; 82 | ΔRMS 3.276e-2; writes 1; prefix 1; drift 0 | ΔRMS 3.678e-2; writes 155; prefix 1; drift 0 | ΔRMS 3.276e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Charge
>  ARTIST: Tommy Walker
> COMMENT: Also used in the games "Las Vegas Slots" and "21", both (C) 19??
>          Scott Hossner. Later in 1983, COMPUTE! printed a version with the
>          last chord released smoothly.

## Final Demo II

Path: `DEMOS/A-F/Final_Demo_II.sid`

Author: Odie · Release/year: 1989 Odie

RSID; BASIC flag clear; 5 subtunes. Complete-file MD5: `4ef6f1a3e1ac2532b6dc07b70562e80b`; SHA-256: `68fb671c533e1298917eca6708509431f6913f8396b602c0c46e6aa20df9e1da`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 4.937e-2; 78373 | ΔRMS 2.708e-2; writes 78373; prefix 298; drift 208; derived | identical PCM; writes 78373; prefix 78373; drift 0; derived | ΔRMS 2.708e-2; writes 78373; prefix 298; drift 208 |
| 2 | 10 | kernal-sensitive | 4.879e-2; 50974 | ΔRMS 2.462e-2; writes 50974; prefix 299; drift 208; derived | identical PCM; writes 50974; prefix 50974; drift 0; derived | ΔRMS 2.462e-2; writes 50974; prefix 299; drift 208 |
| 3 | 2 | pcm-difference-with-similar-write-sequence | 2.989e-2; 9095 | ΔRMS 1.547e-2; writes 9125; prefix 9095; drift 1911; derived | identical PCM; writes 9095; prefix 9095; drift 0; derived | ΔRMS 1.547e-2; writes 9125; prefix 9095; drift 1911 |
| 4 | 2 | pcm-difference-with-similar-write-sequence | 2.790e-2; 10526 | ΔRMS 8.594e-3; writes 10531; prefix 10526; drift 984; derived | identical PCM; writes 10526; prefix 10526; drift 0; derived | ΔRMS 8.594e-3; writes 10531; prefix 10526; drift 984 |
| 5 | 10 | kernal-sensitive | 2.965e-2; 134449 | ΔRMS 1.841e-2; writes 134449; prefix 299; drift 207; derived | identical PCM; writes 134449; prefix 134449; drift 0; derived | ΔRMS 1.841e-2; writes 134449; prefix 299; drift 207 |

STIL (full available entry and applicable directory notes):

> (#1)
>   TITLE: Papa Don't Preach [from True Blue]
>  ARTIST: Madonna
> (#3)
>   TITLE: Yellow Submarine [from Revolver]
>  ARTIST: The Beatles
> (#4)
>   TITLE: Blue Monday
>  ARTIST: New Order

## First Day Tune

Path: `DEMOS/A-F/First_Day_Tune.sid`

Author: Tony · Release/year: 19?? Tony

PSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `be69382debadec0aa2416a8c551e815e`; SHA-256: `b6969b65612fc7136deeab7f20db067564bcc1add1c65b831462f3500b513402`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 6.357e-2; 398 | ΔRMS 1.621e-3; writes 398; prefix 3; drift 0; derived | identical PCM; writes 398; prefix 398; drift 0; derived | ΔRMS 1.621e-3; writes 398; prefix 3; drift 0 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## First Rock-Try

Path: `DEMOS/A-F/First_Rock-Try.sid`

Author: Lasse Legaard (Sleepy Sleep) · Release/year: 1987 Omicron

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `e7f85359e78f1fd9ed678d5bff4667bb`; SHA-256: `b4ba978ad1096bbddc0593866cf53cd273cc8ec263bab3ab5067f0a097b32beb`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 4.460e-2; 116581 | ΔRMS 1.501e-2; writes 116605; prefix 305; drift 55; derived | identical PCM; writes 116581; prefix 116581; drift 0; derived | ΔRMS 1.501e-2; writes 116605; prefix 305; drift 55 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## First Song

Path: `DEMOS/A-F/First_Song_BASIC.sid`

Author: Gregory J. Perry · Release/year: 1985 Prentice-Hall of Australia

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `c61b98ffa81273c8c0d6011ff0530b9c`; SHA-256: `d4cb25049d26a7eb8bbdc9e32fefa58932094637a7188c6a9fa4089b48730d5b`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 6.992e-2; 119 | ΔRMS 6.988e-2; writes 1; prefix 1; drift 0 | ΔRMS 7.431e-2; writes 148; prefix 1; drift 0 | ΔRMS 6.988e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Flash for Fantasy

Path: `DEMOS/A-F/Flash_for_Fantasy_BASIC.sid`

Author: TTF · Release/year: 1986 Radwar

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `84ec5ddad1aaa8c1325eda3e7dad6569`; SHA-256: `5f7dbec6ff861f12bd39d0f3e15433108283023896bf68086c7595cea16b3e7b`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 4.138e-2; 138116 | ERROR: Illegal instruction $22 at address $c01b; writes 1; prefix 1; drift 0 | ERROR: Illegal instruction $42 at address $2031; writes 44; prefix 1; drift 0 | ΔRMS 4.211e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Flesh For Fantasy [from Rebel Yell]
>  ARTIST: Billy Idol

## The Fog

Path: `DEMOS/A-F/Fog_BASIC.sid`

Author: Wesu · Release/year: 198? Spectre

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `d29695b9589e7ce0160ac3345ab8dd57`; SHA-256: `84b350da1f9ce785eebb98c7df8d715b602c564f86de010ff9bdcf6551751c8d`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 6.061e-2; 441 | ΔRMS 1.076e-1; writes 1; prefix 1; drift 0 | ΔRMS 1.180e-1; writes 148; prefix 1; drift 0 | ΔRMS 1.076e-1; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Prologue [from the movie The Fog]
>  ARTIST: John Carpenter

## Four Voices

Path: `DEMOS/A-F/Four_Voices.sid`

Author: Rickard Lihuvudh (Zeus) · Release/year: 1988 The CIA Crew

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `975d064fab78ccb9a034786e15d46f49`; SHA-256: `94e98635279c8aecf1b2b3fea8ff3fb6741f256751125b0202bbea0dd09f5b83`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 3.797e-2; 20967 | ΔRMS 1.381e-2; writes 20973; prefix 441; drift 116; derived | identical PCM; writes 20967; prefix 20967; drift 0; derived | ΔRMS 1.381e-2; writes 20973; prefix 441; drift 116 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Frosty the Snowman

Path: `DEMOS/A-F/Frosty_the_Snowman_BASIC.sid`

Author: Howard Strasberg · Release/year: 1983 Howard Strasberg

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `0a40c532819e4ae1f0f2d1fca0024edf`; SHA-256: `d16a831111b5cdd8051f114b7700fd14c2c91d0771357158918301119d2a81e6`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 3.997e-2; 206 | ΔRMS 3.986e-2; writes 1; prefix 1; drift 0 | ΔRMS 4.720e-2; writes 44; prefix 1; drift 0 | ΔRMS 3.986e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Frosty the Snowman
>  ARTIST: Steve Nelson and Walter E. "Jack" Rollins

## Funk Rock

Path: `DEMOS/A-F/Funk_Rock_BASIC.sid`

Author: Brain Porter &amp; Nick Shevchenko · Release/year: 1984 B. Porter &amp; N. Shevchenko

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `a07ef3fe656a2b33ea3358b547aaa9f4`; SHA-256: `95a427bf5ab260cb19865db83c7e9a017256a0b63b62c13e910fff7a90b3e273`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 60 | both-sensitive | 9.525e-2; 2249 | ΔRMS 9.524e-2; writes 1; prefix 1; drift 0 | ΔRMS 9.619e-2; writes 1458; prefix 1; drift 0 | ΔRMS 9.524e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> COMMENT: This tune takes 10 seconds to start.

## C= Prog Ref Guide (example 01)

Path: `DEMOS/Commodore/C_Prog_Ref_Guide_example_01_BASIC.sid`

Author: &lt;?&gt; · Release/year: 1982 Commodore

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `d27f40d62424df0c262da0ce3bf16c20`; SHA-256: `80c250d68625367028b4655c35ec2964f295951a344a5b285db0f8f0322b56db`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 3.177e-2; 97 | ΔRMS 3.179e-2; writes 1; prefix 1; drift 0 | ΔRMS 3.988e-2; writes 148; prefix 1; drift 0 | ΔRMS 3.179e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> Directory note /DEMOS/Commodore/
> COMMENT: This directory contains mainly files from the C64 manuals or test disks
>          that came along with the various computer and drive models. Among these
>          there are demotunes from the original 1982 Commodore demo disk.
>          The first tunes on the C64!

## C= Prog Ref Guide (example 02)

Path: `DEMOS/Commodore/C_Prog_Ref_Guide_example_02_BASIC.sid`

Author: &lt;?&gt; · Release/year: 1982 Commodore

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `011f032edc2f72224310ebde3fc9d652`; SHA-256: `1ab5eb9b1c07546fbdcab948d964aebaa62f7a0693bf1d69f1904a59583fda08`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 60 | both-sensitive | 7.445e-2; 1386 | ΔRMS 7.467e-2; writes 1; prefix 1; drift 0 | ΔRMS 7.472e-2; writes 850; prefix 1; drift 0 | ΔRMS 7.467e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> Directory note /DEMOS/Commodore/
> COMMENT: This directory contains mainly files from the C64 manuals or test disks
>          that came along with the various computer and drive models. Among these
>          there are demotunes from the original 1982 Commodore demo disk.
>          The first tunes on the C64!
>
> COMMENT: This tune takes 33 seconds to start, just like the corresponding
>          BASIC program. The tune was later used in the infamous game
>          Stroker 64, playing at double speed.

## C= Prog Ref Guide (example 03)

Path: `DEMOS/Commodore/C_Prog_Ref_Guide_example_03_BASIC.sid`

Author: &lt;?&gt; · Release/year: 1982 Commodore

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `1f3834a3c4b6330adf40b9a9f54f6a34`; SHA-256: `1d8a4424cb71b62daf85339a786e3e114a357c8c7f98d0363ff9b20eeefffaf4`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 3.178e-2; 97 | ΔRMS 3.180e-2; writes 1; prefix 1; drift 0 | ΔRMS 3.989e-2; writes 148; prefix 1; drift 0 | ΔRMS 3.180e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> Directory note /DEMOS/Commodore/
> COMMENT: This directory contains mainly files from the C64 manuals or test disks
>          that came along with the various computer and drive models. Among these
>          there are demotunes from the original 1982 Commodore demo disk.
>          The first tunes on the C64!

## C= Prog Ref Guide (example 04)

Path: `DEMOS/Commodore/C_Prog_Ref_Guide_example_04_BASIC.sid`

Author: &lt;?&gt; · Release/year: 1982 Commodore

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `33cb81876433e93d29cd698878ef102e`; SHA-256: `cd2445ac7c9218fa99055b20c1a40e07fd4a313383f98e72c95e401efc8e504c`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 4.488e-2; 97 | ΔRMS 4.491e-2; writes 1; prefix 1; drift 0 | ΔRMS 5.086e-2; writes 148; prefix 1; drift 0 | ΔRMS 4.491e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> Directory note /DEMOS/Commodore/
> COMMENT: This directory contains mainly files from the C64 manuals or test disks
>          that came along with the various computer and drive models. Among these
>          there are demotunes from the original 1982 Commodore demo disk.
>          The first tunes on the C64!

## C= Prog Ref Guide (example 05)

Path: `DEMOS/Commodore/C_Prog_Ref_Guide_example_05_BASIC.sid`

Author: &lt;?&gt; · Release/year: 1982 Commodore

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `ccb8a66d68b2af7a336d9b5ce6c7ea42`; SHA-256: `7269e8fecb20b01a89fb41c18a4430dbbcab51ff561ba0a716d659704ed422de`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 5.439e-2; 322 | ΔRMS 5.447e-2; writes 1; prefix 1; drift 0 | ΔRMS 5.883e-2; writes 148; prefix 1; drift 0 | ΔRMS 5.447e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> Directory note /DEMOS/Commodore/
> COMMENT: This directory contains mainly files from the C64 manuals or test disks
>          that came along with the various computer and drive models. Among these
>          there are demotunes from the original 1982 Commodore demo disk.
>          The first tunes on the C64!
>
> TITLE: The Entertainer
>  ARTIST: Scott Joplin
> COMMENT: Also used in the games "Hot Air", (C) 1984 Computer &amp; Video Games, and
>          "Qwakers", (C) 1985 Your Computer, with slightly faster vibrato due to
>          a typo.

## C= Prog Ref Guide (example 07)

Path: `DEMOS/Commodore/C_Prog_Ref_Guide_example_07_BASIC.sid`

Author: &lt;?&gt; · Release/year: 1982 Commodore

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `0f5bd7bd6e0ad2d0d73347852d8a35e4`; SHA-256: `99b144cb7eaee881bc30a143a53f2f3e7a3ba98567f1fc13a0d39a74866e888a`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 7.952e-2; 433 | ΔRMS 1.138e-1; writes 1; prefix 1; drift 0 | ΔRMS 1.230e-1; writes 148; prefix 1; drift 0 | ΔRMS 1.138e-1; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> Directory note /DEMOS/Commodore/
> COMMENT: This directory contains mainly files from the C64 manuals or test disks
>          that came along with the various computer and drive models. Among these
>          there are demotunes from the original 1982 Commodore demo disk.
>          The first tunes on the C64!

## Commodore 64 Christmas Album

Path: `DEMOS/Commodore/Commodore_64_Christmas_Album_BASIC.sid`

Author: Wayne Eastwood · Release/year: 1983 Commodore

RSID; BASIC flag set; 7 subtunes. Complete-file MD5: `95826be9b06300b1c112466db74c34da`; SHA-256: `ad228874e04ddb8f6aa2d1dcc15593cdeb65a2ef6c7610df467c3b4a169bb474`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 6.380e-2; 624 | ΔRMS 6.742e-2; writes 1; prefix 1; drift 0 | ERROR: Illegal instruction $12 at address $2042; writes 44; prefix 2; drift 38732 | ΔRMS 6.742e-2; writes 1; prefix 1; drift 0 |
| 2 | 10 | both-sensitive | 7.645e-2; 664 | ΔRMS 7.876e-2; writes 1; prefix 1; drift 0 | ERROR: Illegal instruction $12 at address $2042; writes 44; prefix 2; drift 38732 | ΔRMS 7.976e-2; writes 2; prefix 2; drift 502 |
| 3 | 10 | both-sensitive | 5.594e-2; 499 | ERROR: Illegal instruction $02 at address $bf54; writes 1; prefix 1; drift 0 | ERROR: Illegal instruction $12 at address $2042; writes 44; prefix 2; drift 38732 | ΔRMS 5.478e-2; writes 2; prefix 2; drift 502 |
| 4 | 10 | both-sensitive | 9.145e-2; 598 | ΔRMS 9.771e-2; writes 1; prefix 1; drift 0 | ERROR: Illegal instruction $12 at address $2042; writes 44; prefix 2; drift 38732 | ΔRMS 1.001e-1; writes 2; prefix 2; drift 502 |
| 5 | 10 | both-sensitive | 5.471e-2; 511 | ΔRMS 5.734e-2; writes 1; prefix 1; drift 0 | ERROR: Illegal instruction $12 at address $2042; writes 44; prefix 2; drift 38732 | ΔRMS 5.834e-2; writes 2; prefix 2; drift 502 |
| 6 | 10 | both-sensitive | 6.220e-2; 567 | ΔRMS 6.692e-2; writes 1; prefix 1; drift 0 | ERROR: Illegal instruction $12 at address $2042; writes 44; prefix 2; drift 38732 | ΔRMS 6.893e-2; writes 2; prefix 2; drift 502 |
| 7 | 10 | both-sensitive | 7.388e-2; 616 | ΔRMS 7.433e-2; writes 1; prefix 1; drift 0 | ERROR: Illegal instruction $12 at address $2042; writes 44; prefix 2; drift 38732 | ΔRMS 7.272e-2; writes 2; prefix 2; drift 502 |

STIL (full available entry and applicable directory notes):

> Directory note /DEMOS/Commodore/
> COMMENT: This directory contains mainly files from the C64 manuals or test disks
>          that came along with the various computer and drive models. Among these
>          there are demotunes from the original 1982 Commodore demo disk.
>          The first tunes on the C64!
>
> (#1)
>   TITLE: In Dulci Jubilo
>  ARTIST: Traditional
> (#2)
>   TITLE: One Horse Open Sleigh
>  ARTIST: James Lord Pierpont
> (#3)
>   TITLE: Stille Nacht! Heilige Nacht!
>  ARTIST: Joseph Mohr (lyrics), Franz Xaver Gruber (music)
> COMMENT: A Christmas song also known as "Silent Night".
> (#4)
>   TITLE: Rudolph The Red Nosed Reindeer
>  ARTIST: Johnny Marks
> (#5)
>   TITLE: Gloria in Excelsis Deo
>  ARTIST: French Carol
> COMMENT: Also known as "Angels We Have Heard on High".
> (#6)
>   TITLE: Frosty The Snowman
>  ARTIST: Steve Nelson and Walter E. "Jack" Rollins
> (#7)
>   TITLE: Two-Part Invention No. 13, in A minor (BWV 784)
>  ARTIST: Johann Sebastian Bach

## Commodore User's Guide (NTSC)

Path: `DEMOS/Commodore/Commodore_Users_Guide_NTSC_BASIC.sid`

Author: &lt;?&gt; · Release/year: 1982 Commodore

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `df80ded2cff0aab318a0ed2ebe7b7771`; SHA-256: `fb0f426bc1b3f3af2f0ab0deb43dfc821bdc046ba762edcfe2940d322f8cc5ec`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 3.232e-2; 79 | ΔRMS 4.170e-2; writes 1; prefix 1; drift 0 | ΔRMS 4.180e-2; writes 155; prefix 1; drift 0 | ΔRMS 4.170e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> Directory note /DEMOS/Commodore/
> COMMENT: This directory contains mainly files from the C64 manuals or test disks
>          that came along with the various computer and drive models. Among these
>          there are demotunes from the original 1982 Commodore demo disk.
>          The first tunes on the C64!
>
> TITLE: Michael Row The Boat Ashore
>  ARTIST: Traditional

## Commodore User's Guide (PAL)

Path: `DEMOS/Commodore/Commodore_Users_Guide_PAL_BASIC.sid`

Author: &lt;?&gt; · Release/year: 1982 Commodore

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `599c93c4dcae1331ef8bb83989e9883e`; SHA-256: `eed0fae9ad53a047fa7180065fa2f4ca9999ac0c5f67308d96c4bd5f58b15549`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 3.183e-2; 79 | ΔRMS 4.132e-2; writes 1; prefix 1; drift 0 | ΔRMS 4.120e-2; writes 148; prefix 1; drift 0 | ΔRMS 4.132e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> Directory note /DEMOS/Commodore/
> COMMENT: This directory contains mainly files from the C64 manuals or test disks
>          that came along with the various computer and drive models. Among these
>          there are demotunes from the original 1982 Commodore demo disk.
>          The first tunes on the C64!
>
> TITLE: Michael Row The Boat Ashore
>  ARTIST: Traditional

## Fugue in G Minor (J.S. Bach)

Path: `DEMOS/Commodore/Fugue_in_G_Minor_J_S_Bach_BASIC.sid`

Author: Andy Toy · Release/year: 1983 Commodore

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `6c861315951d0e9aeba632aceb2da925`; SHA-256: `9da1abfde672c090247d56cbe879e0e3c68d1d44729b25b2513dd612712a3a5e`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 5.279e-2; 125 | ΔRMS 5.271e-2; writes 1; prefix 1; drift 0 | ΔRMS 5.846e-2; writes 243; prefix 1; drift 0 | ΔRMS 5.271e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> Directory note /DEMOS/Commodore/
> COMMENT: This directory contains mainly files from the C64 manuals or test disks
>          that came along with the various computer and drive models. Among these
>          there are demotunes from the original 1982 Commodore demo disk.
>          The first tunes on the C64!
>
> TITLE: Fugue in G Minor (BWV 578)
>  ARTIST: Johann Sebastian Bach

## Gigue in G (G.F. Handel)

Path: `DEMOS/Commodore/Gigue_in_G_G_F_Handel_BASIC.sid`

Author: &lt;?&gt; · Release/year: 198? Commodore

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `e13c0cd84d052fcde8962d5b5d04ea8b`; SHA-256: `3572b165af81a195af499af8660045375a63d49fe796d206d8ed1524153ab608`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 7.861e-2; 387 | ΔRMS 7.858e-2; writes 1; prefix 1; drift 0 | ΔRMS 8.254e-2; writes 148; prefix 1; drift 0 | ΔRMS 7.858e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> Directory note /DEMOS/Commodore/
> COMMENT: This directory contains mainly files from the C64 manuals or test disks
>          that came along with the various computer and drive models. Among these
>          there are demotunes from the original 1982 Commodore demo disk.
>          The first tunes on the C64!

## Gigue in G Minor (G.F. Handel)

Path: `DEMOS/Commodore/Gigue_in_G_Minor_G_F_Handel_BASIC.sid`

Author: &lt;?&gt; · Release/year: 198? Commodore

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `8224767ec49d5166182956f4786878a4`; SHA-256: `bf6442f735d266d803db2735237190fc86fe1492fb1b4011cbf94fc8fcd660b9`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 8.750e-2; 440 | ΔRMS 8.747e-2; writes 1; prefix 1; drift 0 | ERROR: Illegal instruction $32 at address $2030; writes 44; prefix 1; drift 0 | ΔRMS 8.747e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> Directory note /DEMOS/Commodore/
> COMMENT: This directory contains mainly files from the C64 manuals or test disks
>          that came along with the various computer and drive models. Among these
>          there are demotunes from the original 1982 Commodore demo disk.
>          The first tunes on the C64!
>
> TITLE: Gigue in G minor
>  ARTIST: Georg Friedrich Händel

## Golden Brown

Path: `DEMOS/Commodore/Golden_Brown_BASIC.sid`

Author: &lt;?&gt; · Release/year: 198? Commodore

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `1a8d3b3224b521adc4f27f2d6ea29d04`; SHA-256: `1f28bda652349b0459ea88aee76656740dbe3d4416abcd5bd5047b63859f9f7b`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 1.090e-1; 307 | ΔRMS 1.090e-1; writes 1; prefix 1; drift 0 | ΔRMS 1.114e-1; writes 148; prefix 1; drift 0 | ERROR: Illegal instruction $22 at address $0e91; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> Directory note /DEMOS/Commodore/
> COMMENT: This directory contains mainly files from the C64 manuals or test disks
>          that came along with the various computer and drive models. Among these
>          there are demotunes from the original 1982 Commodore demo disk.
>          The first tunes on the C64!
>
> TITLE: Golden Brown [from La Folie]
>  ARTIST: The Stranglers

## Invention #1 in C (J.S. Bach)

Path: `DEMOS/Commodore/Invention_1_in_C_J_S_Bach_BASIC.sid`

Author: &lt;?&gt; · Release/year: 198? Commodore

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `905249c9b96278434a9bf17090991ae9`; SHA-256: `e29203b991b0c92047ac3ba7a51877b54f954588fd0692fcbf5012117b63886c`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 7.321e-2; 389 | ΔRMS 7.942e-2; writes 1; prefix 1; drift 0 | ΔRMS 8.678e-2; writes 148; prefix 1; drift 0 | ΔRMS 7.942e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> Directory note /DEMOS/Commodore/
> COMMENT: This directory contains mainly files from the C64 manuals or test disks
>          that came along with the various computer and drive models. Among these
>          there are demotunes from the original 1982 Commodore demo disk.
>          The first tunes on the C64!
>
> TITLE: Two-Part Invention No. 1, in C major (BWV 772)
>  ARTIST: Johann Sebastian Bach

## Invention in F (J.S. Bach)

Path: `DEMOS/Commodore/Invention_in_F_J_S_Bach_BASIC.sid`

Author: W.J. Brier · Release/year: 198? Commodore

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `7445f0e9ede0cc7d4106cbafd8e609fb`; SHA-256: `c0392723f42a5e3ee3ab76af86193624963b3e1e8d3ce609f7692058c0b25d46`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 1.004e-1; 613 | ΔRMS 1.028e-1; writes 1; prefix 1; drift 0 | ΔRMS 1.078e-1; writes 237; prefix 1; drift 0 | ΔRMS 1.028e-1; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> Directory note /DEMOS/Commodore/
> COMMENT: This directory contains mainly files from the C64 manuals or test disks
>          that came along with the various computer and drive models. Among these
>          there are demotunes from the original 1982 Commodore demo disk.
>          The first tunes on the C64!
>
> TITLE: Two-Part Invention No. 8, in F major (BWV 779)
>  ARTIST: Johann Sebastian Bach

## M1 Musik

Path: `DEMOS/Commodore/M1_Musik_BASIC.sid`

Author: &lt;?&gt; · Release/year: 1982 Commodore

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `ab18b96b52e9b62dd7640051e75fcae3`; SHA-256: `4a95c93f0cf98656b868d5160db1265273cb34e402fa215d3e2e10692e33ac5c`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 9.032e-2; 721 | ΔRMS 9.432e-2; writes 1; prefix 1; drift 0 | ERROR: Illegal instruction $42 at address $2043; writes 44; prefix 1; drift 0 | ΔRMS 9.432e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> Directory note /DEMOS/Commodore/
> COMMENT: This directory contains mainly files from the C64 manuals or test disks
>          that came along with the various computer and drive models. Among these
>          there are demotunes from the original 1982 Commodore demo disk.
>          The first tunes on the C64!
>
> COMMENT: The original BASIC program takes 31 seconds to start.

## M2 Synthesizer

Path: `DEMOS/Commodore/M2_Synthesizer_BASIC.sid`

Author: &lt;?&gt; · Release/year: 1982 Commodore

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `3d6daf5730f6bc935136a63aff4a46ee`; SHA-256: `28d514f5b1224628733f42ba43be7269ff3ed3dfaa64cb2f44bde65f98519c4d`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 5.683e-2; 463 | ΔRMS 5.685e-2; writes 1; prefix 1; drift 0 | ΔRMS 6.150e-2; writes 148; prefix 1; drift 0 | ΔRMS 5.685e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> Directory note /DEMOS/Commodore/
> COMMENT: This directory contains mainly files from the C64 manuals or test disks
>          that came along with the various computer and drive models. Among these
>          there are demotunes from the original 1982 Commodore demo disk.
>          The first tunes on the C64!
>
> TITLE: Jesu, Joy of Man's Desiring (Cantata, BWV 147)
>  ARTIST: Johann Sebastian Bach

## M5 Gong

Path: `DEMOS/Commodore/M5_Gong_BASIC.sid`

Author: &lt;?&gt; · Release/year: 1982 Commodore

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `71bef5574282d6fc57a8bead3122e589`; SHA-256: `702b7627a74a2b442c851c37419b53b394f7577e3db654548b0190c073c95509`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 3.434e-2; 156 | ΔRMS 3.433e-2; writes 1; prefix 1; drift 0 | ΔRMS 4.199e-2; writes 148; prefix 1; drift 0 | ΔRMS 3.433e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> Directory note /DEMOS/Commodore/
> COMMENT: This directory contains mainly files from the C64 manuals or test disks
>          that came along with the various computer and drive models. Among these
>          there are demotunes from the original 1982 Commodore demo disk.
>          The first tunes on the C64!

## M6 Bomb

Path: `DEMOS/Commodore/M6_Bomb_BASIC.sid`

Author: &lt;?&gt; · Release/year: 1982 Commodore

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `3f6d3b732002b7841941549b2a0e65e7`; SHA-256: `7bc4c16449ecf6ef0ad965c2069cd5804025188b7ed5f40ef4e2e294999d7b03`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 3.573e-2; 343 | ΔRMS 3.807e-2; writes 1; prefix 1; drift 0 | ΔRMS 3.951e-2; writes 148; prefix 1; drift 0 | ΔRMS 3.807e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> Directory note /DEMOS/Commodore/
> COMMENT: This directory contains mainly files from the C64 manuals or test disks
>          that came along with the various computer and drive models. Among these
>          there are demotunes from the original 1982 Commodore demo disk.
>          The first tunes on the C64!

## M8 Sound

Path: `DEMOS/Commodore/M8_Sound_BASIC.sid`

Author: &lt;?&gt; · Release/year: 1982 Commodore

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `a94ecbd24473fd523e6f6c7f1345ca9c`; SHA-256: `2d19b370d117b4a4ac617570217a0f33360c105a9dadd3ace6c606638718ee41`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 5.250e-2; 595 | ΔRMS 5.260e-2; writes 1; prefix 1; drift 0 | ΔRMS 5.722e-2; writes 148; prefix 1; drift 0 | ΔRMS 5.260e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> Directory note /DEMOS/Commodore/
> COMMENT: This directory contains mainly files from the C64 manuals or test disks
>          that came along with the various computer and drive models. Among these
>          there are demotunes from the original 1982 Commodore demo disk.
>          The first tunes on the C64!

## Minuet in G (J.S. Bach)

Path: `DEMOS/Commodore/Minuet_in_G_J_S_Bach_BASIC.sid`

Author: &lt;?&gt; · Release/year: 198? Commodore

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `02db17bd6273af5f2b44f76e6063cca3`; SHA-256: `22f6ec139692722105f517e85b583523bc2b12d77d315dad1b3916c83f858cc9`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 1.077e-1; 292 | ΔRMS 1.527e-1; writes 1; prefix 1; drift 0 | ΔRMS 1.615e-1; writes 148; prefix 1; drift 0 | ΔRMS 1.527e-1; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> Directory note /DEMOS/Commodore/
> COMMENT: This directory contains mainly files from the C64 manuals or test disks
>          that came along with the various computer and drive models. Among these
>          there are demotunes from the original 1982 Commodore demo disk.
>          The first tunes on the C64!
>
> TITLE: Minuet in G major
>  ARTIST: Christian Petzold
> COMMENT: Although previously attributed to Johann Sebastian Bach
>          (BWV Anh. 114), it's now believed to be composed by Christian Petzold.

## Polonaise in G Minor (CPE Bach)

Path: `DEMOS/Commodore/Polonaise_in_G_Minor_CPE_Bach_BASIC.sid`

Author: &lt;?&gt; · Release/year: 198? Commodore

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `6f6c94eb86824a1c0c33c0b37856f38d`; SHA-256: `b9f81f68db7e14382ebd542c28bcc76d24bdc2d703ba9f98a9d9e9d3e7569cb0`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 1.028e-1; 287 | ΔRMS 1.028e-1; writes 1; prefix 1; drift 0 | ΔRMS 1.058e-1; writes 148; prefix 1; drift 0 | ΔRMS 1.028e-1; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> Directory note /DEMOS/Commodore/
> COMMENT: This directory contains mainly files from the C64 manuals or test disks
>          that came along with the various computer and drive models. Among these
>          there are demotunes from the original 1982 Commodore demo disk.
>          The first tunes on the C64!
>
> TITLE: Polonaise in G minor (BWV Anh. 125)
>  ARTIST: Carl Philipp Emanuel Bach

## Gabooto (Bach)

Path: `DEMOS/G-L/Gabooto_Bach_BASIC.sid`

Author: Keiji Bessi · Release/year: 1983 VIC! Magazine

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `eebb1653ae54d03cede59909fe76397c`; SHA-256: `fe590f891893bc9ee8a7bc93a86701350134d346233134193d73da678cd77efe`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 7.698e-2; 251 | ΔRMS 7.755e-2; writes 1; prefix 1; drift 0 | ERROR: Illegal instruction $32 at address $2023; writes 44; prefix 1; drift 0 | ΔRMS 7.755e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Gavotte [from French Suite No. 6 in E major (BWV 817)]
>  ARTIST: Johann Sebastian Bach

## Gammelt Venskab

Path: `DEMOS/G-L/Gammelt_Venskab_BASIC.sid`

Author: JBJ · Release/year: 1986 JBJ

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `afb1ba7ee378761c45cbfc3c16d1b031`; SHA-256: `6f5128414dcbf62861ea66bb5f8d71d26c15c80369d04ae46c87215998d53786`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 1.329e-1; 245 | ΔRMS 2.626e-1; writes 1; prefix 1; drift 0 | ΔRMS 2.548e-1; writes 148; prefix 1; drift 0 | ERROR: Illegal instruction $42 at address $a005; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Auld Lang Syne
>  ARTIST: Scottish Traditional

## Goddesses

Path: `DEMOS/G-L/Goddesses.sid`

Author: Frank Inklaar · Release/year: 1985 Frank Inklaar

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `6872fb11495e531a713054b3ae261a6c`; SHA-256: `5f6277ea21a2748cfbd6c358580339c2dbc36a404b8b8c42502599fec810ed4d`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 7.810e-2; 203 | ΔRMS 7.472e-2; writes 203; prefix 203; drift 6875; derived | identical PCM; writes 203; prefix 203; drift 0; derived | ΔRMS 7.472e-2; writes 203; prefix 203; drift 6875 |

STIL (full available entry and applicable directory notes):

> TITLE: Quodling's Delight
>  ARTIST: Giles Farnaby
> COMMENT: Also known as "The Goddesses".

## Got to Be Certain

Path: `DEMOS/G-L/Got_to_Be_Certain.sid`

Author: Steve Hammond (Iceman) · Release/year: 1988 Shadow Line

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `a240523e1c14cafa6981375a60c5fc4a`; SHA-256: `bb09b3fe86016e6a7680607cc3aaea1b0cee4dea38995fe287083c4c48ab61c2`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 6.347e-2; 43336 | ΔRMS 3.926e-2; writes 43336; prefix 1628; drift 87; derived | identical PCM; writes 43336; prefix 43336; drift 0; derived | ΔRMS 3.926e-2; writes 43336; prefix 1628; drift 87 |

STIL (full available entry and applicable directory notes):

> TITLE: Got to Be Certain [from Kylie]
>  ARTIST: Kylie Minogue

## Gott Och Blandat

Path: `DEMOS/G-L/Gott_Och_Blandat.sid`

Author: Daniel Persson (D Vibe) · Release/year: 2008 Nature

PSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `3221d467af441f30054f5095f1b49019`; SHA-256: `a74b1d21c6d71d63479904b308fd571582e4b4132f1c5b525b3074c51acd5397`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 60 | both-sensitive | 8.358e-2; 64233 | ΔRMS 8.589e-2; writes 64416; prefix 63; drift 1149 | ΔRMS 6.215e-2; writes 64416; prefix 63; drift 1149 | ΔRMS 8.535e-2; writes 64233; prefix 64233; drift 6344 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Hey Jude

Path: `DEMOS/G-L/Hey_Jude_BASIC.sid`

Author: Lars Christian Kvitle · Release/year: 1989 Lars Christian Kvitle

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `1f2c9bae2a352dd98915b422b041647d`; SHA-256: `7603921f7816a84c5a003002b73cbae02b09a3aa04a0ebfbef3ca6463422138d`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 6.548e-2; 161 | ΔRMS 6.550e-2; writes 1; prefix 1; drift 0 | ΔRMS 6.964e-2; writes 148; prefix 1; drift 0 | ΔRMS 6.550e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Hey Jude [from the B-side of the Revolution 7" single]
>  ARTIST: The Beatles

## Hymna CCCP

Path: `DEMOS/G-L/Hymna_CCCP_BASIC.sid`

Author: Mousesoft · Release/year: 19?? Mousesoft Research Ltd.

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `b6e2549c90b80cf0edb4c02514c92f51`; SHA-256: `8045361bf4dd3720c2c07cbd3a59893852f31eb9ed274c235eec7706ea1c43b2`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 9.522e-2; 606 | ΔRMS 2.603e-1; writes 1; prefix 1; drift 0 | ΔRMS 2.517e-1; writes 148; prefix 1; drift 0 | ΔRMS 2.603e-1; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: National Anthem of the Soviet Union
>  ARTIST: Aleksandr Aleksandrov

## Icelord's Worst

Path: `DEMOS/G-L/Icelords_Worst.sid`

Author: Icelord · Release/year: 1987 Icelord

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `e7b1c7cf1b31669dd98c6e859a50ac3d`; SHA-256: `fa842cd55a7f51be86395279eedbeaf5af839dc49d72d93b820fede19cb70621`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 1.252e-1; 42785 | ΔRMS 1.951e-1; writes 42301; prefix 42301; drift 92206; derived | identical PCM; writes 42785; prefix 42785; drift 0; derived | ΔRMS 1.951e-1; writes 42301; prefix 42301; drift 92206 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Ikari++

Path: `DEMOS/G-L/Ikari_plus_plus.sid`

Author: Magnus Sundström (Mr Mad) · Release/year: 1988 Genesis

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `d9bdcfd0e8591ea823003e8f72e7ffdb`; SHA-256: `aba1d636b1580c755ea10d2d0ae959e11234fdbd58439c372a8ecefd1469f7c7`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 5.669e-2; 27705 | ΔRMS 2.943e-2; writes 27705; prefix 430; drift 108; derived | identical PCM; writes 27705; prefix 27705; drift 0; derived | ΔRMS 2.943e-2; writes 27705; prefix 430; drift 108 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## In My House

Path: `DEMOS/G-L/In_My_House.sid`

Author: Redjac · Release/year: 198? Redjac

PSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `40d5303a50760e510014b27fdf4135e9`; SHA-256: `ac9e7c1cd325163edb4ef4fb8a1d709e175556949707457dca8679f3936e0e88`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 1.280e-1; 10834 | ΔRMS 7.938e-3; writes 10834; prefix 52; drift 11; derived | identical PCM; writes 10834; prefix 10834; drift 0; derived | ΔRMS 7.938e-3; writes 10834; prefix 52; drift 11 |

STIL (full available entry and applicable directory notes):

> TITLE: In My House
>  ARTIST: Mary Jane Girls

## In Your Head

Path: `DEMOS/G-L/In_Your_Head_BASIC.sid`

Author: Boris Müller (Chipsi) · Release/year: 1988 Boris Müller

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `7dd7b4f4fca71a02a3829ceb53e96e45`; SHA-256: `07cb2925dde7e05f094b590cfaa6b3bab880de6b26f32c2762a7ae88a068d3e8`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 3.139e-2; 944 | ΔRMS 3.131e-2; writes 1; prefix 1; drift 0 | ΔRMS 4.022e-2; writes 148; prefix 1; drift 0 | ΔRMS 3.131e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Invention 13

Path: `DEMOS/G-L/Invention_13_BASIC.sid`

Author: Andreas Bien · Release/year: 1985 Andreas Bien

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `cccc28914ee1584f389cb51019bee720`; SHA-256: `82f93b991015f1cdca56c495b3eb43da0bbc8f5c171609a166c7bce65c69b440`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 1.124e-1; 546 | ΔRMS 1.528e-1; writes 1; prefix 1; drift 0 | ΔRMS 1.606e-1; writes 237; prefix 1; drift 0 | ΔRMS 1.528e-1; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Two-Part Invention No. 13, in A minor (BWV 784)
>  ARTIST: Johann Sebastian Bach

## Iron-Drums

Path: `DEMOS/G-L/Iron-Drums.sid`

Author: Eric de Jong · Release/year: 1987 Fire-Eagle

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `ba77d57f5aabc40d3228703dc0dbe95b`; SHA-256: `6c407e250d7a0d58bc57070a1197092c8f93e0e5d3a84b7ed43df150870ca9f9`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 4.595e-2; 66314 | ΔRMS 1.093e-2; writes 66314; prefix 261; drift 138; derived | identical PCM; writes 66314; prefix 66314; drift 0; derived | ΔRMS 1.093e-2; writes 66314; prefix 261; drift 138 |

STIL (full available entry and applicable directory notes):

> COMMENT: Same as /MUSICIANS/B/Beatbox/Evolution.sid with added digis.

## Jam Party

Path: `DEMOS/G-L/Jam_Party.sid`

Author: The Jock · Release/year: 1987 The Zeroboys

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `0d8f4f8ea75bf3a69f2ef16b7792a690`; SHA-256: `c2e7bf743274646035c8cfcdc8970ceb1198752c4d1991d3e0edc2dc9fb4c090`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 6.359e-2; 22842 | ΔRMS 2.017e-2; writes 22842; prefix 1284; drift 161; derived | identical PCM; writes 22842; prefix 22842; drift 0; derived | ΔRMS 2.017e-2; writes 22842; prefix 1284; drift 161 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Jesu, Joy of Man's Desiring

Path: `DEMOS/G-L/Jesu_Joy_of_Mans_Desiring_BASIC.sid`

Author: Douglas A. Burr · Release/year: 1984 Douglas A. Burr

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `f84960bf98d66c16a7f403042f583dde`; SHA-256: `39566cd9652da8a5ab41023f48ffb6f79fb1c7116dc5ecb3cec80c22c7cc3e6b`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 7.696e-2; 328 | ΔRMS 7.781e-2; writes 1; prefix 1; drift 0 | ERROR: Illegal instruction $32 at address $202a; writes 44; prefix 1; drift 0 | ΔRMS 7.781e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Jesu, Joy of Man's Desiring (Cantata, BWV 147)
>  ARTIST: Johann Sebastian Bach

## Jingle Bells

Path: `DEMOS/G-L/Jingle_Bells_BASIC.sid`

Author: John Jainschigg &amp; Paul Dixon · Release/year: 1985 Family Computing

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `111ad9f282fbf0fa62c233112c864f87`; SHA-256: `8cf0f229ebfbc8c94a71095a94721885a53219627baeea5f5acb17a58d574991`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 3.011e-2; 135 | ΔRMS 2.997e-2; writes 1; prefix 1; drift 0 | ΔRMS 3.922e-2; writes 155; prefix 1; drift 0 | ΔRMS 2.997e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: One Horse Open Sleigh
>  ARTIST: James Lord Pierpont
> COMMENT: Winter song commonly referred to as Christmas song "Jingle Bells".

## Just a Demo

Path: `DEMOS/G-L/Just_a_Demo.sid`

Author: Flash · Release/year: 1987 Team Frontline

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `316a8330e825439a400627f1687dc252`; SHA-256: `c37a70e4781f71cf9d90d77943e949ebe9e2fcbea184c016424ebf4d3b3f1c41`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 4.718e-2; 93055 | ΔRMS 3.974e-2; writes 93109; prefix 382; drift 119; derived | identical PCM; writes 93055; prefix 93055; drift 0; derived | ΔRMS 3.974e-2; writes 93109; prefix 382; drift 119 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## The Kanon

Path: `DEMOS/G-L/Kanon_BASIC.sid`

Author: Andy Toy · Release/year: 1983 Andy Toy

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `de6b40fc1c04e043592d34c910c5962b`; SHA-256: `c147a7eb21e984d7aed6d283d4173dc696df4625d672174825eb29a2876a9406`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 7.561e-2; 74 | ΔRMS 7.556e-2; writes 1; prefix 1; drift 0 | ERROR: Illegal instruction $32 at address $3401; writes 44; prefix 1; drift 0 | ΔRMS 7.556e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Canon in D major
>  ARTIST: Johann Pachelbel

## Keep This Frequency Clear

Path: `DEMOS/G-L/Keep_This_Frequency_Clear.sid`

Author: Jon B. · Release/year: 1988 The Masters

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `5af1536fecc684cfe651e60cd29473f3`; SHA-256: `3671d2f9b376af1b43ebf3c932b0929caace0b6a6aab365d1daa57ea87453f27`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 4.933e-2; 56143 | ΔRMS 1.324e-2; writes 56142; prefix 2676; drift 11; derived | identical PCM; writes 56143; prefix 56143; drift 0; derived | ΔRMS 1.324e-2; writes 56142; prefix 2676; drift 11 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Knight Rider

Path: `DEMOS/G-L/Knight_Rider_BASIC.sid`

Author: M. S. · Release/year: 1985 Floppis

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `af921b2b33958459c960c0a2b01f29b7`; SHA-256: `b612c53505293cf6bc1487b6e3b0579642b25ac0028affce16906d2eb28b5dfb`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 4.743e-2; 601 | ΔRMS 7.169e-2; writes 1; prefix 1; drift 0 | ΔRMS 6.872e-2; writes 148; prefix 1; drift 0 | ΔRMS 7.169e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Knight Rider Theme [from the TV series]
>  ARTIST: Glen A. Larson &amp; Stu Phillips

## Lady with the Red Dress

Path: `DEMOS/G-L/Lady_with_the_Red_Dress.sid`

Author: Kim Rebild (KTR) · Release/year: 1993 Fiction

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `90616b1c123742b231e420aed2bfd141`; SHA-256: `2baa5fc503d810f427a72553f5c554489969fba5b7c42ce995d79632936deddb`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 1.093e-1; 44759 | ΔRMS 3.159e-2; writes 44758; prefix 220; drift 76; derived | identical PCM; writes 44759; prefix 44759; drift 0; derived | ΔRMS 3.159e-2; writes 44758; prefix 220; drift 76 |

STIL (full available entry and applicable directory notes):

> TITLE: Lady With the Red Dress [from 12 Inches of Snow]
>  ARTIST: Snow

## Laserdance 1096

Path: `DEMOS/G-L/Laserdance_1096.sid`

Author: TFB · Release/year: 1988 1096

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `99aa8ab45a07c2077f0605045ea7a980`; SHA-256: `e5c9ff898e99314db5b24f081822ac49bb1eaa698af30cfa20671676ae9f6307`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 7.494e-2; 72432 | ΔRMS 3.202e-2; writes 72501; prefix 382; drift 90; derived | identical PCM; writes 72432; prefix 72432; drift 0; derived | ΔRMS 3.202e-2; writes 72501; prefix 382; drift 90 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Let it Snow

Path: `DEMOS/G-L/Let_it_Snow_BASIC.sid`

Author: Jagon Nogaj · Release/year: 19?? Jagon Nogaj

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `a37fab337aca4a2de0fdb8fe199f13da`; SHA-256: `eb6177190962db6ec0ddbfe0beea63daa402f83538826e1d1f52f87b0cd89bc4`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 3.917e-2; 114 | ΔRMS 3.910e-2; writes 1; prefix 1; drift 0 | ΔRMS 4.656e-2; writes 148; prefix 1; drift 0 | ΔRMS 3.910e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Let it Snow! Let it Snow! Let it Snow!
>  ARTIST: Sammy Cahn (lyrics), Jule Styne (music)

## Livin' on a Prayer

Path: `DEMOS/G-L/Livin_on_a_Prayer.sid`

Author: Redjac · Release/year: 198? Redjac

PSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `b6d1824a1f424d21cd334d8a5602a553`; SHA-256: `5a4f74a63983e3e52be940d4ea47df5e002cf0a9962f52d7732c23eb9aa78246`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 7.404e-2; 10168 | ΔRMS 1.016e-2; writes 10168; prefix 132; drift 52; derived | identical PCM; writes 10168; prefix 10168; drift 0; derived | ΔRMS 1.016e-2; writes 10168; prefix 132; drift 52 |

STIL (full available entry and applicable directory notes):

> TITLE: Livin' On A Prayer [from Slippery When Wet]
>  ARTIST: Bon Jovi

## Made in Tay-Wahn

Path: `DEMOS/M-R/Made_in_Tay-Wahn.sid`

Author: Tay · Release/year: 198? Tay

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `97eb4ba3953b5cd6b1af9f7337a88e49`; SHA-256: `7003188c80febc73bd1d325bb5dec69001a1d6e19bc2499d2af48c1f1414b47f`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 4.526e-2; 64280 | ΔRMS 2.076e-2; writes 64254; prefix 3583; drift 404; derived | identical PCM; writes 64280; prefix 64280; drift 0; derived | ΔRMS 2.076e-2; writes 64254; prefix 3583; drift 404 |

STIL (full available entry and applicable directory notes):

> TITLE: Heart [from Actually]
>  ARTIST: Pet Shop Boys

## Mega-Techno-Beat-Sampler(tune 2)

Path: `DEMOS/M-R/Mega-Techno-Beat-Sampler_tune_2.sid`

Author: The Crack Leader · Release/year: 1989 United Artists

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `871ee20e89e5c1ee977d5a7f6cfb42cc`; SHA-256: `73ed25f5980988fe0cf9f71c52377546af1fcba7e95d79a404083cd5e331b4a5`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 4.880e-2; 50117 | ΔRMS 2.545e-2; writes 50115; prefix 286; drift 57; derived | identical PCM; writes 50117; prefix 50117; drift 0; derived | ΔRMS 2.545e-2; writes 50115; prefix 286; drift 57 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Mega Kines (end)

Path: `DEMOS/M-R/Mega_Kines_end_BASIC.sid`

Author: Jyke &lt;?&gt; · Release/year: 1997 PSTK

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `271aed255316c22428a23d3ba81e8d9c`; SHA-256: `2fe589198464ae76dd94cf5d2bb95229649d855e085e74a8a38919a05d9af659`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 1.360e-1; 192 | ΔRMS 1.474e-1; writes 1; prefix 1; drift 0 | ΔRMS 1.452e-1; writes 148; prefix 1; drift 0 | ΔRMS 1.474e-1; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Menuet Visee

Path: `DEMOS/M-R/Menuet_Visee_BASIC.sid`

Author: Gilbert van Cutsem · Release/year: 1983 Gilbert van Cutsem

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `264dbea2415878471b9451da3fc1ab21`; SHA-256: `19ad9b1116c35a8a5c9ef67bd4682288bd2977140c3d4b028f56d4ff1294e642`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 4.699e-2; 190 | ΔRMS 4.718e-2; writes 1; prefix 1; drift 0 | ΔRMS 5.249e-2; writes 148; prefix 1; drift 0 | ΔRMS 4.718e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Menuet &lt;?&gt;
>  ARTIST: Robert de Visée

## Merry Christmas

Path: `DEMOS/M-R/Merry_Christmas_BASIC.sid`

Author: Lars Christian Kvitle · Release/year: 198? Lars Christian Kvitle

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `25868ecb4a50f678e0a1b8774255320a`; SHA-256: `335258bae3760efa45f397d1153e0500bd7ff40fcddda07022e0f0ae70f584b6`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 6.706e-2; 149 | ΔRMS 6.708e-2; writes 1; prefix 1; drift 0 | ΔRMS 7.122e-2; writes 148; prefix 1; drift 0 | ΔRMS 6.708e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: We Wish You a Merry Christmas
>  ARTIST: Traditional
> COMMENT: English carol

## Mini Digi Drum (512 bytes)

Path: `DEMOS/M-R/Mini_Digi_Drum_512_bytes_BASIC.sid`

Author: Leif Bloomquist (Scheme) · Release/year: 2006 AIC

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `5aeaee09c745453c9da656426e6cb599`; SHA-256: `eb8419e5366bd5ce3e4019999597f36fe80626802bf6a40d0d18dcaeffd785b0`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 4.949e-2; 13319 | ΔRMS 8.487e-2; writes 1; prefix 1; drift 0 | ΔRMS 9.824e-2; writes 148; prefix 1; drift 0 | ΔRMS 8.487e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Momo Color

Path: `DEMOS/M-R/Momo_Color_BASIC.sid`

Author: F. Ieda · Release/year: 1983 Commodore Japan

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `0bf9c0c1b960322fe4757e83cda53ebf`; SHA-256: `07ac30d5dcbde8ad020856f08960291382e912d3af127189e3d77ad245fd60c1`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 6.793e-2; 273 | ΔRMS 6.809e-2; writes 1; prefix 1; drift 0 | ΔRMS 7.298e-2; writes 148; prefix 1; drift 0 | ΔRMS 6.809e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: El Condor Pasa
>  ARTIST: D. Robles and J. Milchberg

## Mozart Machine

Path: `DEMOS/M-R/Mozart_Machine_BASIC.sid`

Author: Gregg Peele &amp; Donald J.Eddington · Release/year: 1983 COMPUTE! Publications

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `a1ba42f45dd559ce43393dcbb655b609`; SHA-256: `5eccb4ac9b9087409a7e07f12abfd7d3b46dbc0aa501ccc183bdd88332814ade`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 6.502e-2; 124 | ΔRMS 6.497e-2; writes 1; prefix 1; drift 0 | ΔRMS 6.955e-2; writes 155; prefix 1; drift 0 | ΔRMS 6.497e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Music-Demo

Path: `DEMOS/M-R/Music-Demo_BASIC.sid`

Author: 1643 · Release/year: 1989 Praysersoft

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `674ee60ac10874bd3c7a28603adbb2f7`; SHA-256: `7704f3e270dc95ea656c374390de394d5061e54dcfddbd349345e5a75b24b417`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 1.083e-1; 112 | ΔRMS 1.145e-1; writes 1; prefix 1; drift 0 | ΔRMS 1.149e-1; writes 148; prefix 1; drift 0 | ΔRMS 1.145e-1; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Music 1

Path: `DEMOS/M-R/Music_1.sid`

Author: Joachim Ljunggren (The Sarge) · Release/year: 1987 Front

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `31d67b95c921ca0d9827c37c794ea841`; SHA-256: `37ae05428ff14f827908676bf6be50e3b35f97b683b282590fbefed61e609d02`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 6.690e-2; 121153 | ΔRMS 5.508e-2; writes 121385; prefix 733; drift 162; derived | identical PCM; writes 121153; prefix 121153; drift 0; derived | ΔRMS 5.508e-2; writes 121385; prefix 733; drift 162 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Music 2

Path: `DEMOS/M-R/Music_2.sid`

Author: Joachim Ljunggren (The Sarge) · Release/year: 1987 Front

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `89f6816d2cc173e993a368ac4abef67a`; SHA-256: `9045b02ec18576ec5e8efb5fdd4736a57b1af1524150b2edec5422cd89289c93`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 4.267e-2; 66870 | ΔRMS 1.541e-2; writes 67013; prefix 438; drift 93; derived | identical PCM; writes 66870; prefix 66870; drift 0; derived | ΔRMS 1.541e-2; writes 67013; prefix 438; drift 93 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Music Box Dancer

Path: `DEMOS/M-R/Music_Box_Dancer_BASIC.sid`

Author: Charles Kohr · Release/year: 198? Charles Kohr

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `5338b2f8d099d3bf825a1e6b44e85924`; SHA-256: `93c953fd0dddc89418764e8b0961b1c564fab2b36622abdd8eceb67a06c1fbcd`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 9.517e-2; 397 | ΔRMS 9.513e-2; writes 1; prefix 1; drift 0 | ERROR: Illegal instruction $32 at address $2025; writes 44; prefix 1; drift 0 | ΔRMS 9.513e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Musicale Demo

Path: `DEMOS/M-R/Musicale_Demo_BASIC.sid`

Author: VCGN · Release/year: 1983 VCGN

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `a8578c147aaaf5c0c0900983a4710829`; SHA-256: `a17b17b4ef657d118aa4a416004aaf04484a24d6961dd982c732889421b383a0`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 4.422e-2; 105 | ΔRMS 4.416e-2; writes 1; prefix 1; drift 0 | ΔRMS 5.088e-2; writes 148; prefix 1; drift 0 | ΔRMS 4.416e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Muso 64

Path: `DEMOS/M-R/Muso_64.sid`

Author: Martin Wernecke &amp; Rüdiger Wenski · Release/year: 1985 Happy-Computer

PSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `d668505201314c6be903aec14c8f2c6b`; SHA-256: `3ea3a5ddf845a376c3da4075bcef6b7db79742227ddf8b7aeaea74349a9e58a3`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 8.938e-2; 310 | ΔRMS 1.134e-1; writes 310; prefix 36; drift 11; derived | identical PCM; writes 310; prefix 310; drift 0; derived | ΔRMS 1.134e-1; writes 310; prefix 36; drift 11 |

STIL (full available entry and applicable directory notes):

> COMMENT: There is a randomizer in the play routine so you'll get a different
>          lead every time you start the tune.
>          Machine code version of /DEMOS/M-R/Muso_64_BASIC.sid

## Muso 64

Path: `DEMOS/M-R/Muso_64_BASIC.sid`

Author: Martin Wernecke &amp; Rüdiger Wenski · Release/year: 1985 Happy-Computer

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `d4bbb59e5001cc60081d1a50c1c98f3b`; SHA-256: `a5a8c47a1af6a964e9dc7cb06d7415d2e7ec753b6b5b8ab94fef0d1a0decb7f8`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 8.506e-2; 316 | ΔRMS 1.142e-1; writes 1; prefix 1; drift 0 | ΔRMS 1.094e-1; writes 148; prefix 1; drift 0 | ΔRMS 1.142e-1; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> COMMENT: There is a randomizer in the play routine so you'll get a different
>          lead every time you restart the tune. The randomizer only works when
>          you break the execution of the BASIC program and restart it.
>          BASIC version of /DEMOS/M-R/Muso_64.sid

## The Ninja

Path: `DEMOS/M-R/Ninja.sid`

Author: Hans (KWI) · Release/year: 1988 Dutch Swapping Team

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `112851d5a2d988ec368c85548d72e390`; SHA-256: `e9241bee1add18a41e4c963dd6619290d023ac110566819e9331da56380f81bf`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 1.038e-1; 30832 | ΔRMS 5.325e-2; writes 30835; prefix 367; drift 108; derived | identical PCM; writes 30832; prefix 30832; drift 0; derived | ΔRMS 5.325e-2; writes 30835; prefix 367; drift 108 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Noche de paz

Path: `DEMOS/M-R/Noche_de_paz_BASIC.sid`

Author: Manuel Garrido Perez · Release/year: 1986 Editorial Alhambra

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `bb9b0ecf0fe28222ffd1b2ab5dad9d39`; SHA-256: `ee9e76f44c22ffef969e5828302b4e93f7de182c53666f9bf17f15fd25acf425`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 8.054e-2; 140 | ΔRMS 8.071e-2; writes 1; prefix 1; drift 0 | ΔRMS 8.232e-2; writes 148; prefix 1; drift 0 | ΔRMS 8.071e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Stille Nacht! Heilige Nacht!
>  ARTIST: Joseph Mohr (lyrics), Franz Xaver Gruber (music)
> COMMENT: A Christmas song also known as "Silent Night".

## Oh My Ears!!

Path: `DEMOS/M-R/Oh_My_Ears.sid`

Author: Arno (D.J.) · Release/year: 1991 Exotic

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `01b9f88d1e31db1188beb563b947f65f`; SHA-256: `5d7b4b60bce5db687f680908ab66beeb3a250245ab3cef9677e5995bab47280e`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 4.851e-2; 72473 | ΔRMS 3.259e-2; writes 72452; prefix 111; drift 2; derived | identical PCM; writes 72473; prefix 72473; drift 0; derived | ΔRMS 3.259e-2; writes 72452; prefix 111; drift 2 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## On the Move

Path: `DEMOS/M-R/On_the_Move.sid`

Author: Tron &amp; Rambo · Release/year: 1987 The Two Musketeers

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `5282a6077665f8c60c5dd2de3cc86465`; SHA-256: `81cb55d36dc90c117f879eeb0bd4e04ad8576a35b1cb8cbcbbbfcd19917daf99`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 9.591e-2; 70072 | ΔRMS 1.398e-1; writes 77522; prefix 70072; drift 941301; derived | identical PCM; writes 70072; prefix 70072; drift 0; derived | ΔRMS 1.398e-1; writes 77522; prefix 70072; drift 941301 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Only You

Path: `DEMOS/M-R/Only_You_BASIC.sid`

Author: Volker Orlemann · Release/year: 198? V.Orlemann &amp; H.Hartenbach

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `47448ed5f6b6cbea74a0f3f9c5926139`; SHA-256: `6e2a8fcf2384392cf6b7137f94f83e8556f5ce9c308d7369b306f950e0ddb9f4`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 4.044e-2; 127 | ΔRMS 4.056e-2; writes 1; prefix 1; drift 0 | ΔRMS 4.695e-2; writes 148; prefix 1; drift 0 | ΔRMS 4.056e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Only You [from Upstairs at Eric's]
>  ARTIST: Yazoo

## Orcs &amp; Ogres Demo

Path: `DEMOS/M-R/Orcs_and_Ogres_Demo.sid`

Author: Adrian Waterhouse (Nazgul) · Release/year: 19?? Binary Images

PSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `1273bf994c003d0ca15c008473a12819`; SHA-256: `9e2095b3daaf191ad3aee335e10c5422fc4a35e17c02e54e576bc8872af0a8ed`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 7.236e-2; 9870 | ΔRMS 3.594e-2; writes 9870; prefix 1287; drift 56; derived | identical PCM; writes 9870; prefix 9870; drift 0; derived | ΔRMS 3.594e-2; writes 9870; prefix 1287; drift 56 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Orfeus i Underverdenen

Path: `DEMOS/M-R/Orfeus_i_Underverdenen_BASIC.sid`

Author: Henning Fagge · Release/year: 1984 Henning Fagge

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `6fb8bc9a825d31b2d82b71193d684963`; SHA-256: `e6dfa5ee5dc751bbe0fb58a7194e68abefd81d6c96e98c4226af2f6b73b59501`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 1.554e-1; 605 | ΔRMS 1.554e-1; writes 1; prefix 1; drift 0 | ERROR: Illegal instruction $72 at address $2048; writes 44; prefix 1; drift 0 | ΔRMS 1.554e-1; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Galop Infernal [from the comic opera Orphée aux enfers]
>  ARTIST: Jacques Offenbach
> COMMENT: Famously known as the "can-can" tune.

## PBS Demo 1

Path: `DEMOS/M-R/PBS_Demo_1.sid`

Author: PBS · Release/year: 1988 Fat Boys Crackers

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `e62967fc6f52ec24d4a35c6b503d218d`; SHA-256: `46645b36a5bde3552e5cfc764b4a3722ac45580a6870307079912a75b74333cc`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 5.733e-2; 111152 | ΔRMS 4.301e-2; writes 111251; prefix 377; drift 108; derived | identical PCM; writes 111152; prefix 111152; drift 0; derived | ΔRMS 4.301e-2; writes 111251; prefix 377; drift 108 |

STIL (full available entry and applicable directory notes):

> COMMENT: Remix of /MUSICIANS/B/Banana/Stairs.sid with added digis.

## Party Songs

Path: `DEMOS/M-R/Party_Songs.sid`

Author: John Henry · Release/year: 198? John Henry

RSID; BASIC flag clear; 20 subtunes. Complete-file MD5: `28d84c56e2f0a052b7ac587946b6f8c0`; SHA-256: `8466a6b979f159b1145d30490cf8a281f32b39166b48a52e24b972e2db813c25`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 1.430e-1; 187 | ΔRMS 1.430e-1; writes 10; prefix 10; drift 0; derived | identical PCM; writes 187; prefix 187; drift 0; derived | ΔRMS 1.430e-1; writes 10; prefix 10; drift 0 |
| 2 | 10 | kernal-sensitive | 7.103e-2; 200 | ΔRMS 7.113e-2; writes 10; prefix 10; drift 0; derived | identical PCM; writes 200; prefix 200; drift 0; derived | ΔRMS 7.113e-2; writes 10; prefix 10; drift 0 |
| 3 | 10 | kernal-sensitive | 8.995e-2; 254 | ΔRMS 8.990e-2; writes 10; prefix 10; drift 0; derived | identical PCM; writes 254; prefix 254; drift 0; derived | ΔRMS 8.990e-2; writes 10; prefix 10; drift 0 |
| 4 | 10 | kernal-sensitive | 4.051e-2; 347 | ΔRMS 4.041e-2; writes 10; prefix 10; drift 0; derived | identical PCM; writes 347; prefix 347; drift 0; derived | ΔRMS 4.041e-2; writes 10; prefix 10; drift 0 |
| 5 | 10 | kernal-sensitive | 1.067e-1; 313 | ΔRMS 1.251e-1; writes 10; prefix 10; drift 0; derived | identical PCM; writes 313; prefix 313; drift 0; derived | ΔRMS 1.251e-1; writes 10; prefix 10; drift 0 |
| 6 | 10 | kernal-sensitive | 1.341e-1; 142 | ΔRMS 1.642e-1; writes 10; prefix 10; drift 0; derived | identical PCM; writes 142; prefix 142; drift 0; derived | ΔRMS 1.642e-1; writes 10; prefix 10; drift 0 |
| 7 | 10 | kernal-sensitive | 7.171e-2; 321 | ΔRMS 7.556e-2; writes 10; prefix 10; drift 0; derived | identical PCM; writes 321; prefix 321; drift 0; derived | ΔRMS 7.556e-2; writes 10; prefix 10; drift 0 |
| 8 | 10 | kernal-sensitive | 9.843e-2; 238 | ΔRMS 1.009e-1; writes 10; prefix 10; drift 0; derived | identical PCM; writes 238; prefix 238; drift 0; derived | ΔRMS 1.009e-1; writes 10; prefix 10; drift 0 |
| 9 | 10 | kernal-sensitive | 7.523e-2; 208 | ΔRMS 7.518e-2; writes 10; prefix 10; drift 0; derived | identical PCM; writes 208; prefix 208; drift 0; derived | ΔRMS 7.518e-2; writes 10; prefix 10; drift 0 |
| 10 | 10 | kernal-sensitive | 1.331e-1; 205 | ΔRMS 1.688e-1; writes 10; prefix 10; drift 0; derived | identical PCM; writes 205; prefix 205; drift 0; derived | ΔRMS 1.688e-1; writes 10; prefix 10; drift 0 |
| 11 | 10 | kernal-sensitive | 1.053e-1; 274 | ΔRMS 1.081e-1; writes 10; prefix 10; drift 0; derived | identical PCM; writes 274; prefix 274; drift 0; derived | ΔRMS 1.081e-1; writes 10; prefix 10; drift 0 |
| 12 | 10 | kernal-sensitive | 4.615e-2; 235 | ΔRMS 4.606e-2; writes 10; prefix 10; drift 0; derived | identical PCM; writes 235; prefix 235; drift 0; derived | ΔRMS 4.606e-2; writes 10; prefix 10; drift 0 |
| 13 | 10 | kernal-sensitive | 8.062e-2; 166 | ΔRMS 8.056e-2; writes 10; prefix 10; drift 0; derived | identical PCM; writes 166; prefix 166; drift 0; derived | ΔRMS 8.056e-2; writes 10; prefix 10; drift 0 |
| 14 | 10 | kernal-sensitive | 3.689e-2; 316 | ΔRMS 3.677e-2; writes 10; prefix 10; drift 0; derived | identical PCM; writes 316; prefix 316; drift 0; derived | ΔRMS 3.677e-2; writes 10; prefix 10; drift 0 |
| 15 | 10 | kernal-sensitive | 7.342e-2; 386 | ΔRMS 8.447e-2; writes 10; prefix 10; drift 0; derived | identical PCM; writes 386; prefix 386; drift 0; derived | ΔRMS 8.447e-2; writes 10; prefix 10; drift 0 |
| 16 | 10 | kernal-sensitive | 7.746e-2; 181 | ΔRMS 7.741e-2; writes 10; prefix 10; drift 0; derived | identical PCM; writes 181; prefix 181; drift 0; derived | ΔRMS 7.741e-2; writes 10; prefix 10; drift 0 |
| 17 | 10 | kernal-sensitive | 1.081e-1; 277 | ΔRMS 1.108e-1; writes 10; prefix 10; drift 0; derived | identical PCM; writes 277; prefix 277; drift 0; derived | ΔRMS 1.108e-1; writes 10; prefix 10; drift 0 |
| 18 | 10 | kernal-sensitive | 4.861e-2; 316 | ΔRMS 4.852e-2; writes 10; prefix 10; drift 0; derived | identical PCM; writes 316; prefix 316; drift 0; derived | ΔRMS 4.852e-2; writes 10; prefix 10; drift 0 |
| 19 | 10 | kernal-sensitive | 6.656e-2; 118 | ΔRMS 6.649e-2; writes 10; prefix 10; drift 0; derived | identical PCM; writes 118; prefix 118; drift 0; derived | ΔRMS 6.649e-2; writes 10; prefix 10; drift 0 |
| 20 | 10 | kernal-sensitive | 1.022e-1; 304 | ΔRMS 1.044e-1; writes 10; prefix 10; drift 0; derived | identical PCM; writes 304; prefix 304; drift 0; derived | ΔRMS 1.044e-1; writes 10; prefix 10; drift 0 |

STIL (full available entry and applicable directory notes):

> (#1)
>   TITLE: Auld Lang Syne
>  ARTIST: Scottish Traditional
> (#2)
>   TITLE: Blow The Man Down
>  ARTIST: Woody Guthrie
> (#3)
>   TITLE: Oh My Darling, Clementine
>  ARTIST: Traditional American Folk
> (#4)
>   TITLE: Dixie Land
>  ARTIST: Daniel Emmett
> (#5)
>   TITLE: Malbrouk s'en va-t-en guerre
>  ARTIST: Traditional
> COMMENT: An Arab tune that was brought to Europe during the crusades and
>          became popular during the french revolution, ever since spawned
>          many songs, including "For He's a Jolly Good Fellow".
> (#6)
>   TITLE: Bill Groggin's Goat
>  ARTIST: Traditional
> (#7)
>   TITLE: Hail, Hail, the Gang's All Here
>  ARTIST: D. A. Esrom (lyrics), Arthur Sullivan (music)
> (#8)
>   TITLE: I've Been Working on the Railroad
>  ARTIST: Traditional
> COMMENT: American folk song.
> (#9)
>   TITLE: My Old Kentucky Home
>  ARTIST: Stephen C. Foster
> (#10)
>   TITLE: My Bonnie Lies Over The Ocean
>  ARTIST: Traditional
> (#11)
>   TITLE: Who Threw the Overalls in Mistress Murphy's Chowder?
>  ARTIST: George Geifer
> (#12)
>   TITLE: Goober Peas
>  ARTIST: P. Nutt, Esq.
> (#13)
>   TITLE: Red River Valley
>  ARTIST: Traditional
> (#14)
>   TITLE: Oh Susanna
>  ARTIST: Stephen C. Foster
> (#15)
>   TITLE: Turkey In The Straw
>  ARTIST: Traditional
> (#16)
>   TITLE: My Wild Irish Rose
>  ARTIST: Chauncey Olcott
> (#17)
>   TITLE: The Yellow Rose of Texas
>  ARTIST: J.K.
> COMMENT: Published in 1853 by an author identified only as "J.K.".
> (#18)
>   TITLE: Yankee Doodle
>  ARTIST: Traditional, Dr. Richard Schuckburgh (lyrics)
> (#19)
>   TITLE: Big Ben 12 O' Clock (0:00-0:25)
>  ARTIST: &lt;?&gt;
> (#20)
>   TITLE: Goodnight, Ladies
>  ARTIST: Edwin Pearce Christy

## Piano

Path: `DEMOS/M-R/Piano_BASIC.sid`

Author: Glen Fisher · Release/year: 1983 Commodore 64 Fun and Games

RSID; BASIC flag set; 4 subtunes. Complete-file MD5: `fd022ff732c58c24f7b2c58acd47c9ab`; SHA-256: `2f92b36d0065e7dd28337b2bacec48b88b7a20310251bd786836c402a149660e`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 3.616e-2; 126 | ΔRMS 3.630e-2; writes 1; prefix 1; drift 0 | ΔRMS 4.258e-2; writes 155; prefix 1; drift 0 | ΔRMS 3.630e-2; writes 1; prefix 1; drift 0 |
| 2 | 10 | both-sensitive | 3.800e-2; 142 | ΔRMS 3.813e-2; writes 1; prefix 1; drift 0 | ΔRMS 4.414e-2; writes 155; prefix 1; drift 0 | ΔRMS 4.158e-2; writes 39; prefix 37; drift 18758 |
| 3 | 10 | both-sensitive | 5.233e-2; 330 | ERROR: Illegal instruction $02 at address $bf54; writes 1; prefix 1; drift 0 | ΔRMS 5.694e-2; writes 155; prefix 1; drift 0 | ΔRMS 5.435e-2; writes 39; prefix 37; drift 31350 |
| 4 | 10 | both-sensitive | 3.906e-2; 162 | ΔRMS 3.919e-2; writes 1; prefix 1; drift 0 | ΔRMS 4.506e-2; writes 155; prefix 1; drift 0 | ΔRMS 4.013e-2; writes 39; prefix 37; drift 41477 |

STIL (full available entry and applicable directory notes):

> (#1)
> COMMENT: Tunes #2-4 played in sequence.
> (#2)
>   TITLE: Wiltshire Six Hand Reel
>  ARTIST: Traditional
> (#3)
>   TITLE: Devil's Dream
>  ARTIST: Traditional
> (#4)
>   TITLE: Sicilian Tarantella
>  ARTIST: Traditional

## Pink Panther

Path: `DEMOS/M-R/Pink_Panther_BASIC.sid`

Author: Stan Kicak · Release/year: 198? Stan Kicak

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `4ba0226f8f71d8f3574d1624de27debb`; SHA-256: `c4c641525b4a71bc28a316b8f10a8000cdc875187981e0ab75cd9f4c97bf6205`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 1.060e-1; 262 | ΔRMS 1.369e-1; writes 1; prefix 1; drift 0 | ERROR: Illegal instruction $32 at address $2023; writes 44; prefix 2; drift 23288 | ΔRMS 1.369e-1; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Pink Panther Theme
>  ARTIST: Henry Mancini

## Praeludium

Path: `DEMOS/M-R/Praeludium_BASIC.sid`

Author: Oliver Buck · Release/year: 1986 64'er/Markt &amp; Technik

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `9350d30419436d58f25ac69b1b7acbe2`; SHA-256: `91a62e446685d9a621d81c94df6d0fcf548a969fe3c52c2a699bfb36c7f8c72c`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 1.024e-1; 223 | ΔRMS 1.081e-1; writes 1; prefix 1; drift 0 | ERROR: Illegal instruction $32 at address $2024; writes 44; prefix 1; drift 0 | ΔRMS 1.081e-1; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Prelude No. 1 (BWV 846)
>  ARTIST: Johann Sebastian Bach

## Prisoner Zak 2

Path: `DEMOS/M-R/Prisoner_Zak_2.sid`

Author: Kim Sveinall (Prisoner) · Release/year: 1989 The Strikers

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `07cefe7214942e8661eeb6470024c775`; SHA-256: `39e53e29e842b993dbd00aa9f53b930a16d6f388ef6384f5b1ea4c35903886c2`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 6.136e-2; 145063 | ΔRMS 6.107e-2; writes 145147; prefix 9488; drift 580; derived | identical PCM; writes 145063; prefix 145063; drift 0; derived | ΔRMS 6.107e-2; writes 145147; prefix 9488; drift 580 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Prophet64 Sequencer Demo

Path: `DEMOS/M-R/Prophet64_Sequencer_Demo_2SID.sid`

Author: Lars P. Eriksson (8bit Ventures) · Release/year: 2006 8bit Ventures

PSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `579aaafedbd0884259c8831b0dc7aa03`; SHA-256: `4377f18e048e7a04fe5f5c61295bc98ecb559d22728988d178a4fb39bba1efe8`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 60 | both-sensitive | 5.891e-2; 134603 | ΔRMS 7.663e-2; writes 134668; prefix 51; drift 0 | ΔRMS 8.003e-2; writes 134527; prefix 51; drift 0 | ΔRMS 6.794e-2; writes 134631; prefix 134603; drift 29616 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Puff

Path: `DEMOS/M-R/Puff_BASIC.sid`

Author: Tom Rugg &amp; Phil Feldman · Release/year: 1983 Western Systems Group

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `dd986ff502ffbe0a48a308a1bc5ef7d0`; SHA-256: `d99f191fe1597303cdcf101f1090a9d7fb85f9ab4e0ab6f8d6d607ce217fe1e6`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 3.812e-2; 177 | ΔRMS 3.807e-2; writes 1; prefix 1; drift 0 | ΔRMS 4.608e-2; writes 155; prefix 1; drift 0 | ΔRMS 3.807e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Rimheden Zak 3

Path: `DEMOS/M-R/Rimheden_Zak_3.sid`

Author: Mr. Volcano · Release/year: 19?? Mr. Volcano

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `b30372d809c7253454ef232a1b9c5fcd`; SHA-256: `e4b603165d14537b14f7c125af0e73499714caf0d2eb8821fc69ec481b5eeee2`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 8.057e-2; 83917 | ΔRMS 8.113e-2; writes 84015; prefix 408; drift 88; derived | identical PCM; writes 83917; prefix 83917; drift 0; derived | ΔRMS 8.113e-2; writes 84015; prefix 408; drift 88 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Rock Musix #02

Path: `DEMOS/M-R/Rock_Musix_02.sid`

Author: Myrtle · Release/year: 1988 Waxlyze 5115

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `323224a3261b6c2082d51d6cbb5a4bab`; SHA-256: `462e56b4af01f0a20786e371924a3ef00bf40a3188c73719a871feecb962fd47`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 6.402e-2; 60047 | ΔRMS 1.992e-2; writes 60063; prefix 377; drift 89; derived | identical PCM; writes 60047; prefix 60047; drift 0; derived | ΔRMS 1.992e-2; writes 60063; prefix 377; drift 89 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Rock This

Path: `DEMOS/M-R/Rock_This.sid`

Author: Fabien Juchniewicz (Johnny B.) · Release/year: 1987 C64 Comics Group

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `5714440ffd166b70d20b8e15db7a7939`; SHA-256: `4d499aa2211095e728959f32b2c44af5315dc4c035a56e6aec42df11b08a546a`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 6.518e-2; 98076 | ΔRMS 7.102e-2; writes 98346; prefix 291; drift 110; derived | identical PCM; writes 98076; prefix 98076; drift 0; derived | ΔRMS 7.102e-2; writes 98346; prefix 291; drift 110 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Rockmonitor 6 (URD)

Path: `DEMOS/M-R/Rockmonitor_6_URD.sid`

Author: Johnny · Release/year: 1988 URD

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `be77a405211e012a1087b95a63a76458`; SHA-256: `0d4684d3719151875811d1ad4288293bb2eabdd35fea4d9280f23f65bf371731`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 8.287e-2; 40245 | ΔRMS 1.865e-2; writes 40245; prefix 287; drift 55; derived | identical PCM; writes 40245; prefix 40245; drift 0; derived | ΔRMS 1.865e-2; writes 40245; prefix 287; drift 55 |

STIL (full available entry and applicable directory notes):

> TITLE: The Reflex [from Seven and the Ragged Tiger]
>  ARTIST: Duran Duran
> COMMENT: The opening sample is taken from the end of Frankie Goes to
>          Hollywood's "Welcome to the Pleasure Dome".

## Rockmonitor Tune

Path: `DEMOS/M-R/Rockmonitor_Tune.sid`

Author: Jason Mackenzie (Kenz) &lt;?&gt; · Release/year: 198? Binary Zone

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `dc8208d333116397cf264f84fff88006`; SHA-256: `4fa12785ddd9a1b82b612fb067c097906c499fd01aa2aca02cec5d0102889272`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 5.570e-2; 67376 | ΔRMS 1.795e-2; writes 67376; prefix 1351; drift 53; derived | identical PCM; writes 67376; prefix 67376; drift 0; derived | ΔRMS 1.795e-2; writes 67376; prefix 1351; drift 53 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Run Runaway

Path: `DEMOS/M-R/Run_Runaway_BASIC.sid`

Author: Mr. Music · Release/year: 1985 Mr. Music

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `38a54451c42bb201f383e4ba9a0b9919`; SHA-256: `fac52a8e2b45d306b904b68c3d63c3feae16712609827079a6c7ca48f0267dbb`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 1.047e-1; 479 | ΔRMS 1.143e-1; writes 1; prefix 1; drift 0 | ERROR: Illegal instruction $32 at address $0e96; writes 44; prefix 1; drift 0 | ΔRMS 1.143e-1; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Run Runaway [from The Amazing Kamikaze Syndrome]
>  ARTIST: Slade

## Russians

Path: `DEMOS/M-R/Russians_BASIC.sid`

Author: JBJ · Release/year: 1986 JBJ

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `cd7364fee25689bb7224e6edddf46198`; SHA-256: `938a5537aa14c9fdab87107a075fab9a76fa1be9a005752128fe26eba08215b6`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 1.043e-1; 506 | ΔRMS 1.061e-1; writes 1; prefix 1; drift 0 | ΔRMS 1.104e-1; writes 148; prefix 1; drift 0 | ERROR: Illegal instruction $42 at address $a005; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Russians [from The Dream of the Blue Turtles]
>  ARTIST: Sting

## S1

Path: `DEMOS/S-Z/S1.sid`

Author: Róbert Egyed · Release/year: 1990 Terrorists

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `5f52219be7abe1c5c38548d3bad5105b`; SHA-256: `8f4ec1f94fb7c7d4c2a3ba10db469e05c1cac9791f15d1006c868d1766a5c0fd`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 2.792e-2; 18411 | ΔRMS 1.120e-2; writes 18411; prefix 430; drift 129; derived | identical PCM; writes 18411; prefix 18411; drift 0; derived | ΔRMS 1.120e-2; writes 18411; prefix 430; drift 129 |

STIL (full available entry and applicable directory notes):

> TITLE: Orion [from Master of Puppets]
>  ARTIST: Metallica

## SID or without U

Path: `DEMOS/S-Z/SID_or_without_U.sid`

Author: Ivo van Poorten (Ivop) · Release/year: 2021 Ivop

PSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `dcda5ec1c21b8f36e401a9185f2fa8bf`; SHA-256: `ca09e345b8fef57e9d8ea1c1ff5aaf31b73174c5406663de49d52379ae2cf028`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 4.165e-2; 3162 | ΔRMS 4.163e-2; writes 3162; prefix 6; drift 0; derived | identical PCM; writes 3162; prefix 3162; drift 0; derived | ΔRMS 4.163e-2; writes 3162; prefix 6; drift 0 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## SLL Eight

Path: `DEMOS/S-Z/SLL_Eight.sid`

Author: Steve Hammond (Iceman) · Release/year: 1988 Relax Designs

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `331053977bdd59c7fe87d11e08646f24`; SHA-256: `58ad47e56cff86955d840c1e76e7cfdd455ba724ba28ac467d0d2903a30f708f`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 9.759e-2; 81623 | ΔRMS 1.021e-1; writes 81623; prefix 384; drift 103; derived | identical PCM; writes 81623; prefix 81623; drift 0; derived | ΔRMS 1.021e-1; writes 81623; prefix 384; drift 103 |

STIL (full available entry and applicable directory notes):

> TITLE: sll8 [from the Amiga MOD module]
>  ARTIST: Sten Lysholm Larsen (SLL)

## Satan Demo

Path: `DEMOS/S-Z/Satan_Demo.sid`

Author: Matt Stubbington (Lizard) &lt;?&gt; · Release/year: 1986 Us

PSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `a824d2fd1c1a5ae66629ee2881ad091b`; SHA-256: `dad7ac1f7c6a579dfbfca326a5706e57e55b0a12fef5df83b804a1bd9df1cff0`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 8.194e-2; 9509 | ΔRMS 6.849e-2; writes 9509; prefix 572; drift 54; derived | identical PCM; writes 9509; prefix 9509; drift 0; derived | ΔRMS 6.849e-2; writes 9509; prefix 572; drift 54 |

STIL (full available entry and applicable directory notes):

> COMMENT: Edit of /DEMOS/A-F/Electrosound_64.sid.

## She's Lost Control

Path: `DEMOS/S-Z/Shes_Lost_Control.sid`

Author: Justin Buonaccorso (Jbuonacc) · Release/year: 2008 Jbuonacc

PSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `42788b03df5af14c8a61f3f6892f9030`; SHA-256: `05562b321bc1eeb956a3205052653c51a73375ca29a1c0a0c3aedb050fd42b03`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 60 | both-sensitive | 1.061e-1; 66682 | ΔRMS 1.378e-1; writes 66711; prefix 26; drift 0 | ΔRMS 1.533e-1; writes 66705; prefix 26; drift 0 | ΔRMS 1.382e-1; writes 66705; prefix 66682; drift 23722 |

STIL (full available entry and applicable directory notes):

> TITLE: She's Lost Control [from Unknown Pleasures]
>  ARTIST: Joy Division

## Sidewalk II

Path: `DEMOS/S-Z/Sidewalk_II.sid`

Author: Goony · Release/year: 1988 Tetragon

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `ebe019930d8d1713b9acd1971cfd8bdc`; SHA-256: `c02002ef266b0283c51c9bfb202392d15b978e21224cbe6ad7bd9a337bda9112`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 2.518e-2; 24548 | ΔRMS 1.800e-2; writes 24550; prefix 438; drift 93; derived | identical PCM; writes 24548; prefix 24548; drift 0; derived | ΔRMS 1.800e-2; writes 24550; prefix 438; drift 93 |

STIL (full available entry and applicable directory notes):

> COMMENT: Remix of /MUSICIANS/C/Callet_Charles/Sidewalk.sid, Tune #1.

## Silent Night

Path: `DEMOS/S-Z/Silent_Night_BASIC.sid`

Author: Tom Jeffries (Singing Electrons) · Release/year: 198? Singing Electrons

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `73b6ca9140100c129d630907e4ef1d53`; SHA-256: `8ed3ff347dd4ab895b0d3c198ca0bcb31963c9fab13b450462658d90c3504517`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 9.106e-2; 449 | ΔRMS 1.162e-1; writes 1; prefix 1; drift 0 | ΔRMS 1.246e-1; writes 155; prefix 1; drift 0 | ΔRMS 1.162e-1; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Stille Nacht! Heilige Nacht!
>  ARTIST: Joseph Mohr (lyrics), Franz Xaver Gruber (music)
> COMMENT: A Christmas song also known as "Silent Night".

## Silents Info 1

Path: `DEMOS/S-Z/Silents_Info_1.sid`

Author: Per Jacobsson (Newscopy) · Release/year: 1987 The Silents

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `dbbfc98b36343f509239eeab271cb131`; SHA-256: `7f0c447c8ee94286a2939f963b92607ee2e9e75045aa4ad48b0d5a44d0aa354d`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 6.618e-2; 10662 | ΔRMS 6.120e-3; writes 10662; prefix 273; drift 125; derived | identical PCM; writes 10662; prefix 10662; drift 0; derived | ΔRMS 6.120e-3; writes 10662; prefix 273; drift 125 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Singalong-a-Summer

Path: `DEMOS/S-Z/Singalong-a-Summer_BASIC.sid`

Author: Diego El Sid · Release/year: 1984 Commodore User

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `6b73a9ff07a654dab9b55cab178aa60b`; SHA-256: `6b5827d8f7732778554644ff9ff413daa57c64ee515e802e0f94c058f03ebe67`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 5.441e-2; 259 | ΔRMS 5.436e-2; writes 1; prefix 1; drift 0 | ΔRMS 5.995e-2; writes 148; prefix 1; drift 0 | ΔRMS 5.436e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Y Viva España
>  ARTIST: Samantha

## Sound of Silence

Path: `DEMOS/S-Z/Sound_of_Silence_BASIC.sid`

Author: Keiji Bessi · Release/year: 1983 VIC! Magazine

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `27707802714a91382a1d90f2125ce256`; SHA-256: `800ef60df673578d09b545676f72fce3feef946741d0f1e7bbd269521a7dfb57`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 6.453e-2; 363 | ΔRMS 6.896e-2; writes 1; prefix 1; drift 0 | ΔRMS 7.014e-2; writes 148; prefix 1; drift 0 | ΔRMS 6.896e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: The Sound of Silence [from Sounds of Silence]
>  ARTIST: Simon &amp; Garfunkel

## Stairway to Heaven

Path: `DEMOS/S-Z/Stairway_to_Heaven_BASIC.sid`

Author: Greg Datl · Release/year: 1984 Greg Datl

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `6cae589559eca87ba999ab41d81185a0`; SHA-256: `7743a3aa4c20623b3d1dc59b75b7f93ea1f7e166b55847707cfc4026d2562da4`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 7.398e-2; 162 | ΔRMS 7.404e-2; writes 1; prefix 1; drift 0 | ΔRMS 7.767e-2; writes 155; prefix 1; drift 0 | ΔRMS 7.404e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Stairway To Heaven [from Led Zeppelin IV: Four Symbols]
>  ARTIST: Led Zeppelin

## Stereo Beat

Path: `DEMOS/S-Z/Stereo_Beat.sid`

Author: Tonnie Bogers &amp; Oscar (Dazz) · Release/year: 1987 The Crazy Artists

PSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `7b0f464bd714e6271b499f53192f3dc7`; SHA-256: `6fdac2a183690d3f1ea8d21aa50022f8c0fad63cc3f081924aa8916e8251e405`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 1.361e-1; 4988 | ΔRMS 8.842e-2; writes 4988; prefix 144; drift 54; derived | identical PCM; writes 4988; prefix 4988; drift 0; derived | ΔRMS 8.842e-2; writes 4988; prefix 144; drift 54 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Sunshine Love

Path: `DEMOS/S-Z/Sunshine_Love.sid`

Author: LL Cool Jay &amp; James C. Maxwell · Release/year: 1988 Sisters of Mercy/Sharks

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `ac7e187851ae4b97d1725c6b8d8410cc`; SHA-256: `7c9e4012165f8e2fdffef56383c1e2e1cead60888088cabd9a4d4f7f285881d0`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 5.518e-2; 45305 | ΔRMS 2.441e-2; writes 45309; prefix 382; drift 90; derived | identical PCM; writes 45305; prefix 45305; drift 0; derived | ΔRMS 2.441e-2; writes 45309; prefix 382; drift 90 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## The Syndrom

Path: `DEMOS/S-Z/Syndrom_BASIC.sid`

Author: Daniel Hänle · Release/year: 1986 64'er/Markt &amp; Technik

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `ee03b74918994282a40d61c19ff47b22`; SHA-256: `8e77f9b4e83ecc1089d4252c4ab66fae849641e85588f6dfe09f743593cc3c8e`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 8.715e-2; 225 | ΔRMS 8.712e-2; writes 1; prefix 1; drift 0 | ΔRMS 9.055e-2; writes 148; prefix 1; drift 0 | ΔRMS 8.712e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## TSF Theme

Path: `DEMOS/S-Z/TSF_Theme.sid`

Author: TSF &lt;?&gt; · Release/year: 1989 TSF &lt;?&gt;

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `1d55ee322b08097668e2143c2f0120d4`; SHA-256: `ae8beb3295f87855668a6675ab7b24e90ceed6f574592e5b524c75eed5d229c9`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 2.745e-2; 39182 | ΔRMS 6.068e-3; writes 39182; prefix 438; drift 93; derived | identical PCM; writes 39182; prefix 39182; drift 0; derived | ΔRMS 6.068e-3; writes 39182; prefix 438; drift 93 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Teddy's Song

Path: `DEMOS/S-Z/Teddys_Song_BASIC.sid`

Author: Peggy Herrington · Release/year: 1984 Family Computing

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `c0e8a2f9f8b4661e0896d8d9959f796e`; SHA-256: `2fe2cd983ea30069539624b54da4d610b88570feffe1f4e0f791f6d67fead35d`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 3.704e-2; 144 | ΔRMS 3.737e-2; writes 1; prefix 1; drift 0 | ΔRMS 4.151e-2; writes 155; prefix 1; drift 0 | ΔRMS 3.737e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Cradle Song
>  ARTIST: Johannes Brahms

## Temple

Path: `DEMOS/S-Z/Temple.sid`

Author: Kay · Release/year: 1988 Genesis Project

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `9571dae5bb2e8e7a9aac6365b7486183`; SHA-256: `81772cbc831645797801afb75d1213b9fd2f152cea6204ef9457478caa12576e`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 2.750e-2; 27635 | ΔRMS 2.147e-2; writes 27666; prefix 137; drift 910; derived | identical PCM; writes 27635; prefix 27635; drift 0; derived | ΔRMS 2.147e-2; writes 27666; prefix 137; drift 910 |

STIL (full available entry and applicable directory notes):

> TITLE: Temple of Love [from Some Girls Wander By Mistake]
>  ARTIST: The Sisters of Mercy

## Those Were the Days

Path: `DEMOS/S-Z/Those_Were_the_Days_BASIC.sid`

Author: Eric J. Floehr · Release/year: 198? Eric J. Floehr

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `32ed5c17ad36c3e6284430146888fb53`; SHA-256: `3a7b676f3a775277cc9623b9b48aee6e8ba73e6e67ce51c1d483fffd2a203d04`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 7.477e-2; 210 | ΔRMS 7.500e-2; writes 1; prefix 1; drift 0 | ΔRMS 7.987e-2; writes 190; prefix 1; drift 0 | ΔRMS 7.500e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Toccata &amp; Fugue in D Minor

Path: `DEMOS/S-Z/Toccata_and_Fugue_in_D_Minor_BASIC.sid`

Author: Douglas A. Burr · Release/year: 198? Douglas A. Burr

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `e91cf217120072ca009ae43cf75b8301`; SHA-256: `aaed4a3bb9874f8b7a536c8c0b52ebf955ee9b8cef6477043cd038d5ce486fe5`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 6.101e-2; 472 | ΔRMS 9.817e-2; writes 1; prefix 1; drift 0 | ERROR: Illegal instruction $32 at address $2022; writes 44; prefix 1; drift 0 | ΔRMS 9.817e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Toccata [from Toccata and Fugue in D Minor (BWV 565)]
>  ARTIST: Johann Sebastian Bach

## Tom Dooley

Path: `DEMOS/S-Z/Tom_Dooley_BASIC.sid`

Author: Lizard Master · Release/year: 19?? Lizard Master

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `351061262953c03330244295929d59b9`; SHA-256: `a2bbc2a7538188d062e0aee52fd9ed7f0aedba632f1b8ccd828a2bb19ca9d537`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 3.681e-2; 78 | ΔRMS 4.253e-2; writes 1; prefix 1; drift 0 | ΔRMS 5.426e-2; writes 148; prefix 1; drift 0 | ΔRMS 4.253e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Tom Dooley
>  ARTIST: Traditional
> COMMENT: An old North Carolina folk song. Made famous by The Kingston Trio in 1958.

## Toonypoo 3

Path: `DEMOS/S-Z/Toonypoo_3_BASIC.sid`

Author: Darren Melbourne (Yoda) · Release/year: 1985 Yoda

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `5f9730e75465009339abfe953c8c14b3`; SHA-256: `7a146532c97304bfff5030608d1f97e6adac266e6ce93b27ba7952c64d8cd567`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 1.277e-1; 1945 | ΔRMS 1.307e-1; writes 1; prefix 1; drift 0 | ΔRMS 1.351e-1; writes 237; prefix 1; drift 0 | ΔRMS 1.307e-1; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Toreador's Song

Path: `DEMOS/S-Z/Toreadors_Song_BASIC.sid`

Author: Gregory J. Perry · Release/year: 1985 Prentice-Hall of Australia

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `916013cc38409dbf30ce02934d4683b6`; SHA-256: `2df5e71489e92c4fd8a636108a3b4865e37ceb60b00451d3ae636186f120db30`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 1.249e-1; 350 | ΔRMS 1.258e-1; writes 1; prefix 1; drift 0 | ΔRMS 1.263e-1; writes 148; prefix 1; drift 0 | ΔRMS 1.258e-1; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: March of the Toreadors [from opera Carmen]
>  ARTIST: Georges Bizet

## Transwarp

Path: `DEMOS/S-Z/Transwarp.sid`

Author: Gunnar Ruthenberg (Krill) · Release/year: 2020 Plush

RSID; BASIC flag clear; 3 subtunes. Complete-file MD5: `9c10608837ffbb0c37eca277edb41629`; SHA-256: `9fa5fb4187d57f25382961e860f72e7498d1fbb40c988f0568d4a685a5ff9968`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 1.642e-1; 330151 | ΔRMS 3.373e-2; writes 397668; prefix 89; drift 385; derived | identical PCM; writes 330151; prefix 330151; drift 0; derived | ΔRMS 3.373e-2; writes 397668; prefix 89; drift 385 |
| 2 | 10 | insufficient-reference-activity | 1.906e-1; 26 | identical PCM; writes 26; prefix 26; drift 0; derived | identical PCM; writes 26; prefix 26; drift 0; derived | identical PCM; writes 26; prefix 26; drift 0 |
| 3 | 10 | insufficient-reference-activity | 7.950e-3; 10 | ΔRMS 4.279e-6; writes 10; prefix 10; drift 3; derived | identical PCM; writes 10; prefix 10; drift 0; derived | ΔRMS 4.279e-6; writes 10; prefix 10; drift 3 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Trek Theme

Path: `DEMOS/S-Z/Trek_Theme_BASIC.sid`

Author: Darren Boyd · Release/year: 1984 D.B. Productions

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `fb7584526902551d8f5ef2e26adc4d96`; SHA-256: `f101565b2102b0fb23512660100fc3739adfe3178212c8da1a79efaa68df3a1a`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 1.017e-1; 537 | ΔRMS 1.017e-1; writes 1; prefix 1; drift 0 | ERROR: Illegal instruction $32 at address $2027; writes 44; prefix 1; drift 0 | ΔRMS 1.017e-1; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Main Theme [from the movie Star Trek: The Motion Picture]
>  ARTIST: Jerry Goldsmith

## Two-Part Invention no.8 in F

Path: `DEMOS/S-Z/Two-Part_Invention_no_8_in_F_BASIC.sid`

Author: John Caldwell · Release/year: 198? John Caldwell

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `4b9573a5128273c4aeb35fa26c92bce6`; SHA-256: `006f5b4408aeb86139f626296c39eb3274d717ec6dc6ceac62d82e14dcf58288`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 3.469e-2; 527 | ΔRMS 3.457e-2; writes 1; prefix 1; drift 0 | ERROR: Illegal instruction $92 at address $0a7c; writes 44; prefix 1; drift 0 | ΔRMS 3.457e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Two-Part Invention No. 8, in F major (BWV 779)
>  ARTIST: Johann Sebastian Bach

## Walk This Way

Path: `DEMOS/S-Z/Walk_This_Way_BASIC.sid`

Author: Szabolcs Négyesi (Yale) · Release/year: 1991 Cadgers/Delta System

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `3d218c3f8687e2143cacdebab1f00b72`; SHA-256: `ef226d9847eb22e19c85568bc6a9411248fd879952ac1c43d8c23e9b757f2025`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 3.770e-2; 115716 | ERROR: Illegal instruction $02 at address $95c3; writes 1; prefix 1; drift 0 | ΔRMS 4.100e-2; writes 44; prefix 1; drift 0 | ΔRMS 3.851e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Walk This Way [from Raising Hell]
>  ARTIST: Run DMC featuring Aerosmith

## The Walrus

Path: `DEMOS/S-Z/Walrus_BASIC.sid`

Author: Alice Lawrence · Release/year: 198? Alice Lawrence

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `44350e19d69fc46ae4f73910f26f5161`; SHA-256: `b1950f965a704c90ad0ef179c8fa8c80e6b60a26e507dcaf46d6bb36967c9315`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 5.605e-2; 124 | ΔRMS 5.606e-2; writes 1; prefix 1; drift 0 | ΔRMS 6.095e-2; writes 155; prefix 1; drift 0 | ΔRMS 5.606e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Welcome

Path: `DEMOS/S-Z/Welcome.sid`

Author: Fox · Release/year: 19?? The Empire

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `bcecca91649bad53ea62851c3bafe649`; SHA-256: `f6e78c96f13b6c34f4f0b851f1a797c4069940eb9872bd75a4dcbd23f5f0130d`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 7.088e-2; 30529 | ΔRMS 6.571e-2; writes 30549; prefix 318; drift 109; derived | identical PCM; writes 30529; prefix 30529; drift 0; derived | ΔRMS 6.571e-2; writes 30549; prefix 318; drift 109 |

STIL (full available entry and applicable directory notes):

> TITLE: Crockett's Theme [from the TV series Miami Vice]
>  ARTIST: Jan Hammer
> COMMENT: Edit of /MUSICIANS/B/Blidon_Jens/Crocketts_Theme.sid with digis. The
>          drum pattern at 0:44 resembles /MUSICIANS/M/MC/Rockmonitor_4.sid

## Who's Bad (tune 2)

Path: `DEMOS/S-Z/Whos_Bad_tune_2.sid`

Author: Nik · Release/year: 1988 Enigma

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `ea66040a8daaa4fac4bbe09c295c9ca3`; SHA-256: `e5b544619493e234f0ca6805c3e7c6742e4b1123530f0250d71ee5fb9e64e103`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 9.038e-2; 48502 | ΔRMS 4.201e-2; writes 48502; prefix 279; drift 204; derived | identical PCM; writes 48502; prefix 48502; drift 0; derived | ΔRMS 4.201e-2; writes 48502; prefix 279; drift 204 |

STIL (full available entry and applicable directory notes):

> TITLE: Bad [from Bad]
>  ARTIST: Michael Jackson

## Wolfman Rock Theme

Path: `DEMOS/S-Z/Wolfman_Rock_Theme.sid`

Author: Mac the Wolfman · Release/year: 19?? Electronic Cracking Team

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `0a2b947a89792f787641e718dacdd54e`; SHA-256: `1a26682cf9479590414a3781ceb331572fa35a0fc9ed56c7f7253bb7bdf179ce`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 6.277e-2; 44012 | ΔRMS 2.099e-2; writes 44012; prefix 565; drift 63; derived | identical PCM; writes 44012; prefix 44012; drift 0; derived | ΔRMS 2.099e-2; writes 44012; prefix 565; drift 63 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Wretched

Path: `DEMOS/S-Z/Wretched.sid`

Author: Sascha Theurillat (Hi-Top) · Release/year: 1995 Atlantis

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `b0bade377fe130aac0e4b4618841a7cc`; SHA-256: `39d7ffaeaebb1d1dddb1e93f4d0e0929ef43c9dd3e5719d011c139d30a08c675`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 8.036e-2; 78774 | ΔRMS 9.028e-2; writes 78765; prefix 67; drift 3; derived | identical PCM; writes 78774; prefix 78774; drift 0; derived | ΔRMS 9.028e-2; writes 78765; prefix 67; drift 3 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Xmas-Card

Path: `DEMOS/S-Z/Xmas-Card_BASIC.sid`

Author: Donald Elman · Release/year: 1983 Commander Magazine

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `8fe404eb9ccff8ddbd9824ba2d1f355d`; SHA-256: `32dea1544611ed35f90d55b71bf2048c2753aa94fc729f50e50335ff515ced09`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 4.221e-2; 162 | ΔRMS 4.217e-2; writes 1; prefix 1; drift 0 | ΔRMS 4.952e-2; writes 155; prefix 1; drift 0 | ΔRMS 4.217e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: We Wish You a Merry Christmas
>  ARTIST: Traditional
> COMMENT: English carol

## Xmas

Path: `DEMOS/S-Z/Xmas_BASIC.sid`

Author: Clive Emberey · Release/year: 1984 Clive Emberey

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `72e1b525f0e9f2eb8bbb449389076b1b`; SHA-256: `7a63388f473ec8c53f0ea67a7fef24ecccce601f4e4d2f04bce496c2e7851e73`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 1.763e-2; 70 | ΔRMS 1.748e-2; writes 1; prefix 1; drift 0 | ΔRMS 3.073e-2; writes 148; prefix 1; drift 0 | ΔRMS 1.748e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Gloria in Excelsis Deo (0:03-0:52)
>  ARTIST: French Carol
> COMMENT: Also known as "Angels We Have Heard on High".
>   TITLE: Stille Nacht! Heilige Nacht! (0:54-2:08)
>  ARTIST: Joseph Mohr (lyrics), Franz Xaver Gruber (music)

## Yellow Submarine

Path: `DEMOS/S-Z/Yellow_Submarine_BASIC.sid`

Author: Jesus Martinez · Release/year: 19?? Jesus Martinez

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `76b73a7ffcb135fa73b541cda6309907`; SHA-256: `595651d97d43a9c60f5899c31ae8d748ca64138ad9e7c9cf168a12ecd3adae93`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 1.109e-1; 205 | ΔRMS 2.962e-1; writes 1; prefix 1; drift 0 | ERROR: Illegal instruction $32 at address $2121; writes 44; prefix 1; drift 0 | ΔRMS 2.962e-1; writes 2; prefix 2; drift 12 |

STIL (full available entry and applicable directory notes):

> TITLE: Yellow Submarine [from Revolver]
>  ARTIST: The Beatles

## Yesterday

Path: `DEMOS/S-Z/Yesterday_BASIC.sid`

Author: H. Tanaka · Release/year: 1983 VIC! Magazine

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `88823748e6eeedbd497b250822316d08`; SHA-256: `56ad66bf34cdce8b05570186b06446913246552fb4d3515a08b540dc205f4405`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 6.615e-2; 197 | ΔRMS 6.622e-2; writes 1; prefix 1; drift 0 | ΔRMS 7.007e-2; writes 148; prefix 1; drift 0 | ΔRMS 6.622e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Yesterday [from Help!]
>  ARTIST: The Beatles

## 3-Part Invention

Path: `DEMOS/UNKNOWN/3-Part_Invention.sid`

Author: &lt;?&gt; · Release/year: 198? The Crackin' Ltd.

PSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `0553641b7508fc9614b5beab2934677e`; SHA-256: `a30e70ddc4113b9ad555441cf9c58b53717a6d5cb25848687fd05b54491c3784`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 1.029e-1; 26204 | ΔRMS 1.402e-2; writes 26204; prefix 368; drift 55; derived | identical PCM; writes 26204; prefix 26204; drift 0; derived | ΔRMS 1.402e-2; writes 26204; prefix 368; drift 55 |

STIL (full available entry and applicable directory notes):

> TITLE: Three-Part Invention No. 9 in F minor (BWV 795)
>  ARTIST: Johann Sebastian Bach

## A View to a Kill

Path: `DEMOS/UNKNOWN/A_View_to_a_Kill.sid`

Author: &lt;?&gt; · Release/year: 1988 The Soft-Tiger-Crew

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `ab4922af0f1327641f40e1d8b7055fbd`; SHA-256: `7e30da64dd971b631a00127f963e2f3c102dc986651ac650d1054f621c2a37fc`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 6.461e-2; 56478 | ΔRMS 6.684e-2; writes 56478; prefix 57; drift 0; derived | identical PCM; writes 56478; prefix 56478; drift 0; derived | ΔRMS 6.684e-2; writes 56478; prefix 57; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: A View to a Kill [from the movie]
>  ARTIST: Duran Duran &amp; John Barry
> COMMENT: Edit of /MUSICIANS/M/Mueller_Markus/A_View_to_a_Kill.sid with added
>          Digi drums.

## Aloha Oe

Path: `DEMOS/UNKNOWN/Aloha_Oe_BASIC.sid`

Author: &lt;?&gt; · Release/year: 1985 Free Spirit Software Inc.

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `26a34091bd4a95917d5f0a1ebdf40a1a`; SHA-256: `2fa62087023a0a0532693257ba8f672bc5e2f0f64e9d1f4213fc36d057a27f9c`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 9.050e-2; 106 | ΔRMS 9.554e-2; writes 1; prefix 1; drift 0 | ΔRMS 1.017e-1; writes 155; prefix 1; drift 0 | ΔRMS 9.554e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Aloha `Oe
>  ARTIST: Queen Lili`uokalani

## Anon Music Demo

Path: `DEMOS/UNKNOWN/Anon_Music_Demo_BASIC.sid`

Author: &lt;?&gt; · Release/year: 198? &lt;?&gt;

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `d2d0487deb08134918f1f0d497e55cac`; SHA-256: `fc7abe704b7d0710e74ab45987facc9d588bd8bbc256abd83735d5db35fd7ad0`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 6.576e-2; 482 | ΔRMS 7.618e-2; writes 1; prefix 1; drift 0 | ΔRMS 8.468e-2; writes 148; prefix 1; drift 0 | ΔRMS 7.618e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Asskicker

Path: `DEMOS/UNKNOWN/Asskicker.sid`

Author: &lt;?&gt; · Release/year: 19?? &lt;?&gt;

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `d3dbf69d876573d02dbe84c295af4dbc`; SHA-256: `706acbdfa26e2eebb484cbe3f7fdce273d66fb7b3383be61f27556ff5a13ce14`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 5.061e-2; 238533 | ΔRMS 2.752e-2; writes 239479; prefix 568; drift 114; derived | identical PCM; writes 238533; prefix 238533; drift 0; derived | ΔRMS 2.752e-2; writes 239479; prefix 568; drift 114 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Baby Elephant Walk

Path: `DEMOS/UNKNOWN/Baby_Elephant_Walk_BASIC.sid`

Author: &lt;?&gt; · Release/year: 198? &lt;?&gt;

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `58596dcd645fe0885ff01b038f0c2d37`; SHA-256: `1bd8142676420247729a5c66312e98111fc26dfa379e532f84c75f8f5665703d`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 1.350e-1; 522 | ΔRMS 1.358e-1; writes 1; prefix 1; drift 0 | ΔRMS 1.377e-1; writes 244; prefix 1; drift 0 | ΔRMS 1.358e-1; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Baby Elephant Walk [from the movie Hatari!]
>  ARTIST: Henry Mancini

## Bach

Path: `DEMOS/UNKNOWN/Bach_BASIC.sid`

Author: &lt;?&gt; · Release/year: 19?? &lt;?&gt;

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `d34117a3b0418bba2fb59eb9940fedf0`; SHA-256: `024c4a0384fff22229cb0f6f9e23831e3b6d7fc66e97a5e9b649a992184828ac`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 3.760e-2; 74 | ΔRMS 3.816e-2; writes 1; prefix 1; drift 0 | ERROR: Illegal instruction $32 at address $203f; writes 44; prefix 1; drift 0 | ΔRMS 3.816e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Bach Duet

Path: `DEMOS/UNKNOWN/Bach_Duet_BASIC.sid`

Author: &lt;?&gt; · Release/year: 1984 &lt;?&gt;

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `f9acf7b93f120c0895ce9c203ecd2f39`; SHA-256: `3b920b5ad8d3c8184ee1cb81bd0a304c043d5f57ececc118f19e9fd697dd3206`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 5.246e-2; 330 | ΔRMS 5.390e-2; writes 1; prefix 1; drift 0 | ΔRMS 6.144e-2; writes 148; prefix 1; drift 0 | ΔRMS 5.390e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Concerto in D minor for two violins and strings, first movement (BWV 1043)
>  ARTIST: Johann Sebastian Bach

## Bach Invention 8

Path: `DEMOS/UNKNOWN/Bach_Invention_8_BASIC.sid`

Author: &lt;?&gt; · Release/year: 198? &lt;?&gt;

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `81e727caff52cfbe061e298c216e89d1`; SHA-256: `825dcc592ae68b35dfa4c5e75a7ecf153ddd7be8fec1e3fdfb1ed8dcbc9b3f0e`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 5.273e-2; 249 | ΔRMS 5.268e-2; writes 1; prefix 1; drift 0 | ΔRMS 5.843e-2; writes 148; prefix 1; drift 0 | ΔRMS 5.268e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Two-Part Invention No. 8, in F major (BWV 779)
>  ARTIST: Johann Sebastian Bach

## Bach Preludium

Path: `DEMOS/UNKNOWN/Bach_Preludium_BASIC.sid`

Author: &lt;?&gt; · Release/year: 198? &lt;?&gt;

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `725b1e0c1fe7eee054d5bf7ea7db8510`; SHA-256: `b3a6bf902afa3243e84fe82ec43e0b004a4fc793e0d51fef526aea728d37e00c`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 4.437e-2; 154 | ΔRMS 4.431e-2; writes 1; prefix 1; drift 0 | ΔRMS 5.101e-2; writes 148; prefix 1; drift 0 | ΔRMS 4.431e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Prelude No. 1 (BWV 846)
>  ARTIST: Johann Sebastian Bach

## Bagpipes

Path: `DEMOS/UNKNOWN/Bagpipes_BASIC.sid`

Author: &lt;?&gt; · Release/year: 19?? &lt;?&gt;

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `a0876c7c70f57ffc0db061f81b622c40`; SHA-256: `ebff863b5e988d6c453523256086989869f69c5d556fbcd68503f75f4770baca`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 8.314e-2; 209 | ΔRMS 1.292e-1; writes 1; prefix 1; drift 0 | ERROR: Illegal instruction $32 at address $202e; writes 44; prefix 1; drift 0 | ΔRMS 1.292e-1; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Scotland The Brave
>  ARTIST: Traditional

## Ballade Pour Adeline

Path: `DEMOS/UNKNOWN/Ballade_Pour_Adeline_BASIC.sid`

Author: &lt;?&gt; · Release/year: 198? &lt;?&gt;

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `b5bc68fe80b431c7c92266b73221222b`; SHA-256: `cb0a0be955480e43d14627c628f5015b3bbb065de46045f42425700b6c42043b`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 7.898e-2; 355 | ΔRMS 8.542e-2; writes 1; prefix 1; drift 0 | ΔRMS 8.540e-2; writes 175; prefix 1; drift 0 | ΔRMS 8.542e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Ballade pour Adeline
>  ARTIST: Richard Clayderman &amp; Paul de Senneville

## Basic Music 1

Path: `DEMOS/UNKNOWN/Basic_Music_1_BASIC.sid`

Author: &lt;?&gt; · Release/year: 1987 &lt;?&gt;

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `1d046978bd0353f821ef6eefc12cf40d`; SHA-256: `de07d0c06081e40c829ee5474accdba96c87749c49e09d9637221dfef4e14652`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 1.021e-1; 503 | ΔRMS 1.097e-1; writes 1; prefix 1; drift 0 | ΔRMS 1.083e-1; writes 148; prefix 1; drift 0 | ΔRMS 1.097e-1; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## The Beavers Ranks (30/1-88)

Path: `DEMOS/UNKNOWN/Beavers_Ranks_30_1-88.sid`

Author: &lt;?&gt; · Release/year: 1988 The Beavers

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `dea5b0f6b69238bfa6a468baf33fcb8b`; SHA-256: `f416d34182ab2c9b8ca6d4ee42fb42c6949abbeca6e39870fb8aa5b8007cc452`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 7.241e-2; 57044 | ΔRMS 5.619e-2; writes 57046; prefix 159; drift 125; derived | identical PCM; writes 57044; prefix 57044; drift 0; derived | ΔRMS 5.619e-2; writes 57046; prefix 159; drift 125 |

STIL (full available entry and applicable directory notes):

> TITLE: Ghost Riders in the Sky
>  ARTIST: Stan Jones
> COMMENT: /DEMOS/M-R/Rider_in_the_Sky.sid with added digis.

## The Beavers Ranks (31/1-88)

Path: `DEMOS/UNKNOWN/Beavers_Ranks_31_1-88.sid`

Author: &lt;?&gt; · Release/year: 1988 The Beavers

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `d9c081a0ac2acd9f9387654c9f51e138`; SHA-256: `ce844c6e735f95144e2e793873235e1d10e67195671107a42b1fd17c562088e1`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 3.435e-2; 38012 | ΔRMS 8.695e-3; writes 38011; prefix 159; drift 125; derived | identical PCM; writes 38012; prefix 38012; drift 0; derived | ΔRMS 8.695e-3; writes 38011; prefix 159; drift 125 |

STIL (full available entry and applicable directory notes):

> COMMENT: Edit of /MUSICIANS/U/Unknown_Composer/Final_Countdown_2.sid with added digis.

## Blowin in the Wind

Path: `DEMOS/UNKNOWN/Blowin_in_the_Wind_BASIC.sid`

Author: &lt;?&gt; · Release/year: 198? &lt;?&gt;

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `1a6e32a5e5531eff44d6884a6ab21fdf`; SHA-256: `7e6355ad0b241b837370ec4d2659f504bbc0d0ef2844238893cc66f358e148d5`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 6.621e-2; 262 | ΔRMS 1.267e-1; writes 1; prefix 1; drift 0 | ΔRMS 1.206e-1; writes 148; prefix 1; drift 0 | ΔRMS 1.267e-1; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Blowin' in the Wind
>  ARTIST: Bob Dylan

## Blue Grass Music

Path: `DEMOS/UNKNOWN/Blue_Grass_Music_BASIC.sid`

Author: &lt;?&gt; · Release/year: 1985 Free Spirit Software Inc.

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `aba752d53951669fdf0461d09164a612`; SHA-256: `25d6a9a1c4a54b2e7bbed2021e84e60cbaab0c656b0460fb575951b6bc43c8cd`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 8.094e-2; 287 | ΔRMS 1.115e-1; writes 1; prefix 1; drift 0 | ΔRMS 1.206e-1; writes 155; prefix 1; drift 0 | ΔRMS 1.115e-1; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Bolero

Path: `DEMOS/UNKNOWN/Bolero.sid`

Author: &lt;?&gt; · Release/year: 198? &lt;?&gt;

PSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `54bf440abf6a56c543241bf9fa99c414`; SHA-256: `ace4c47697567416c07406f2adaee9a90eadcf3f6bad8dcef0ecfcf012a25a01`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 3.372e-2; 13871 | ΔRMS 6.847e-3; writes 13871; prefix 192; drift 52; derived | identical PCM; writes 13871; prefix 13871; drift 0; derived | ΔRMS 6.847e-3; writes 13871; prefix 192; drift 52 |

STIL (full available entry and applicable directory notes):

> TITLE: Bolero
>  ARTIST: Maurice Ravel

## Bright Eyes

Path: `DEMOS/UNKNOWN/Bright_Eyes_BASIC.sid`

Author: &lt;?&gt; · Release/year: 198? &lt;?&gt;

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `ffc85c08f080a752f39ec1c355ebb618`; SHA-256: `d7dc17d348c4fd5b30e700c5230d59856c96f47378b6f0454ed213385269457b`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 9.993e-2; 522 | ΔRMS 9.994e-2; writes 1; prefix 1; drift 0 | ERROR: Illegal instruction $32 at address $2024; writes 44; prefix 1; drift 0 | ΔRMS 9.994e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Bright Eyes [from the movie Watership Down]
>  ARTIST: Mike Batt, performed by Art Garfunkel

## Britania

Path: `DEMOS/UNKNOWN/Britania_BASIC.sid`

Author: &lt;?&gt; · Release/year: 198? &lt;?&gt;

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `50bd9388b22845a986b48f02937405ac`; SHA-256: `57f127512db692a798023222f1f7a84fc5bd95f3d9539fa2fc6a3f02b5544f9b`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 6.746e-2; 113 | ΔRMS 6.743e-2; writes 1; prefix 1; drift 0 | ΔRMS 7.176e-2; writes 155; prefix 1; drift 0 | ΔRMS 6.743e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Rule Britannia
>  ARTIST: Thomas Arne (music), James Thompson (lyrics)

## Cantina Band

Path: `DEMOS/UNKNOWN/Cantina_Band.sid`

Author: &lt;?&gt; · Release/year: 1987 Snake &amp; Power

PSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `18792061dc591bfa5594d0e7e085f92a`; SHA-256: `03934066e1f2aed6159b73ba5d250205055cfbf0c3d6e1d496a05ece078b06c8`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 1.337e-1; 42413 | ΔRMS 8.008e-2; writes 42413; prefix 147; drift 57; derived | identical PCM; writes 42413; prefix 42413; drift 0; derived | ΔRMS 8.008e-2; writes 42413; prefix 147; drift 57 |

STIL (full available entry and applicable directory notes):

> TITLE: Cantina Band [from the movie Star Wars Episode IV]
>  ARTIST: John Williams

## Close to You

Path: `DEMOS/UNKNOWN/Close_to_You.sid`

Author: &lt;?&gt; · Release/year: 198? The Crackin' Ltd.

PSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `1709fc08604aa21cf8b6881e430f676e`; SHA-256: `4c8f5eeaf4143567ca7b8a01d4728305081de81eadeb891753330b4364c6d4e4`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 5.100e-2; 15716 | ΔRMS 4.795e-3; writes 15716; prefix 2145; drift 58; derived | identical PCM; writes 15716; prefix 15716; drift 0; derived | ΔRMS 4.795e-3; writes 15716; prefix 2145; drift 58 |

STIL (full available entry and applicable directory notes):

> TITLE: They Long to Be Close to You
>  ARTIST: Burt Bacharach &amp; Hal David

## Computer Blues

Path: `DEMOS/UNKNOWN/Computer_Blues_BASIC.sid`

Author: &lt;?&gt; · Release/year: 198? &lt;?&gt;

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `118f3250f2cbaeaa6ffb03c2344254d2`; SHA-256: `b497862376f218cb7e3b95903841f297e722f5a6291bda85dd3ddda8c50dd91e`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 7.021e-2; 125 | ΔRMS 7.108e-2; writes 1; prefix 1; drift 0 | ΔRMS 7.394e-2; writes 148; prefix 1; drift 0 | ΔRMS 7.108e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Cooler as Cool

Path: `DEMOS/UNKNOWN/Cooler_as_Cool.sid`

Author: &lt;?&gt; · Release/year: 198? &lt;?&gt;

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `7dfeaf11ae3170038b86d7fdeb7d8603`; SHA-256: `b32bf31b38b50793288c09ab5f5fff9c0081bdce9022740f8c4d72954d8daf10`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 5.682e-2; 75068 | ΔRMS 2.379e-2; writes 75761; prefix 203; drift 373; derived | identical PCM; writes 75068; prefix 75068; drift 0; derived | ΔRMS 2.379e-2; writes 75761; prefix 203; drift 373 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Dog

Path: `DEMOS/UNKNOWN/Dog_BASIC.sid`

Author: &lt;?&gt; · Release/year: 198? &lt;?&gt;

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `5b9201469b8eb11221e9806744af6568`; SHA-256: `5cba41d8c721ee0749e16e7cce1049d229a1a1d5e54f656d5037e46f884628ba`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 3.906e-2; 138 | ΔRMS 3.895e-2; writes 1; prefix 1; drift 0 | ΔRMS 4.643e-2; writes 155; prefix 1; drift 0 | ΔRMS 3.895e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Lauterbacher Strumpflied
>  ARTIST: Traditional

## Dragon's Lair

Path: `DEMOS/UNKNOWN/Dragons_Lair.sid`

Author: &lt;?&gt; · Release/year: 19?? &lt;?&gt;

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `1528125154c6a63fa0b07025c09a0cc0`; SHA-256: `0117ded06ce0483724b0c2810d459b6c8a8f2a6f40f6c5125e43d13350abb044`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 5.383e-2; 86116 | ΔRMS 1.789e-2; writes 86122; prefix 341; drift 56; derived | identical PCM; writes 86116; prefix 86116; drift 0; derived | ΔRMS 1.789e-2; writes 86122; prefix 341; drift 56 |

STIL (full available entry and applicable directory notes):

> TITLE: Dragon's Legend
>  ARTIST: Koto

## Dreamy

Path: `DEMOS/UNKNOWN/Dreamy.sid`

Author: &lt;?&gt; · Release/year: 1988 &lt;?&gt;

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `514357c084f02e4852ddd90a9f7b2712`; SHA-256: `d03762fa90a77af9fbf7f4d164b4e0becd8a9a96b9fa88a77079293518060fd0`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 5.097e-2; 48335 | ΔRMS 1.472e-2; writes 48336; prefix 577; drift 64; derived | identical PCM; writes 48335; prefix 48335; drift 0; derived | ΔRMS 1.472e-2; writes 48336; prefix 577; drift 64 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Drumix

Path: `DEMOS/UNKNOWN/Drumix.sid`

Author: &lt;?&gt; · Release/year: 1989 Mamasoft

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `980b2e079ed06490d2e5981f2fe3a921`; SHA-256: `73fd5c6fdf87d0d263c9be9c06d7185d84ec6fcbb8f9053b5fc5da54c2bc7787`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 3.716e-2; 60127 | ΔRMS 2.042e-2; writes 60126; prefix 4638; drift 106; derived | identical PCM; writes 60127; prefix 60127; drift 0; derived | ΔRMS 2.042e-2; writes 60126; prefix 4638; drift 106 |

STIL (full available entry and applicable directory notes):

> TITLE: Hollywood Poker Title [from the Amiga game]
>  ARTIST: Holger Gehrmann
> COMMENT: Plays /MUSICIANS/M/MC/Rockmonitor_4.sid, with digis from
>          /MUSICIANS/H/Huelsbeck_Chris/Bad_Cat.sid

## Drummer Boy

Path: `DEMOS/UNKNOWN/Drummer_Boy_BASIC.sid`

Author: &lt;?&gt; · Release/year: 1985 Free Spirit Software Inc.

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `e3fc3ff090bc218aa908d506655ef2cc`; SHA-256: `8357d44834ca2c13cf038fde24c22033cc5348c041b65d9349cc2c9d4edd0588`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 3.211e-2; 153 | ΔRMS 3.198e-2; writes 1; prefix 1; drift 0 | ΔRMS 4.066e-2; writes 155; prefix 1; drift 0 | ΔRMS 3.198e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Duelling Banjos

Path: `DEMOS/UNKNOWN/Duelling_Banjos.sid`

Author: &lt;?&gt; · Release/year: 198? The Crackin' Ltd.

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `bafe6bda462fbaa98083fa37629a95d1`; SHA-256: `756cbd2826ce5f30cae6e7fdacacf3ed147a9019300e07d7e9fe544cd71d193f`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 5.285e-2; 28001 | ΔRMS 7.350e-2; writes 30748; prefix 142; drift 15; derived | identical PCM; writes 28001; prefix 28001; drift 0; derived | ΔRMS 7.350e-2; writes 30748; prefix 142; drift 15 |

STIL (full available entry and applicable directory notes):

> TITLE: Feudin' Banjos (0:00)
>  ARTIST: Arthur Smith
>   TITLE: At a Darktown Cakewalk (1:23)
>  ARTIST: Charles Hale

## Festival

Path: `DEMOS/UNKNOWN/Festival.sid`

Author: &lt;?&gt; · Release/year: 198? &lt;?&gt;

PSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `c07da227008225f36913e58649409b72`; SHA-256: `5aa5f22c935854fe988b7f6278b5bec655e1969bf220882a667b6f29b7f70a7a`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 6.560e-2; 18750 | ΔRMS 2.061e-2; writes 18750; prefix 582; drift 55; derived | identical PCM; writes 18750; prefix 18750; drift 0; derived | ΔRMS 2.061e-2; writes 18750; prefix 582; drift 55 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Flute

Path: `DEMOS/UNKNOWN/Flute_BASIC.sid`

Author: &lt;?&gt; · Release/year: 1985 Free Spirit Software Inc.

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `58c87f324c7dac46d4441b52016d289a`; SHA-256: `491e08c092aa0f395439f2101a1ecaff9826b11613229eb189123ff525e1b885`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 1.582e-1; 284 | ΔRMS 1.582e-1; writes 1; prefix 1; drift 0 | ΔRMS 1.602e-1; writes 244; prefix 1; drift 0 | ΔRMS 1.582e-1; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Serenade (Opus 3 No. 5)
>  ARTIST: Franz Joseph Haydn

## Frog's Music

Path: `DEMOS/UNKNOWN/Frogs_Music_BASIC.sid`

Author: &lt;?&gt; · Release/year: 19?? &lt;?&gt;

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `7243d0ab9af54469d830893f04d466e4`; SHA-256: `bf43248c57a5c2bf1395eead88ebe52981e4c31b27dd8bbdff5d53e79131a7ca`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 3.289e-2; 329 | ΔRMS 3.281e-2; writes 1; prefix 1; drift 0 | ΔRMS 4.142e-2; writes 148; prefix 1; drift 0 | ΔRMS 3.281e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Estudio en Mi de Rubira
>  ARTIST: Antonio Rubira

## Fucked It (tune 3)

Path: `DEMOS/UNKNOWN/Fucked_It_tune_3.sid`

Author: &lt;?&gt; · Release/year: 1989 The Golden Triangle

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `08c1597c797f5b38f0e8b970278ec955`; SHA-256: `6b4753683699bfc358b0a18d406c82a32a9044c2b002b300e1af8ba100698164`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 3.354e-2; 66609 | ΔRMS 9.977e-3; writes 66608; prefix 9384; drift 46; derived | identical PCM; writes 66609; prefix 66609; drift 0; derived | ΔRMS 9.977e-3; writes 66608; prefix 9384; drift 46 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Fugue

Path: `DEMOS/UNKNOWN/Fugue_BASIC.sid`

Author: &lt;?&gt; · Release/year: 19?? &lt;?&gt;

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `83cb7107b0a2e888b5ba7cf032fced8d`; SHA-256: `49931d3a8f2b81364e0c85f9de82f637c063609efe97679b80ed9a3e07a2bd8b`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 9.660e-2; 342 | ΔRMS 2.697e-1; writes 1; prefix 1; drift 0 | ΔRMS 2.612e-1; writes 244; prefix 1; drift 0 | ΔRMS 2.697e-1; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Fugue in G Minor (BWV 578)
>  ARTIST: Johann Sebastian Bach

## Get Ready

Path: `DEMOS/UNKNOWN/Get_Ready.sid`

Author: &lt;?&gt; · Release/year: 1988 Magicans

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `a85d6028a97fda8bbd6d3ecbd0c4b984`; SHA-256: `9b53a7677b83c0417030493220316da556d5ffad15bd84a464c218689d144b83`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 1.133e-1; 35387 | ΔRMS 6.565e-2; writes 35389; prefix 313; drift 55; derived | identical PCM; writes 35387; prefix 35387; drift 0; derived | ΔRMS 6.565e-2; writes 35389; prefix 313; drift 55 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Gib Aids Eine Chance

Path: `DEMOS/UNKNOWN/Gib_Aids_Eine_Chance.sid`

Author: &lt;?&gt; · Release/year: 1988 The OUG-Team

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `3cd9c4c58f4666ad75f1e75a9124bf57`; SHA-256: `dc572468468d7bd33785e13ae6d8d00974af9428f507969baa0aec4d4ab68780`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 3.265e-2; 50705 | ΔRMS 2.136e-2; writes 50721; prefix 438; drift 118; derived | identical PCM; writes 50705; prefix 50705; drift 0; derived | ΔRMS 2.136e-2; writes 50721; prefix 438; drift 118 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Gigue G Major

Path: `DEMOS/UNKNOWN/Gigue_G_Major_BASIC.sid`

Author: &lt;?&gt; · Release/year: 198? &lt;?&gt;

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `24e5770f6b2461c0c813b4d5794106a5`; SHA-256: `10547af6964f01c10d53c8141fda5d55102bf4ef7d7f7f2b4707a4cab2d4328d`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 7.109e-2; 452 | ΔRMS 7.105e-2; writes 1; prefix 1; drift 0 | ΔRMS 7.541e-2; writes 237; prefix 1; drift 0 | ΔRMS 7.105e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Guitar Britania

Path: `DEMOS/UNKNOWN/Guitar_Britania_BASIC.sid`

Author: &lt;?&gt; · Release/year: 198? &lt;?&gt;

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `dd8b681fe7775794e73f748d4928f596`; SHA-256: `8dcfacaeb033f0a3410bf2f0fe157e3e65b972582faf40ceedea49dc9dab9c33`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 1.999e-2; 113 | ΔRMS 2.426e-2; writes 1; prefix 1; drift 0 | ΔRMS 2.389e-2; writes 155; prefix 1; drift 0 | ΔRMS 2.426e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Rule Britannia
>  ARTIST: Thomas Arne (music), James Thompson (lyrics)
> COMMENT: Same as /DEMOS/UNKNOWN/Britania_BASIC.sid with different instruments.

## Guns

Path: `DEMOS/UNKNOWN/Guns.sid`

Author: &lt;?&gt; · Release/year: 1987 Beastie Boys

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `793c6d7040b71084bdccdda0dca388f9`; SHA-256: `c5904abf4996eefb246d7e0910f28fa7a4b96bfc2b56510c5ca5d0bcaf51ea91`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 5.777e-2; 11703 | ΔRMS 1.387e-2; writes 11703; prefix 378; drift 214; derived | identical PCM; writes 11703; prefix 11703; drift 0; derived | ΔRMS 1.387e-2; writes 11703; prefix 378; drift 214 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Hymne a la Joie

Path: `DEMOS/UNKNOWN/Hymne_a_la_Joie_BASIC.sid`

Author: &lt;?&gt; · Release/year: 198? &lt;?&gt;

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `9063f61a3373476edfc137c9ddf1a85a`; SHA-256: `4743eabe09bf79e3811a6eafe3119fb7f52bbacd5b659e474ce27986580065ff`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 3.981e-2; 119 | ΔRMS 3.978e-2; writes 1; prefix 1; drift 0 | ΔRMS 4.679e-2; writes 148; prefix 1; drift 0 | ΔRMS 3.978e-2; writes 2; prefix 2; drift 14 |

STIL (full available entry and applicable directory notes):

> TITLE: An die Freude [from Symphony No. 9 in D minor, Op. 125 "Choral"]
>  ARTIST: Ludwig van Beethoven

## It's a Sin

Path: `DEMOS/UNKNOWN/Its_a_Sin.sid`

Author: &lt;?&gt; · Release/year: 198? &lt;?&gt;

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `49672c7bbf019d74fb04bc77f082c7a1`; SHA-256: `e1df22727dd658a49a543dd39cb02a76cdcdc54b7d30e78d048163414f9e50e5`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 3.417e-2; 21990 | ΔRMS 2.176e-2; writes 21990; prefix 368; drift 91; derived | identical PCM; writes 21990; prefix 21990; drift 0; derived | ΔRMS 2.176e-2; writes 21990; prefix 368; drift 91 |

STIL (full available entry and applicable directory notes):

> TITLE: It's a Sin [from Actually]
>  ARTIST: Pet Shop Boys

## Lame Beat's

Path: `DEMOS/UNKNOWN/Lame_Beats.sid`

Author: &lt;?&gt; · Release/year: 1989 The Golden Triangle

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `89ee3591b94cb28f0c7ab28ac952ed53`; SHA-256: `5ad799cfefb9cc34c1d7fa62e5676fc31e227f0a56318ff31251caf2ea225c31`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 4.326e-2; 145023 | ΔRMS 3.510e-2; writes 145104; prefix 801; drift 275; derived | identical PCM; writes 145023; prefix 145023; drift 0; derived | ΔRMS 3.510e-2; writes 145104; prefix 801; drift 275 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Let it Be

Path: `DEMOS/UNKNOWN/Let_it_Be_BASIC.sid`

Author: &lt;?&gt; · Release/year: 198? &lt;?&gt;

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `966e1231b1df100b7471972ab18ab524`; SHA-256: `b332fe34413a415d8d98c6082012a9de65df81b4005e6388de4bcf9b38d5f93e`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 4.249e-2; 291 | ΔRMS 4.246e-2; writes 1; prefix 1; drift 0 | ΔRMS 4.900e-2; writes 148; prefix 1; drift 0 | ΔRMS 4.246e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Let it Be [from Let it Be]
>  ARTIST: The Beatles

## Letz Fetz

Path: `DEMOS/UNKNOWN/Letz_Fetz.sid`

Author: &lt;?&gt; · Release/year: 1988 Genesis Project

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `7d4d9654f066246fb34125312e930a85`; SHA-256: `bc59451533ee1b4c82bd21c8c5abe8066e0563a284851b5de55e4c251bc5b959`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 6.027e-2; 47599 | ΔRMS 2.581e-2; writes 47600; prefix 1732; drift 162; derived | identical PCM; writes 47599; prefix 47599; drift 0; derived | ΔRMS 2.581e-2; writes 47600; prefix 1732; drift 162 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Love Boat Theme

Path: `DEMOS/UNKNOWN/Love_Boat_Theme_BASIC.sid`

Author: &lt;?&gt; · Release/year: 198? &lt;?&gt;

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `8a39132333f3b634a6735e5c7d6c6f04`; SHA-256: `4c9ec680da0929b1c680373b26dc6393bc91295b715fa901830cd5e2090dfed6`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 9.812e-2; 249 | ΔRMS 9.807e-2; writes 1; prefix 1; drift 0 | ΔRMS 1.013e-1; writes 155; prefix 1; drift 0 | ΔRMS 9.807e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Love Boat Theme [from the TV series]
>  ARTIST: Charlie Fox &amp; Paul Williams

## Matula's Theme (short version)

Path: `DEMOS/UNKNOWN/Matulas_Theme_short_version.sid`

Author: &lt;?&gt; · Release/year: 1989 Level 99

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `c8c0224954e9b01ba5c771c1ca649d0e`; SHA-256: `76cda7cd7b32dc8da810ca636859763c6f2a4195f97f017d5363c25c048299bd`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 9.335e-2; 23499 | ΔRMS 1.961e-2; writes 23499; prefix 413; drift 108; derived | identical PCM; writes 23499; prefix 23499; drift 0; derived | ΔRMS 1.961e-2; writes 23499; prefix 413; drift 108 |

STIL (full available entry and applicable directory notes):

> TITLE: Ein Fall für Zwei [from the TV series]
>  ARTIST: Klaus Doldinger

## Medley

Path: `DEMOS/UNKNOWN/Medley_BASIC.sid`

Author: &lt;?&gt; · Release/year: 1985 Free Spirit Software Inc.

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `d233f314c92bf9292079f42a689cea8e`; SHA-256: `a66b655de7f9e9ceca202b0e9093b75010a8405873a7c0977b9e10c61b9a2d35`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 7.721e-2; 175 | ΔRMS 8.627e-2; writes 1; prefix 1; drift 0 | ΔRMS 9.388e-2; writes 244; prefix 1; drift 0 | ERROR: Illegal instruction $42 at address $a005; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Mega Petshop Boys Tune

Path: `DEMOS/UNKNOWN/Mega_Petshop_Boys_Tune.sid`

Author: &lt;?&gt; · Release/year: 198? Beastie Boys/Crackout Crew

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `a28d04077513f526e5e3cf741336686e`; SHA-256: `3d15ba0c0e83519b41ee61ef298aaed5d832d6ed195d571a0c02054197b2d1f1`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 3.454e-2; 70099 | ΔRMS 9.046e-3; writes 70099; prefix 178; drift 54; derived | identical PCM; writes 70099; prefix 70099; drift 0; derived | ΔRMS 9.046e-3; writes 70099; prefix 178; drift 54 |

STIL (full available entry and applicable directory notes):

> TITLE: It's a Sin [from Actually]
>  ARTIST: Pet Shop Boys
> COMMENT: Edit of /MUSICIANS/T/Tel_Jeroen/Its_a_Sin.sid with added digis.

## Melodie

Path: `DEMOS/UNKNOWN/Melodie_BASIC.sid`

Author: &lt;?&gt; · Release/year: 198? &lt;?&gt;

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `07add87818fccba25ffb6cfc92a3edae`; SHA-256: `fdcb8b01cbfe3aff2a531e10c4014ae6534efaf25303b7cf449d9adc696c675e`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 9.306e-2; 439 | ΔRMS 1.400e-1; writes 1; prefix 1; drift 0 | ΔRMS 1.348e-1; writes 148; prefix 1; drift 0 | ΔRMS 1.400e-1; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Menuetto D Major

Path: `DEMOS/UNKNOWN/Menuetto_D_Major_BASIC.sid`

Author: &lt;?&gt; · Release/year: 198? &lt;?&gt;

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `e6ed3998dce67e9b2f57ba2ab6277b6d`; SHA-256: `946f29631ea4d04032b653c49d2073a847a74910c1528d23b523ec4c6ded8a96`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 6.352e-2; 347 | ΔRMS 6.348e-2; writes 1; prefix 1; drift 0 | ΔRMS 6.833e-2; writes 44; prefix 1; drift 0 | ΔRMS 6.348e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Merry Christmas

Path: `DEMOS/UNKNOWN/Merry_Christmas_BASIC.sid`

Author: &lt;?&gt; · Release/year: 1983 COMPUTE! Publications

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `4ce784c3cb9872357aa3c185b6ec0532`; SHA-256: `e155923f44c09560f2c98d882b12543b03ef33fe0843f33471ffffa371b693b1`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 4.425e-2; 119 | ΔRMS 4.433e-2; writes 1; prefix 1; drift 0 | ΔRMS 4.991e-2; writes 155; prefix 1; drift 0 | ΔRMS 4.433e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: We Wish You a Merry Christmas
>  ARTIST: Traditional

## Minuet

Path: `DEMOS/UNKNOWN/Minuet_BASIC.sid`

Author: &lt;?&gt; · Release/year: 1985 Free Spirit Software Inc.

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `7fcda5519d5744aac0484b1b48cb4ffc`; SHA-256: `f2223d84cc7c2b2ace6e2e5a3de9b20de21b58363603c08b998f14593fae3a14`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 3.590e-2; 145 | ΔRMS 3.578e-2; writes 1; prefix 1; drift 0 | ΔRMS 4.376e-2; writes 155; prefix 1; drift 0 | ERROR: Illegal instruction $42 at address $a005; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Minuet in G major
>  ARTIST: Christian Petzold
> COMMENT: Although previously attributed to Johann Sebastian Bach
>          (BWV Anh. 114), it's now believed to be composed by Christian Petzold.

## Mixtures

Path: `DEMOS/UNKNOWN/Mixtures.sid`

Author: &lt;?&gt; · Release/year: 1986 &lt;?&gt;

PSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `5c518e1e839dec43b0649525dcf6fd38`; SHA-256: `c94b9f769727770668e072c98c8281d2093aa350a60cfdb13d67956c97bf88f1`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 6.745e-2; 7879 | ΔRMS 5.331e-2; writes 7879; prefix 116; drift 52; derived | identical PCM; writes 7879; prefix 7879; drift 0; derived | ΔRMS 5.331e-2; writes 7879; prefix 116; drift 52 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Mull of Kentyre

Path: `DEMOS/UNKNOWN/Mull_of_Kentyre_BASIC.sid`

Author: &lt;?&gt; · Release/year: 198? &lt;?&gt;

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `a84667bb67b2d65c3b18698b451b4828`; SHA-256: `50084a1f78ff5d8dd027f2725910de0dc9f91f908f2489e688b78b14841e86ce`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 1.138e-1; 171 | ΔRMS 1.138e-1; writes 1; prefix 1; drift 0 | ΔRMS 1.165e-1; writes 148; prefix 1; drift 0 | ΔRMS 1.138e-1; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Mull of Kintyre
>  ARTIST: Wings

## Musichetta

Path: `DEMOS/UNKNOWN/Musichetta_BASIC.sid`

Author: &lt;?&gt; · Release/year: 19?? &lt;?&gt;

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `dbcd81919154d4bdd767ed798954fb84`; SHA-256: `c9683ec4f6bdd559c36f615b769d0df5ec76635ae0a2271ac1d524672fca1549`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 7.355e-2; 353 | ΔRMS 7.358e-2; writes 1; prefix 1; drift 0 | ΔRMS 7.721e-2; writes 148; prefix 1; drift 0 | ΔRMS 7.358e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## NGC Theme

Path: `DEMOS/UNKNOWN/NGC_Theme.sid`

Author: &lt;?&gt; · Release/year: 1987 Beastie Boys

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `bbcbca0a96e78bcce225c2f8cab2a01e`; SHA-256: `d49f6ae34e87c0c525db32e343a4096e2414f9e426e9b9e539f276ef2930007e`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 8.147e-2; 27060 | ΔRMS 7.647e-2; writes 27063; prefix 356; drift 211; derived | identical PCM; writes 27060; prefix 27060; drift 0; derived | ΔRMS 7.647e-2; writes 27063; prefix 356; drift 211 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Nutcracker

Path: `DEMOS/UNKNOWN/Nutcracker.sid`

Author: &lt;?&gt; · Release/year: 198? &lt;?&gt;

PSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `100e8205043458a94e1a763653d6446b`; SHA-256: `95af85d0cdc7fa1a84ef65cce12f3fe9c48f8cbf0af84dabecdc287f8720202e`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 7.421e-2; 12347 | ΔRMS 6.860e-3; writes 12347; prefix 287; drift 54; derived | identical PCM; writes 12347; prefix 12347; drift 0; derived | ΔRMS 6.860e-3; writes 12347; prefix 287; drift 54 |

STIL (full available entry and applicable directory notes):

> TITLE: Overture [from The Nutcracker]
>  ARTIST: Pyotr Ilyich Tchaikovsky

## Oh Mama Vib.

Path: `DEMOS/UNKNOWN/Oh_Mama_Vib_BASIC.sid`

Author: &lt;?&gt; · Release/year: 19?? Funny-Song Company

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `2036c76b2c91e6518e0c0c65f45e421e`; SHA-256: `1c3ba3ce49e660e76d8787cd009b6f44d1fc8f319f1df2148543771f037a6cda`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 1.370e-2; 159 | ΔRMS 1.351e-2; writes 1; prefix 1; drift 0 | ΔRMS 2.863e-2; writes 148; prefix 1; drift 0 | ΔRMS 1.351e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Oh Mama [from Dance Romance]
>  ARTIST: Lili &amp; Sussie

## Oh Susanna

Path: `DEMOS/UNKNOWN/Oh_Susanna_BASIC.sid`

Author: &lt;?&gt; · Release/year: 198? &lt;?&gt;

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `a3a62f7db49e5590a6d3ca38634f5ddd`; SHA-256: `30e84106c2015a53efb497b557ac9e1b19017eab8c7b79504180fa32b1a819ae`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 4.288e-2; 153 | ΔRMS 4.295e-2; writes 1; prefix 1; drift 0 | ΔRMS 4.877e-2; writes 148; prefix 1; drift 0 | ERROR: Illegal instruction $02 at address $0002; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Oh Susanna
>  ARTIST: Stephen C. Foster

## Polka

Path: `DEMOS/UNKNOWN/Polka_BASIC.sid`

Author: &lt;?&gt; · Release/year: 1985 Free Spirit Software Inc.

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `1e92f72bdd633d14de2f3ca4e8d8d850`; SHA-256: `9adc41dfbbbd40fde68cb46b3f9a5e01fed55e2f41f0e8f48c3184843b92a1b8`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 1.033e-1; 465 | ΔRMS 1.033e-1; writes 1; prefix 1; drift 0 | ΔRMS 1.064e-1; writes 155; prefix 1; drift 0 | ΔRMS 1.033e-1; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Polka (Opus 39 No. 14)
>  ARTIST: Pyotr Ilyich Tchaikovsky

## Polonaise

Path: `DEMOS/UNKNOWN/Polonaise_BASIC.sid`

Author: &lt;?&gt; · Release/year: 1985 Free Spirit Software Inc.

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `a7016ed23dc6d0de8a82942b01be75ae`; SHA-256: `88b9d5a6ded232db56180a4d37b4bc7064b80d02540a027898c083b8ada4a0d0`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 60 | both-sensitive | 4.593e-2; 857 | ΔRMS 4.636e-2; writes 1; prefix 1; drift 0 | ΔRMS 4.700e-2; writes 880; prefix 1; drift 0 | ΔRMS 4.636e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Power Song

Path: `DEMOS/UNKNOWN/Power_Song.sid`

Author: &lt;?&gt; · Release/year: 1988 Magicans

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `0d08febc54c7b86f0d3a94bb1882892a`; SHA-256: `a8a08f757808e8dc680b519fe8248677a643ac45ecfc2a11f1863018bee3de6f`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 3.590e-2; 70098 | ΔRMS 1.596e-2; writes 70085; prefix 2399; drift 99; derived | identical PCM; writes 70098; prefix 70098; drift 0; derived | ΔRMS 1.596e-2; writes 70085; prefix 2399; drift 99 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Preludium BWV 937

Path: `DEMOS/UNKNOWN/Preludium_BWV_937_BASIC.sid`

Author: &lt;?&gt; · Release/year: 1986 &lt;?&gt;

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `972be655009dd02a57fb850d9854503b`; SHA-256: `8e633e7ce92c4720ca42d43fe3047bc9a5ec53196e69027d334968209953b399`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 9.346e-2; 346 | ΔRMS 1.542e-1; writes 1; prefix 1; drift 0 | ERROR: Illegal instruction $32 at address $2059; writes 44; prefix 1; drift 0 | ΔRMS 1.542e-1; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Prelude No. 5 (BWV 937)
>  ARTIST: Johann Sebastian Bach

## Rockin' Byte

Path: `DEMOS/UNKNOWN/Rockin_Byte.sid`

Author: &lt;?&gt; · Release/year: 1988 Magicans

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `2f27ff106a04f1ebde593c70f9da0180`; SHA-256: `5b9d26c4b94db1b6fc863792f78719fdd6593b9ef4395c0abaf396b469976128`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 8.041e-2; 57898 | ΔRMS 2.698e-2; writes 57884; prefix 418; drift 55; derived | identical PCM; writes 57898; prefix 57898; drift 0; derived | ΔRMS 2.698e-2; writes 57884; prefix 418; drift 55 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Silly 64

Path: `DEMOS/UNKNOWN/Silly_64_BASIC.sid`

Author: &lt;?&gt; · Release/year: 1983 Silly Software

RSID; BASIC flag set; 7 subtunes. Complete-file MD5: `8c6f4c75082cf307d24842b90eee10c2`; SHA-256: `de91083e77327fb8c535c3b42fe23707a70faaa40fce8fd81aa98ecbb8f02bb5`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 4.532e-2; 440 | ΔRMS 4.527e-2; writes 1; prefix 1; drift 0 | ΔRMS 5.186e-2; writes 148; prefix 1; drift 0 | ΔRMS 4.527e-2; writes 1; prefix 1; drift 0 |
| 2 | 10 | both-sensitive | 7.775e-2; 595 | ΔRMS 7.854e-2; writes 1; prefix 1; drift 0 | ΔRMS 7.974e-2; writes 148; prefix 1; drift 0 | ΔRMS 7.854e-2; writes 1; prefix 1; drift 0 |
| 3 | 10 | both-sensitive | 5.033e-2; 591 | ERROR: Illegal instruction $02 at address $bf54; writes 1; prefix 1; drift 0 | ΔRMS 5.624e-2; writes 148; prefix 1; drift 0 | ΔRMS 5.028e-2; writes 1; prefix 1; drift 0 |
| 4 | 10 | both-sensitive | 9.702e-2; 1805 | ΔRMS 9.748e-2; writes 1; prefix 1; drift 0 | ΔRMS 9.849e-2; writes 148; prefix 1; drift 0 | ΔRMS 9.748e-2; writes 1; prefix 1; drift 0 |
| 5 | 10 | both-sensitive | 5.904e-2; 461 | ΔRMS 1.295e-1; writes 1; prefix 1; drift 0 | ΔRMS 1.403e-1; writes 148; prefix 1; drift 0 | ΔRMS 1.295e-1; writes 1; prefix 1; drift 0 |
| 6 | 10 | both-sensitive | 4.400e-2; 876 | ΔRMS 4.394e-2; writes 1; prefix 1; drift 0 | ΔRMS 5.069e-2; writes 148; prefix 1; drift 0 | ΔRMS 4.394e-2; writes 1; prefix 1; drift 0 |
| 7 | 10 | insufficient-reference-activity | 1.215e-1; 42 | ΔRMS 1.215e-1; writes 1; prefix 1; drift 0 | ΔRMS 1.241e-1; writes 148; prefix 1; drift 0 | ΔRMS 1.215e-1; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Simple Rockit

Path: `DEMOS/UNKNOWN/Simple_Rockit.sid`

Author: &lt;?&gt; · Release/year: 1988 Genesis Project/BFS

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `8b33e99df068aa61049d1a9a4e6fa3c5`; SHA-256: `f4d6fff380c6ccbab0467ead5d51a395077b6953b07990d754cb702370823be9`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 4.561e-2; 31124 | ΔRMS 3.799e-2; writes 31127; prefix 352; drift 89; derived | identical PCM; writes 31124; prefix 31124; drift 0; derived | ΔRMS 3.799e-2; writes 31127; prefix 352; drift 89 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Sleepless

Path: `DEMOS/UNKNOWN/Sleepless.sid`

Author: &lt;?&gt; · Release/year: 198? &lt;?&gt;

PSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `515caa77263c62d456b6fed006e2b9b8`; SHA-256: `410b2493aa3c97275a48a2d255e8292a4c4f5d727fdec2175b1c2cc9a8d02e10`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 1.595e-2; 7835 | ΔRMS 3.089e-3; writes 7835; prefix 115; drift 52; derived | identical PCM; writes 7835; prefix 7835; drift 0; derived | ΔRMS 3.089e-3; writes 7835; prefix 115; drift 52 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Sound Demo II (part 2)

Path: `DEMOS/UNKNOWN/Sound_Demo_II_part_2.sid`

Author: &lt;?&gt; · Release/year: 1987 SCA

PSID; BASIC flag clear; 2 subtunes. Complete-file MD5: `40b7438fc60037f93e20b32970401acc`; SHA-256: `e89d19a208c2de2bdc514b51144045e7b365effa1003718cad38528fcb01a580`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 5.309e-2; 15024 | ΔRMS 7.447e-2; writes 15024; prefix 166; drift 56; derived | identical PCM; writes 15024; prefix 15024; drift 0; derived | ΔRMS 7.447e-2; writes 15024; prefix 166; drift 56 |
| 2 | 10 | kernal-sensitive | 1.172e-1; 22158 | ΔRMS 1.326e-2; writes 22158; prefix 616; drift 55; derived | identical PCM; writes 22158; prefix 22158; drift 0; derived | ΔRMS 1.326e-2; writes 22158; prefix 616; drift 55 |

STIL (full available entry and applicable directory notes):

> (#1)
>   TITLE: Pop Goes the Weasel
>  ARTIST: Traditional
> (#2)
>   TITLE: Axel F [from the movie Beverly Hills Cop]
>  ARTIST: Harold Faltermeyer

## Spinning Song

Path: `DEMOS/UNKNOWN/Spinning_Song_BASIC.sid`

Author: &lt;?&gt; · Release/year: 1985 Free Spirit Software Inc.

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `b4508efc4eda3ac4a32e3640ebbc29c5`; SHA-256: `2259b88937aa999602e571cbe325fad78e38cd405475da41139049df1a806e95`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 1.036e-1; 341 | ΔRMS 1.043e-1; writes 1; prefix 1; drift 0 | ERROR: Illegal instruction $32 at address $203c; writes 44; prefix 1; drift 0 | ΔRMS 1.043e-1; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Spinnliedchen (Op. 14, No. 4) [from Musikalische Genrebilder]
>  ARTIST: Albert Ellmenreich
> COMMENT: Also known as "Spinning Song".

## Streets of Lond.

Path: `DEMOS/UNKNOWN/Streets_of_Lond_BASIC.sid`

Author: &lt;?&gt; · Release/year: 198? &lt;?&gt;

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `edfb3c915a4e3b08368ca5505fc7d85d`; SHA-256: `66e2536308a957c0165b142739faeac0def23e9792b1717c2abf877e2da745de`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 7.719e-2; 311 | ΔRMS 1.126e-1; writes 1; prefix 1; drift 0 | ΔRMS 1.080e-1; writes 148; prefix 1; drift 0 | ΔRMS 1.126e-1; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Streets of London
>  ARTIST: Ralph McTell

## Stuck on Classics

Path: `DEMOS/UNKNOWN/Stuck_on_Classics_BASIC.sid`

Author: &lt;?&gt; · Release/year: 198? &lt;?&gt;

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `d24b963554036bff6d3d000f29a78c23`; SHA-256: `d4a1963c1bc050131f0e7b0955cce33419991fbeb5bc2666cb67723c14003664`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 5.200e-2; 233 | ΔRMS 5.193e-2; writes 1; prefix 1; drift 0 | ΔRMS 5.755e-2; writes 155; prefix 1; drift 0 | ΔRMS 5.193e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Sweet Miss Jane

Path: `DEMOS/UNKNOWN/Sweet_Miss_Jane.sid`

Author: &lt;?&gt; · Release/year: 1988 Genesis Project/BFS

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `00b17dfdab096e3dd39fea8dc0967b2f`; SHA-256: `3c0a796430e861417b7d98c67352657d58ea0acd998b66a2997589330fa268d0`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 4.049e-2; 39678 | ΔRMS 2.110e-2; writes 39678; prefix 438; drift 93; derived | identical PCM; writes 39678; prefix 39678; drift 0; derived | ΔRMS 2.110e-2; writes 39678; prefix 438; drift 93 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Swinging

Path: `DEMOS/UNKNOWN/Swinging_BASIC.sid`

Author: &lt;?&gt; · Release/year: 198? &lt;?&gt;

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `34a779a9185b431f63d9bcf6c01e8238`; SHA-256: `9c244ad6b83fac940c0339b9a533e17b06b4b15ec1b3e9564e94d050a923a94a`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 7.604e-2; 223 | ΔRMS 7.601e-2; writes 1; prefix 1; drift 0 | ΔRMS 8.010e-2; writes 148; prefix 1; drift 0 | ΔRMS 7.601e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Syncopatin Sid

Path: `DEMOS/UNKNOWN/Syncopatin_Sid_BASIC.sid`

Author: &lt;?&gt; · Release/year: 1984 &lt;?&gt;

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `708591f7a3c6463f5da4b05e149dcbab`; SHA-256: `20bb149b47f33977a0c2c2ecb0836dd1289869546497b129349a6321f51fd407`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 6.324e-2; 352 | ΔRMS 7.203e-2; writes 1; prefix 1; drift 0 | ΔRMS 8.050e-2; writes 148; prefix 1; drift 0 | ΔRMS 7.203e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Tico Tico

Path: `DEMOS/UNKNOWN/Tico_Tico_BASIC.sid`

Author: &lt;?&gt; · Release/year: 198? Bananasoft

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `829597b638d85e6ceb4fb3fa72aa4eaa`; SHA-256: `dc054d3af5a50fc2d2fcdf0177a6d81a39a7f9ce1c7209bae62390cb8dddb585`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 7.121e-2; 374 | ΔRMS 7.117e-2; writes 1; prefix 1; drift 0 | ΔRMS 7.553e-2; writes 237; prefix 1; drift 0 | ΔRMS 7.117e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Tico-Tico no fubá
>  ARTIST: Zequinha de Abreu
> COMMENT: A famous Brazilian choro tune composed in 1917.

## The Tune

Path: `DEMOS/UNKNOWN/Tune_2_BASIC.sid`

Author: &lt;?&gt; · Release/year: 198? &lt;?&gt;

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `4ba1ecd3e2f50cfda5c6a149c28a8050`; SHA-256: `44e12ca56ff8d94cf6530a22546b537edde302751b0f3299b3fc391b4f5b8f39`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 7.358e-2; 228 | ΔRMS 7.358e-2; writes 1; prefix 1; drift 0 | ΔRMS 7.735e-2; writes 148; prefix 1; drift 0 | ΔRMS 7.358e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Tune

Path: `DEMOS/UNKNOWN/Tune_BASIC.sid`

Author: &lt;?&gt; · Release/year: 19?? &lt;?&gt;

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `3e72b77bf0f6411f902f7832c9da01b6`; SHA-256: `8823f8b362519d9f91770502992e461d0f84f75d5970bf2b3da3dcf30a7d784e`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 6.225e-2; 133 | ΔRMS 6.224e-2; writes 1; prefix 1; drift 0 | ΔRMS 6.696e-2; writes 148; prefix 1; drift 0 | ΔRMS 6.224e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Dance of the Cuckoos
>  ARTIST: Marvin Hatley
> COMMENT: Title music for all the Laurel &amp; Hardy short movies.

## &lt;?&gt;

Path: `DEMOS/UNKNOWN/Unknown_BASIC.sid`

Author: &lt;?&gt; · Release/year: 19?? &lt;?&gt;

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `1c7ed1322145c052c5b0c94255536da6`; SHA-256: `c73a5078b3341b3291f53f0d235acdcfa6f7274f613cf6ea07416923e8739839`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 4.513e-2; 291 | ΔRMS 4.560e-2; writes 1; prefix 1; drift 0 | ΔRMS 5.079e-2; writes 148; prefix 1; drift 0 | ΔRMS 4.560e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Jesu, Joy of Man's Desiring (Cantata, BWV 147)
>  ARTIST: Johann Sebastian Bach

## Victory

Path: `DEMOS/UNKNOWN/Victory_BASIC.sid`

Author: &lt;?&gt; · Release/year: 19?? &lt;?&gt;

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `cd3509429dc26259040131d6beaf2f48`; SHA-256: `22e9c48656e8ad48b4f52e05811e03cb653d33b68b4e204d8db3f6e39ed1ef10`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 4.385e-2; 159 | ΔRMS 4.375e-2; writes 1; prefix 1; drift 0 | ΔRMS 5.051e-2; writes 155; prefix 1; drift 0 | ΔRMS 4.375e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: The Star Spangled Banner (National Anthem of the U.S.A.)
>  ARTIST: Sir Francis Scott Key (lyrics), John Stafford Smith (music)

## Videobasic 2.0

Path: `DEMOS/UNKNOWN/Videobasic_2_0_BASIC.sid`

Author: &lt;?&gt; · Release/year: 1985 Softidea

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `2344856d764b3c5298ba3652f28f9fd6`; SHA-256: `652c95cf6f083af4b90111fec51be498d927be51b7cc4b7179291a781c4de950`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 3.714e-2; 90 | ΔRMS 3.824e-2; writes 1; prefix 1; drift 0 | ΔRMS 4.355e-2; writes 148; prefix 1; drift 0 | ΔRMS 3.824e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: An die Freude [from Symphony No. 9 in D minor, Op. 125 "Choral"]
>  ARTIST: Ludwig van Beethoven

## Videobreak 06

Path: `DEMOS/UNKNOWN/Videobreak_06_BASIC.sid`

Author: &lt;?&gt; · Release/year: 198? Softidea

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `825e4963ca604a77afa17a06cb14d4c0`; SHA-256: `2de8dc38accbb889889354975964f58d176df1cf7232b1ec99e6a3336511236b`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 1.344e-1; 959 | ΔRMS 1.344e-1; writes 1; prefix 1; drift 0 | ΔRMS 1.360e-1; writes 237; prefix 1; drift 0 | ΔRMS 1.344e-1; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Jesu, Joy of Man's Desiring (Cantata, BWV 147)
>  ARTIST: Johann Sebastian Bach

## Videobreak 07

Path: `DEMOS/UNKNOWN/Videobreak_07_BASIC.sid`

Author: &lt;?&gt; · Release/year: 198? Softidea

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `7548a4def709c7dcc1ee707d9327964c`; SHA-256: `50f26dc4de0a70ddb622671d2e63cdd09ac6b494b260caee8f2a91301f77384e`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 1.323e-1; 292 | ΔRMS 1.323e-1; writes 1; prefix 1; drift 0 | ΔRMS 1.343e-1; writes 148; prefix 1; drift 0 | ΔRMS 1.323e-1; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Videobreak 08

Path: `DEMOS/UNKNOWN/Videobreak_08_BASIC.sid`

Author: &lt;?&gt; · Release/year: 198? Softidea

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `61a3551df143b25d3ebde960c99f6c4d`; SHA-256: `9f4f273620ccae5f3a60791e1069e99f70e47108b8c4ee04c51f2e02ecbb24af`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 1.123e-1; 617 | ΔRMS 1.781e-1; writes 1; prefix 1; drift 0 | ERROR: Illegal instruction $32 at address $202c; writes 44; prefix 1; drift 0 | ERROR: Illegal instruction $42 at address $a005; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Rondo alla turca [from Piano Sonata No. 11 A major KV 331]
>  ARTIST: Wolfgang Amadeus Mozart

## Videobreak 09

Path: `DEMOS/UNKNOWN/Videobreak_09_BASIC.sid`

Author: &lt;?&gt; · Release/year: 198? Softidea

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `299d98d9242ea660b343f45191a732d5`; SHA-256: `b1721b7025e0d5bae8f560ff9206a82d962c6c785da32c0e125ef026ed21145d`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 1.443e-1; 815 | ΔRMS 1.832e-1; writes 1; prefix 1; drift 0 | ΔRMS 1.779e-1; writes 237; prefix 1; drift 0 | ΔRMS 1.832e-1; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Für Elise
>  ARTIST: Ludwig van Beethoven

## Videobreak 11

Path: `DEMOS/UNKNOWN/Videobreak_11_BASIC.sid`

Author: &lt;?&gt; · Release/year: 198? Softidea

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `e2c9b9795d22aa5b45493dd87c66c316`; SHA-256: `dda9b679a9066e04985d4dcb0ae6fd69b09808f5da1586a282dacf939aa34a5a`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 9.044e-2; 432 | ΔRMS 9.070e-2; writes 1; prefix 1; drift 0 | ERROR: Illegal instruction $f2 at address $d023; writes 176; prefix 1; drift 0 | ΔRMS 9.070e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Videobreak 16

Path: `DEMOS/UNKNOWN/Videobreak_16_BASIC.sid`

Author: &lt;?&gt; · Release/year: 198? Softidea

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `3ce79d1c483fc53f8d9bb0d787bd0859`; SHA-256: `d8809b2cf43e74308582ef1e4e4129ad20b48ca59f09ddb2636a6bc2cadd088f`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 1.072e-1; 595 | ΔRMS 1.366e-1; writes 1; prefix 1; drift 0 | ΔRMS 1.326e-1; writes 148; prefix 1; drift 0 | ΔRMS 1.366e-1; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Symphony No. 40, First Movement
>  ARTIST: Wolfgang Amadeus Mozart

## Videobreak 17

Path: `DEMOS/UNKNOWN/Videobreak_17_BASIC.sid`

Author: &lt;?&gt; · Release/year: 198? Softidea

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `4fece73291ccf3907325c58db7967b65`; SHA-256: `864fe49e6f1a0006ee61d33d4462357763caa00ff7a1be3419a185fc04412ba1`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 1.450e-1; 603 | ΔRMS 1.940e-1; writes 1; prefix 1; drift 0 | ΔRMS 1.887e-1; writes 148; prefix 1; drift 0 | ΔRMS 1.940e-1; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Videobreak 18

Path: `DEMOS/UNKNOWN/Videobreak_18_BASIC.sid`

Author: &lt;?&gt; · Release/year: 198? Softidea

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `20fb4cd4d4e9b59c65b7284148aa13c3`; SHA-256: `cffd894b95ab6b871f6c42eb2fc7ee1fb852a5f60729fefd07a187bb3a738ced`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 1.280e-1; 495 | ΔRMS 1.377e-1; writes 1; prefix 1; drift 0 | ΔRMS 1.354e-1; writes 237; prefix 1; drift 0 | ΔRMS 1.377e-1; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Who Made Who

Path: `DEMOS/UNKNOWN/Who_Made_Who.sid`

Author: &lt;?&gt; · Release/year: 1988 The Zaints

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `e045a2edf56cd5f3a52f572218bf6cfa`; SHA-256: `9d51e3b5806a0afbe135b3fc87f606d37a1ed028b0bfdc83dc2313d8d4bb8a1d`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 2.620e-2; 29743 | ΔRMS 1.810e-2; writes 29742; prefix 159; drift 116; derived | identical PCM; writes 29743; prefix 29743; drift 0; derived | ΔRMS 1.810e-2; writes 29742; prefix 159; drift 116 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Wildwood Flower

Path: `DEMOS/UNKNOWN/Wildwood_Flower_BASIC.sid`

Author: &lt;?&gt; · Release/year: 1985 Free Spirit Software Inc.

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `084faf8b087493efa7c84bb71cc49561`; SHA-256: `99fe1a3fce3c2d4577ba035a2c3bc0558339cab331a4026be8e982898da72120`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 9.307e-2; 177 | ΔRMS 1.236e-1; writes 1; prefix 1; drift 0 | ΔRMS 1.322e-1; writes 155; prefix 1; drift 0 | ΔRMS 1.236e-1; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Wildwood Flower
>  ARTIST: Joseph Philbrick Webster (music), Maud Irving (lyrics)

## Yesterday

Path: `DEMOS/UNKNOWN/Yesterday_BASIC.sid`

Author: &lt;?&gt; · Release/year: 1983 &lt;?&gt;

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `fea63e031b6b7c2adea5b44fa59ef488`; SHA-256: `1c4167092a3f0db90124fc0ff154a4e83fd7561a090f7d6925d33452689a7434`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 4.951e-2; 224 | ΔRMS 4.943e-2; writes 1; prefix 1; drift 0 | ΔRMS 5.552e-2; writes 155; prefix 1; drift 0 | ΔRMS 4.943e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Yesterday [from Help!]
>  ARTIST: The Beatles

## 10... Knockout!

Path: `GAMES/0-9/10_Knockout_BASIC.sid`

Author: NP · Release/year: 1985 Amersoft

RSID; BASIC flag set; 5 subtunes. Complete-file MD5: `c25b31e04842a5f7d00b00fe3521cf16`; SHA-256: `7d943982a8894e99ce7af34c8df718404dba23ffb297da9da913ff008b127c27`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 6.384e-2; 237 | ΔRMS 7.442e-2; writes 1; prefix 1; drift 0 | ΔRMS 8.368e-2; writes 148; prefix 1; drift 0 | ΔRMS 7.442e-2; writes 1; prefix 1; drift 0 |
| 2 | 10 | insufficient-reference-activity | 1.986e-2; 9 | ΔRMS 4.003e-2; writes 1; prefix 1; drift 0 | ΔRMS 5.565e-2; writes 148; prefix 1; drift 0 | ΔRMS 4.003e-2; writes 1; prefix 1; drift 0 |
| 3 | 10 | insufficient-reference-activity | 3.565e-2; 10 | ERROR: Illegal instruction $02 at address $bf54; writes 1; prefix 1; drift 0 | ΔRMS 3.946e-2; writes 148; prefix 1; drift 0 | ΔRMS 3.647e-2; writes 1; prefix 1; drift 0 |
| 4 | 10 | insufficient-reference-activity | 4.351e-2; 7 | ΔRMS 4.345e-2; writes 1; prefix 1; drift 0 | ΔRMS 5.020e-2; writes 148; prefix 1; drift 0 | ΔRMS 4.345e-2; writes 1; prefix 1; drift 0 |
| 5 | 10 | insufficient-reference-activity | 6.893e-3; 7 | ΔRMS 6.547e-3; writes 1; prefix 1; drift 0 | ΔRMS 2.603e-2; writes 148; prefix 1; drift 0 | ΔRMS 6.547e-3; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> (#1)
>   TITLE: This Little Light of Mine
>  ARTIST: Harry Dixon Loes

## The Act Game

Path: `GAMES/A-F/Act_Game_BASIC.sid`

Author: Jörg Riesenweber · Release/year: 19?? Knobisoftware

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `278b8cc413c2d21678419db2765c68df`; SHA-256: `2858d98f30a8016c5f55343a04720c0201cb199432e5e66b709c6c377d46db88`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 5.135e-2; 164 | ΔRMS 5.136e-2; writes 1; prefix 1; drift 0 | ΔRMS 5.658e-2; writes 148; prefix 1; drift 0 | ΔRMS 5.136e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Aghamix

Path: `GAMES/A-F/Aghamix.sid`

Author: Daniel Delevoye · Release/year: 1987 FIL

RSID; BASIC flag clear; 2 subtunes. Complete-file MD5: `c2d0c37272358fc204c694603d32a982`; SHA-256: `374bbc6c71d43264b15614ab086721727b238be033386e3afd4419842b1ce370`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 1.250e-1; 541 | ΔRMS 1.613e-1; writes 553; prefix 541; drift 187949; derived | identical PCM; writes 541; prefix 541; drift 0; derived | ΔRMS 1.613e-1; writes 553; prefix 541; drift 187949 |
| 2 | 2 | pcm-difference-with-similar-write-sequence | 1.168e-1; 91 | ΔRMS 1.550e-3; writes 91; prefix 91; drift 11; derived | identical PCM; writes 91; prefix 91; drift 0; derived | ΔRMS 1.550e-3; writes 91; prefix 91; drift 11 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Albert

Path: `GAMES/A-F/Albert_BASIC.sid`

Author: Gilles Siffert · Release/year: 1985 Hebdogiciel

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `1af8d1e785b8753bc65c45f30c802dbd`; SHA-256: `793099708d07e3b0e0354f0a5325ba4d4bc58fa945b1af5014514db8f3bc6c6d`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 5.352e-2; 314 | ΔRMS 5.351e-2; writes 1; prefix 1; drift 0 | ΔRMS 5.877e-2; writes 148; prefix 1; drift 0 | ΔRMS 5.351e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Alf the First Adventure

Path: `GAMES/A-F/Alf_the_First_Adventure.sid`

Author: &lt;?&gt; · Release/year: 1988 Box Office

RSID; BASIC flag clear; 16 subtunes. Complete-file MD5: `6522f16d3d69261099533aaecb7f43c9`; SHA-256: `a716f314ca084666d042add6e06c8f56b7a82174ddd74ae69cfd1abb4cb2688d`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 3.690e-2; 166 | ΔRMS 4.830e-2; writes 166; prefix 166; drift 7156; derived | identical PCM; writes 166; prefix 166; drift 0; derived | ΔRMS 4.830e-2; writes 166; prefix 166; drift 7156 |
| 2 | 10 | insufficient-reference-activity | 1.479e-2; 59 | ΔRMS 7.256e-3; writes 59; prefix 59; drift 911; derived | identical PCM; writes 59; prefix 59; drift 0; derived | ΔRMS 7.256e-3; writes 59; prefix 59; drift 911 |
| 3 | 2 | pcm-difference-with-similar-write-sequence | 3.803e-2; 65 | ΔRMS 3.628e-5; writes 65; prefix 65; drift 55; derived | identical PCM; writes 65; prefix 65; drift 0; derived | ΔRMS 3.628e-5; writes 65; prefix 65; drift 55 |
| 4 | 10 | kernal-sensitive | 3.335e-2; 98 | ΔRMS 2.756e-2; writes 98; prefix 98; drift 6563; derived | identical PCM; writes 98; prefix 98; drift 0; derived | ΔRMS 2.756e-2; writes 98; prefix 98; drift 6563 |
| 5 | 10 | kernal-sensitive | 3.961e-2; 80 | ΔRMS 3.697e-2; writes 80; prefix 80; drift 5997; derived | identical PCM; writes 80; prefix 80; drift 0; derived | ΔRMS 3.697e-2; writes 80; prefix 80; drift 5997 |
| 6 | 10 | insufficient-reference-activity | 2.522e-2; 62 | ΔRMS 3.282e-2; writes 62; prefix 62; drift 7018; derived | identical PCM; writes 62; prefix 62; drift 0; derived | ΔRMS 3.282e-2; writes 62; prefix 62; drift 7018 |
| 7 | 10 | insufficient-reference-activity | 2.121e-2; 24 | ΔRMS 5.592e-3; writes 24; prefix 24; drift 559; derived | identical PCM; writes 24; prefix 24; drift 0; derived | ΔRMS 5.592e-3; writes 24; prefix 24; drift 559 |
| 8 | 2 | pcm-difference-with-similar-write-sequence | 1.727e-2; 217 | ΔRMS 5.388e-3; writes 217; prefix 217; drift 324; derived | identical PCM; writes 217; prefix 217; drift 0; derived | ΔRMS 5.388e-3; writes 217; prefix 217; drift 324 |
| 9 | 10 | insufficient-reference-activity | 7.863e-3; 17 | ΔRMS 1.002e-5; writes 17; prefix 17; drift 745; derived | identical PCM; writes 17; prefix 17; drift 0; derived | ΔRMS 1.002e-5; writes 17; prefix 17; drift 745 |
| 10 | 10 | insufficient-reference-activity | 1.052e-2; 26 | ΔRMS 5.989e-6; writes 26; prefix 26; drift 283; derived | identical PCM; writes 26; prefix 26; drift 0; derived | ΔRMS 5.989e-6; writes 26; prefix 26; drift 283 |
| 11 | 10 | insufficient-reference-activity | 1.052e-2; 26 | ΔRMS 5.966e-6; writes 26; prefix 26; drift 283; derived | identical PCM; writes 26; prefix 26; drift 0; derived | ΔRMS 5.966e-6; writes 26; prefix 26; drift 283 |
| 12 | 10 | insufficient-reference-activity | 1.051e-2; 26 | ΔRMS 5.961e-6; writes 26; prefix 26; drift 283; derived | identical PCM; writes 26; prefix 26; drift 0; derived | ΔRMS 5.961e-6; writes 26; prefix 26; drift 283 |
| 13 | 2 | pcm-difference-with-similar-write-sequence | 3.890e-2; 80 | ΔRMS 1.899e-3; writes 80; prefix 80; drift 339; derived | identical PCM; writes 80; prefix 80; drift 0; derived | ΔRMS 1.899e-3; writes 80; prefix 80; drift 339 |
| 14 | 10 | insufficient-reference-activity | 9.198e-3; 22 | ΔRMS 5.605e-5; writes 22; prefix 22; drift 131; derived | identical PCM; writes 22; prefix 22; drift 0; derived | ΔRMS 5.605e-5; writes 22; prefix 22; drift 131 |
| 15 | 2 | pcm-difference-with-similar-write-sequence | 5.658e-2; 66 | ΔRMS 3.783e-3; writes 66; prefix 66; drift 13; derived | identical PCM; writes 66; prefix 66; drift 0; derived | ΔRMS 3.783e-3; writes 66; prefix 66; drift 13 |
| 16 | 2 | pcm-difference-with-similar-write-sequence | 6.373e-2; 309 | ΔRMS 6.293e-2; writes 309; prefix 309; drift 996; derived | identical PCM; writes 309; prefix 309; drift 0; derived | ΔRMS 6.293e-2; writes 309; prefix 309; drift 996 |

STIL (full available entry and applicable directory notes):

> (#2)
>   TITLE: Charge
>  ARTIST: Tommy Walker
> COMMENT: Conversion of /DEMOS/A-F/Fanfare_BASIC.sid with a typo on last harmony.
>          Also used in the games "$100,000 Pyramid" and "High Rollers", both
>          also (C) 1988 Box Office
> (#3)
>   TITLE: Original Rags
>  ARTIST: Scott Joplin
> (#4)
>   TITLE: Malbrouk s'en va-t-en guerre
>  ARTIST: Traditional
> COMMENT: An Arab tune that was brought to Europe during the crusades and
>          became popular during the french revolution, ever since spawned
>          many songs, including "For He's a Jolly Good Fellow".
> (#5)
>   TITLE: Dragnet Theme [from the television series]
>  ARTIST: Miklós Rózsa &amp; Walter Schumann
> (#6)
>   TITLE: Land of Hope and Glory [from Pomp and Circumstance March No. 1]
>  ARTIST: Edward Elgar (music), A.C. Benson (lyrics)

## Alien Attack 64

Path: `GAMES/A-F/Alien_Attack_64_BASIC.sid`

Author: Richard J. Gibbs · Release/year: 1983 Home Computing Weekly

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `392a6a219733af374dc807dd63f74550`; SHA-256: `9477e9b93279de6253a23fe1d9b67e6967a4e682f9759c07b187c5401176608c`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 1.136e-1; 156 | ΔRMS 1.140e-1; writes 1; prefix 1; drift 0 | ΔRMS 1.131e-1; writes 148; prefix 2; drift 5980 | ΔRMS 1.129e-1; writes 2; prefix 2; drift 14 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## All New Family Feud

Path: `GAMES/A-F/All_New_Family_Feud_BASIC.sid`

Author: &lt;?&gt; · Release/year: 1989 Sharedata

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `8e091d698c8ceaf030594bf771741907`; SHA-256: `5d8e733ccc7ae317a4887b69d96de698faf3a7e8b62941ff2f0db8be7d0960e7`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 5.660e-2; 578 | ΔRMS 5.661e-2; writes 1; prefix 1; drift 0 | ΔRMS 6.153e-2; writes 155; prefix 1; drift 0 | ΔRMS 5.661e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Angry Ninja

Path: `GAMES/A-F/Angry_Ninja_BASIC.sid`

Author: James Strope · Release/year: 1994 Senator Scratch/J. Strope

RSID; BASIC flag set; 2 subtunes. Complete-file MD5: `b40ebc7481e717dc8c32c268cfc4add4`; SHA-256: `f303701da37850579166963f3586bb777f2a44b05b6aeff2988692c2fa756876`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 1.411e-1; 533 | ΔRMS 1.439e-1; writes 1; prefix 1; drift 0 | ΔRMS 1.463e-1; writes 237; prefix 1; drift 0 | ΔRMS 1.439e-1; writes 1; prefix 1; drift 0 |
| 2 | 10 | both-sensitive | 9.399e-2; 1138 | ΔRMS 9.604e-2; writes 1; prefix 1; drift 0 | ΔRMS 9.964e-2; writes 237; prefix 1; drift 0 | ΔRMS 9.604e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Apartment of Mystery

Path: `GAMES/A-F/Apartment_of_Mystery_BASIC.sid`

Author: &lt;?&gt; · Release/year: 1987 Uptime Mag./Softdisk Pub.

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `e08d09bd8b81b6c8cee062810f2d624b`; SHA-256: `cf5a29649d570a218335ce0c8de73a216acffa37bdb802eaf9697e02e2798424`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 1.320e-1; 358 | ΔRMS 1.333e-1; writes 1; prefix 1; drift 0 | ΔRMS 1.336e-1; writes 155; prefix 2; drift 6168 | ΔRMS 1.333e-1; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Toccata [from Toccata and Fugue in D Minor (BWV 565)]
>  ARTIST: Johann Sebastian Bach

## Auf Wiedersehen Pet

Path: `GAMES/A-F/Auf_Wiedersehen_Pet_BASIC.sid`

Author: Bob Carr · Release/year: 1984 Tynesoft

RSID; BASIC flag set; 7 subtunes. Complete-file MD5: `3a9a313c17010f9f95292122f817eed8`; SHA-256: `53b8770e2999ec1e30a7c4102ed2a83f0b1c9793ca684523f7513b493e4e3d24`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 3.361e-2; 199 | ΔRMS 3.353e-2; writes 1; prefix 1; drift 0 | ΔRMS 4.196e-2; writes 148; prefix 1; drift 0 | ΔRMS 3.353e-2; writes 1; prefix 1; drift 0 |
| 2 | 10 | both-sensitive | 4.279e-2; 207 | ΔRMS 4.273e-2; writes 1; prefix 1; drift 0 | ΔRMS 4.963e-2; writes 148; prefix 1; drift 0 | ΔRMS 6.048e-2; writes 207; prefix 207; drift 114151 |
| 3 | 10 | both-sensitive | 4.877e-2; 293 | ERROR: Illegal instruction $02 at address $bf54; writes 1; prefix 1; drift 0 | ΔRMS 5.487e-2; writes 148; prefix 1; drift 0 | ΔRMS 6.687e-2; writes 295; prefix 293; drift 163278 |
| 4 | 10 | both-sensitive | 3.121e-2; 157 | ΔRMS 3.113e-2; writes 1; prefix 1; drift 0 | ΔRMS 4.008e-2; writes 148; prefix 1; drift 0 | ΔRMS 4.370e-2; writes 157; prefix 157; drift 52818 |
| 5 | 10 | both-sensitive | 3.906e-2; 183 | ΔRMS 3.900e-2; writes 1; prefix 1; drift 0 | ΔRMS 4.641e-2; writes 148; prefix 1; drift 0 | ΔRMS 5.177e-2; writes 183; prefix 183; drift 32855 |
| 6 | 10 | both-sensitive | 5.373e-2; 439 | ΔRMS 5.368e-2; writes 1; prefix 1; drift 0 | ΔRMS 5.924e-2; writes 148; prefix 1; drift 0 | ΔRMS 7.473e-2; writes 439; prefix 439; drift 61797 |
| 7 | 10 | both-sensitive | 2.605e-2; 221 | ΔRMS 2.595e-2; writes 1; prefix 1; drift 0 | ΔRMS 3.620e-2; writes 148; prefix 1; drift 0 | ΔRMS 3.721e-2; writes 221; prefix 221; drift 51871 |

STIL (full available entry and applicable directory notes):

> (#1)
>   TITLE: That's Livin' Alright [from the TV series Auf Wiedersehen Pet]
>  ARTIST: Joe Fagin
> (#2)
>   TITLE: Heigh-Ho [from the movie Snow White and the Seven Dwarfs]
>  ARTIST: The Dwarfs Chorus
> (#3)
>   TITLE: Show Me The Way To Go Home
>  ARTIST: Jimmy Campbell &amp; Reg Connelly

## Aussie Games

Path: `GAMES/A-F/Aussie_Games.sid`

Author: &lt;?&gt; · Release/year: 1989 Beam Software/Mindscape

PSID; BASIC flag clear; 7 subtunes. Complete-file MD5: `f1d76075a9bc85b33a2ddbea5da3b526`; SHA-256: `680e8094d60c9451098356b068f1a32ff2701492b51f0f8ef85afc1f8651e935`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 8.051e-2; 11131 | ΔRMS 7.043e-2; writes 11131; prefix 1724; drift 56; derived | identical PCM; writes 11131; prefix 11131; drift 0; derived | ΔRMS 7.043e-2; writes 11131; prefix 1724; drift 56 |
| 2 | 2 | pcm-difference-with-similar-write-sequence | 6.344e-2; 2249 | ΔRMS 6.345e-3; writes 2249; prefix 2249; drift 56; derived | identical PCM; writes 2249; prefix 2249; drift 0; derived | ΔRMS 6.345e-3; writes 2249; prefix 2249; drift 56 |
| 3 | 2 | pcm-difference-with-similar-write-sequence | 5.100e-2; 2577 | ΔRMS 1.410e-3; writes 2577; prefix 2577; drift 13; derived | identical PCM; writes 2577; prefix 2577; drift 0; derived | ΔRMS 1.410e-3; writes 2577; prefix 2577; drift 13 |
| 4 | 10 | kernal-sensitive | 1.168e-1; 12580 | ΔRMS 9.871e-3; writes 12580; prefix 123; drift 11; derived | identical PCM; writes 12580; prefix 12580; drift 0; derived | ΔRMS 9.871e-3; writes 12580; prefix 123; drift 11 |
| 5 | 2 | pcm-difference-with-similar-write-sequence | 1.314e-1; 2577 | ΔRMS 3.644e-3; writes 2577; prefix 2577; drift 13; derived | identical PCM; writes 2577; prefix 2577; drift 0; derived | ΔRMS 3.644e-3; writes 2577; prefix 2577; drift 13 |
| 6 | 10 | kernal-sensitive | 7.962e-2; 11134 | ΔRMS 1.176e-2; writes 11134; prefix 1133; drift 56; derived | identical PCM; writes 11134; prefix 11134; drift 0; derived | ΔRMS 1.176e-2; writes 11134; prefix 1133; drift 56 |
| 7 | 2 | pcm-difference-with-similar-write-sequence | 5.461e-2; 2599 | ΔRMS 4.988e-3; writes 2599; prefix 2599; drift 13; derived | identical PCM; writes 2599; prefix 2599; drift 0; derived | ΔRMS 4.988e-3; writes 2599; prefix 2599; drift 13 |

STIL (full available entry and applicable directory notes):

> (#1)
>   TITLE: Waltzing Matilda
>  ARTIST: Marie Cowan (music), A.B. Paterson (lyrics)
> (#5)
>   TITLE: The Snowy Breasted Pearl
>  ARTIST: Traditional

## Baji

Path: `GAMES/A-F/Baji_BASIC.sid`

Author: Boris Kocjan · Release/year: 1986 Boris Kocjan

RSID; BASIC flag set; 2 subtunes. Complete-file MD5: `3c9384cc768ca534995cee4e602c258f`; SHA-256: `3884d5c29c5a70a799f81bfea370b0ac55d7c6a572d0ef2805e743496dd52ec4`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 5.986e-2; 213 | ΔRMS 5.982e-2; writes 1; prefix 1; drift 0 | ΔRMS 6.489e-2; writes 148; prefix 1; drift 0 | ΔRMS 5.982e-2; writes 1; prefix 1; drift 0 |
| 2 | 10 | both-sensitive | 3.376e-2; 138 | ΔRMS 3.559e-2; writes 1; prefix 1; drift 0 | ΔRMS 4.098e-2; writes 148; prefix 1; drift 0 | ΔRMS 2.796e-2; writes 138; prefix 138; drift 25374 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Ball Trap

Path: `GAMES/A-F/Ball_Trap_BASIC.sid`

Author: Dominique Roy · Release/year: 1984 Hebdogiciel

RSID; BASIC flag set; 2 subtunes. Complete-file MD5: `a53fbfc38847f73d41d1b3397830c36e`; SHA-256: `4235d1a8f91842323760562fc681cfaf30ca670fa12fef2ac2a8b99fd73c0ecc`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 4.365e-2; 309 | ΔRMS 4.360e-2; writes 1; prefix 1; drift 0 | ΔRMS 5.031e-2; writes 148; prefix 1; drift 0 | ΔRMS 4.360e-2; writes 1; prefix 1; drift 0 |
| 2 | 10 | both-sensitive | 8.163e-2; 238 | ΔRMS 8.555e-2; writes 1; prefix 1; drift 0 | ΔRMS 9.189e-2; writes 148; prefix 1; drift 0 | ΔRMS 8.555e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Ballonflug

Path: `GAMES/A-F/Ballonflug_BASIC.sid`

Author: &lt;?&gt; · Release/year: 1984 CPU/Roeske Verlag

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `726e8dd55d25982c1e38dd2e693792c9`; SHA-256: `7d2a8121a9b6c062b543c09640ee268c414a705bd3382196e29ac7e504f03ae0`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 4.991e-2; 225 | ΔRMS 4.986e-2; writes 1; prefix 1; drift 0 | ΔRMS 5.574e-2; writes 148; prefix 1; drift 0 | ΔRMS 4.986e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Balloonrace

Path: `GAMES/A-F/Balloonrace_BASIC.sid`

Author: &lt;?&gt; · Release/year: 1986 Robtek

RSID; BASIC flag set; 2 subtunes. Complete-file MD5: `7e7340337eac07ce0425e56fb94505b1`; SHA-256: `6d98a55caf229ed646f3f214a5b88a348f2a9e69949af180d30e1e1816cee6dc`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 1.043e-1; 138 | ΔRMS 1.044e-1; writes 1; prefix 1; drift 0 | ΔRMS 1.066e-1; writes 148; prefix 1; drift 0 | ΔRMS 1.044e-1; writes 1; prefix 1; drift 0 |
| 2 | 10 | insufficient-reference-activity | 5.347e-2; 60 | ΔRMS 5.411e-2; writes 1; prefix 1; drift 0 | ΔRMS 5.824e-2; writes 148; prefix 1; drift 0 | ΔRMS 7.635e-2; writes 60; prefix 60; drift 96671 |

STIL (full available entry and applicable directory notes):

> (#1)
>   TITLE: The Festival Overture: The Year 1812, Op. 49
>  ARTIST: Pyotr Ilyich Tchaikovsky

## Bank-Robber

Path: `GAMES/A-F/Bank-Robber_BASIC.sid`

Author: Bruno-Gert Kramm · Release/year: 1984 CHIP/Vogel-Verlag KG

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `7321692d37a8c67f866c172a7887717f`; SHA-256: `49beb795f430bbd5e68892b50ef70849718f523d6b0969eb5dd9dc0b151ab93a`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 2.372e-2; 177 | ΔRMS 2.366e-2; writes 1; prefix 1; drift 0 | ΔRMS 3.379e-2; writes 148; prefix 1; drift 0 | ΔRMS 2.366e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Barrier-System

Path: `GAMES/A-F/Barrier-System.sid`

Author: Norbert Pahlow &lt;?&gt; · Release/year: 1983 &lt;?&gt;

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `98bb45d6cbde98f4342559702a1cb037`; SHA-256: `697070416a3ff82d095e6b16a1b2aeb98dade31a28037e8384906519de460631`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 1.310e-1; 1041 | ΔRMS 4.773e-4; writes 1041; prefix 191; drift 11; derived | identical PCM; writes 1041; prefix 1041; drift 0; derived | ΔRMS 4.773e-4; writes 1041; prefix 191; drift 11 |

STIL (full available entry and applicable directory notes):

> TITLE: Minuet in A, Op. 41/G525 [from Minuets for Orchestra]
>  ARTIST: Luigi Boccherini

## Black Adder

Path: `GAMES/A-F/Black_Adder_BASIC.sid`

Author: Haagen R. Berg &amp; Mads A. Hansen · Release/year: 1985 HaMa Software

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `0d235c6a87483e59f84410b00ec5b353`; SHA-256: `cded3523d0cfc329c46dee7e2175bafebd6a4cb445014e74752e5b2ad1c9c814`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 5.646e-2; 68 | ΔRMS 5.788e-2; writes 1; prefix 1; drift 0 | ΔRMS 5.716e-2; writes 148; prefix 1; drift 0 | ΔRMS 5.788e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Blackadder [from the TV series]
>  ARTIST: Howard Goodall

## Blockbusters

Path: `GAMES/A-F/Blockbusters_1984.sid`

Author: &lt;?&gt; · Release/year: 1984 Macsen

RSID; BASIC flag clear; 2 subtunes. Complete-file MD5: `5a541987b40fb62c92afe54ac2d2c92c`; SHA-256: `b1227c16ded3d54682a36cd09e4054d765f6a5b6d9ba534340dfade67ced8586`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 2 | pcm-difference-with-similar-write-sequence | 6.652e-2; 91 | ΔRMS 6.261e-5; writes 91; prefix 91; drift 54; derived | identical PCM; writes 91; prefix 91; drift 0; derived | ΔRMS 6.261e-5; writes 91; prefix 91; drift 54 |
| 2 | 10 | kernal-sensitive | 5.216e-2; 459 | ΔRMS 2.907e-2; writes 464; prefix 459; drift 85259; derived | identical PCM; writes 459; prefix 459; drift 0; derived | ΔRMS 2.907e-2; writes 464; prefix 459; drift 85259 |

STIL (full available entry and applicable directory notes):

> (#1)
>   TITLE: Blockbusters [from the UK version of the TV series]
>  ARTIST: Ed Welch
> (#2)
>   TITLE: Blockbusters [from the UK version of the TV series]
>  ARTIST: Ed Welch

## The Blue and the Gray

Path: `GAMES/A-F/Blue_and_the_Gray_BASIC.sid`

Author: N.G. Edstrom · Release/year: 1984 Grana Software

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `212f6cad278d017658962bcbd8c05267`; SHA-256: `012e2bd4d8a71904a2166d8391b97c43d878d2fedd16dc2a6bca52a9b1cb4425`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 8.218e-2; 598 | ΔRMS 8.243e-2; writes 1; prefix 1; drift 0 | ΔRMS 8.409e-2; writes 148; prefix 1; drift 0 | ΔRMS 8.243e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Dixie Land
>  ARTIST: Daniel Emmett

## Boccia

Path: `GAMES/A-F/Boccia_BASIC.sid`

Author: Oliver Möller · Release/year: 1986 OM-Soft

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `250c54e09b976a5a740cf6f997c208d0`; SHA-256: `938659f3aa8a007ae07938644adb753da9794986b170cffd61c0f0d329382508`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 4.782e-2; 207 | ΔRMS 4.777e-2; writes 1; prefix 1; drift 0 | ΔRMS 5.393e-2; writes 148; prefix 1; drift 0 | ΔRMS 4.777e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Breaker

Path: `GAMES/A-F/Breaker.sid`

Author: Theo Hongens · Release/year: 1987 Radarsoft

PSID; BASIC flag clear; 14 subtunes. Complete-file MD5: `3dd246f0be83138986d2ce615cf21939`; SHA-256: `1975a680f8384b110818a0c987762cade8e7a594cd74c4e5e1a92e77c8eba36c`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 2 | pcm-difference-with-similar-write-sequence | 1.272e-1; 1770 | ΔRMS 5.243e-2; writes 1770; prefix 1770; drift 13; derived | identical PCM; writes 1770; prefix 1770; drift 0; derived | ΔRMS 5.243e-2; writes 1770; prefix 1770; drift 13 |
| 2 | 2 | pcm-difference-with-similar-write-sequence | 1.338e-1; 1748 | ΔRMS 3.917e-2; writes 1748; prefix 1748; drift 11; derived | identical PCM; writes 1748; prefix 1748; drift 0; derived | ΔRMS 3.917e-2; writes 1748; prefix 1748; drift 11 |
| 3 | 2 | pcm-difference-with-similar-write-sequence | 1.411e-1; 1808 | ΔRMS 3.092e-2; writes 1808; prefix 1808; drift 13; derived | identical PCM; writes 1808; prefix 1808; drift 0; derived | ΔRMS 3.092e-2; writes 1808; prefix 1808; drift 13 |
| 4 | 2 | pcm-difference-with-similar-write-sequence | 4.851e-2; 449 | ΔRMS 1.870e-3; writes 449; prefix 449; drift 11; derived | identical PCM; writes 449; prefix 449; drift 0; derived | ΔRMS 1.870e-3; writes 449; prefix 449; drift 11 |
| 5 | 2 | pcm-difference-with-similar-write-sequence | 4.864e-2; 449 | ΔRMS 2.585e-3; writes 449; prefix 449; drift 11; derived | identical PCM; writes 449; prefix 449; drift 0; derived | ΔRMS 2.585e-3; writes 449; prefix 449; drift 11 |
| 6 | 2 | pcm-difference-with-similar-write-sequence | 1.509e-1; 935 | ΔRMS 3.721e-2; writes 935; prefix 935; drift 13; derived | identical PCM; writes 935; prefix 935; drift 0; derived | ΔRMS 3.721e-2; writes 935; prefix 935; drift 13 |
| 7 | 10 | kernal-sensitive | 3.989e-2; 2239 | ΔRMS 3.526e-3; writes 2239; prefix 1; drift 0; derived | identical PCM; writes 2239; prefix 2239; drift 0; derived | ΔRMS 3.526e-3; writes 2239; prefix 1; drift 0 |
| 8 | 2 | pcm-difference-with-similar-write-sequence | 1.225e-1; 1421 | ΔRMS 5.840e-3; writes 1421; prefix 1421; drift 11; derived | identical PCM; writes 1421; prefix 1421; drift 0; derived | ΔRMS 5.840e-3; writes 1421; prefix 1421; drift 11 |
| 9 | 2 | pcm-difference-with-similar-write-sequence | 1.263e-1; 947 | ΔRMS 2.209e-2; writes 947; prefix 947; drift 12; derived | identical PCM; writes 947; prefix 947; drift 0; derived | ΔRMS 2.209e-2; writes 947; prefix 947; drift 12 |
| 10 | 2 | pcm-difference-with-similar-write-sequence | 1.553e-1; 1764 | ΔRMS 1.182e-2; writes 1764; prefix 1764; drift 13; derived | identical PCM; writes 1764; prefix 1764; drift 0; derived | ΔRMS 1.182e-2; writes 1764; prefix 1764; drift 13 |
| 11 | 2 | pcm-difference-with-similar-write-sequence | 5.867e-2; 389 | ΔRMS 3.267e-4; writes 389; prefix 389; drift 13; derived | identical PCM; writes 389; prefix 389; drift 0; derived | ΔRMS 3.267e-4; writes 389; prefix 389; drift 13 |
| 12 | 2 | pcm-difference-with-similar-write-sequence | 1.194e-1; 1766 | ΔRMS 2.292e-2; writes 1766; prefix 1766; drift 13; derived | identical PCM; writes 1766; prefix 1766; drift 0; derived | ΔRMS 2.292e-2; writes 1766; prefix 1766; drift 13 |
| 13 | 2 | pcm-difference-with-similar-write-sequence | 1.369e-1; 1593 | ΔRMS 2.293e-2; writes 1593; prefix 1593; drift 13; derived | identical PCM; writes 1593; prefix 1593; drift 0; derived | ΔRMS 2.293e-2; writes 1593; prefix 1593; drift 13 |
| 14 | 2 | pcm-difference-with-similar-write-sequence | 1.171e-1; 1677 | ΔRMS 2.121e-2; writes 1677; prefix 1677; drift 13; derived | identical PCM; writes 1677; prefix 1677; drift 0; derived | ΔRMS 2.121e-2; writes 1677; prefix 1677; drift 13 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Brick Out 64

Path: `GAMES/A-F/Brick_Out_64_BASIC.sid`

Author: P.J. Papassotiriou · Release/year: 1987 PIXEL/Compupress A.E.

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `7a84b25ebe348e7d7f750ee93c109311`; SHA-256: `99b7d572d5970a5e5019324f8986d41f05edba2f5ba8fe750558e8650612d19e`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 2.696e-2; 104 | ΔRMS 2.735e-2; writes 1; prefix 1; drift 0 | ΔRMS 3.647e-2; writes 148; prefix 1; drift 0 | ΔRMS 2.735e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Toccata [from Toccata and Fugue in D Minor (BWV 565)]
>  ARTIST: Johann Sebastian Bach

## Brickout

Path: `GAMES/A-F/Brickout_BASIC.sid`

Author: John Fedor · Release/year: 1987 RUN/IDG Communications

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `a1214130d2d0bc971fde1b6711c9c83e`; SHA-256: `873aa43d7843abde0d7e965d37ab1874a6379f40c3908d1a88c9e2f41ba072f4`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 4.687e-2; 386 | ΔRMS 4.679e-2; writes 1; prefix 1; drift 0 | ΔRMS 5.290e-2; writes 155; prefix 1; drift 0 | ΔRMS 4.679e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Brunhilde Loves Bruno

Path: `GAMES/A-F/Brunhilde_Loves_Bruno_BASIC.sid`

Author: Phillip I. Nelson · Release/year: 1984 COMPUTE! Publications

RSID; BASIC flag set; 4 subtunes. Complete-file MD5: `ebd01f0161437e020a0606e3e02ed115`; SHA-256: `5415fa11a87e6e8de50cdbd5230bd0c1a0ca462346c19195ad158d3ef0bb52f9`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 1.171e-1; 613 | ΔRMS 1.194e-1; writes 1; prefix 1; drift 0 | ΔRMS 1.239e-1; writes 155; prefix 1; drift 0 | ΔRMS 1.194e-1; writes 1; prefix 1; drift 0 |
| 2 | 10 | both-sensitive | 6.106e-2; 77 | ΔRMS 6.104e-2; writes 1; prefix 1; drift 0 | ΔRMS 6.561e-2; writes 155; prefix 1; drift 0 | ΔRMS 6.104e-2; writes 1; prefix 1; drift 0 |
| 3 | 10 | both-sensitive | 1.306e-1; 384 | ERROR: Illegal instruction $02 at address $bf54; writes 1; prefix 1; drift 0 | ΔRMS 1.319e-1; writes 155; prefix 1; drift 0 | ΔRMS 1.307e-1; writes 1; prefix 1; drift 0 |
| 4 | 10 | both-sensitive | 1.045e-1; 321 | ΔRMS 1.045e-1; writes 1; prefix 1; drift 0 | ΔRMS 1.070e-1; writes 155; prefix 1; drift 0 | ΔRMS 1.045e-1; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> (#1)
>   TITLE: Ride of the Valkyries
>  ARTIST: Richard Wagner
> (#3)
>   TITLE: Nyah nyah nyah nyah nyah nyah
>  ARTIST: &lt;?&gt;

## Bug

Path: `GAMES/A-F/Bug_BASIC.sid`

Author: James Hall · Release/year: 1985 Argus Press/64 Tape Comp.

RSID; BASIC flag set; 2 subtunes. Complete-file MD5: `740a5c2ab77482ae077bf983350a5c19`; SHA-256: `64dd924c980e22021024cddcdbd03bfbace9994d77d68f90a458875d07f6bb5d`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 3.177e-2; 97 | ΔRMS 3.178e-2; writes 1; prefix 1; drift 0 | ΔRMS 3.993e-2; writes 148; prefix 1; drift 0 | ΔRMS 3.178e-2; writes 1; prefix 1; drift 0 |
| 2 | 10 | both-sensitive | 4.945e-2; 75 | ΔRMS 5.001e-2; writes 1; prefix 1; drift 0 | ΔRMS 5.406e-2; writes 148; prefix 2; drift 276725 | ΔRMS 5.886e-2; writes 75; prefix 75; drift 114346 |

STIL (full available entry and applicable directory notes):

> (#1)
> COMMENT: Same as /DEMOS/Commodore/C_Prog_Ref_Guide_example_03_BASIC.sid,
>          played at faster speed.
> (#2)
>   TITLE: Funeral March [from Sonate No. 2 in B flat minor Op. 35]
>  ARTIST: Frédéric François Chopin

## C'est la vie!

Path: `GAMES/A-F/C_est_la_vie_BASIC.sid`

Author: Patrick Debaumarche · Release/year: 1985 Hebdogiciel

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `ae04a25fc5c6a406a9c6d8976303ca49`; SHA-256: `7a567b33366f571d3de2c476fe481886fce81c9aeb088b8cafff1da2e0b60b48`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 2.878e-2; 111 | ΔRMS 3.206e-2; writes 1; prefix 1; drift 0 | ΔRMS 3.667e-2; writes 148; prefix 1; drift 0 | ΔRMS 3.206e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: The Entertainer
>  ARTIST: Scott Joplin

## Candy Bandit

Path: `GAMES/A-F/Candy_Bandit_BASIC.sid`

Author: Chris Warling · Release/year: 1983 T&amp;F Software

RSID; BASIC flag set; 3 subtunes. Complete-file MD5: `2d3953d3a798fb0b693e82835a7f0f35`; SHA-256: `bdc7ae89c0cfbf67d108de030f1d810cdf184c53b5928a13f5907697ebfeda45`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 4.726e-2; 220 | ΔRMS 4.729e-2; writes 1; prefix 1; drift 0 | ΔRMS 5.286e-2; writes 148; prefix 1; drift 0 | ΔRMS 4.729e-2; writes 1; prefix 1; drift 0 |
| 2 | 10 | insufficient-reference-activity | 3.509e-2; 59 | ΔRMS 3.756e-2; writes 1; prefix 1; drift 0 | ΔRMS 3.942e-2; writes 148; prefix 1; drift 0 | ΔRMS 2.697e-2; writes 59; prefix 59; drift 30217 |
| 3 | 10 | insufficient-reference-activity | 3.517e-2; 58 | ERROR: Illegal instruction $02 at address $bf54; writes 1; prefix 1; drift 0 | ΔRMS 4.105e-2; writes 148; prefix 1; drift 0 | ΔRMS 4.079e-2; writes 58; prefix 58; drift 65472 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Caveman Ugh-Lympics

Path: `GAMES/A-F/Caveman_Ugh-Lympics.sid`

Author: Alan McKean &amp; Bryce Morsello · Release/year: 1988 Dynamix/Electronic Arts

PSID; BASIC flag clear; 63 subtunes. Complete-file MD5: `95f50a16ac220ceb44620cc7947e095d`; SHA-256: `1bcefe298bc9c3e7b066c4df774b5f3c36cac79c99b6713133782c6e6bd070b5`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 2 | pcm-difference-with-similar-write-sequence | 1.023e-1; 2575 | ΔRMS 1.383e-2; writes 2575; prefix 2575; drift 13; derived | identical PCM; writes 2575; prefix 2575; drift 0; derived | ΔRMS 1.383e-2; writes 2575; prefix 2575; drift 13 |
| 2 | 2 | pcm-difference-with-similar-write-sequence | 1.227e-1; 2575 | ΔRMS 1.138e-2; writes 2575; prefix 2575; drift 13; derived | identical PCM; writes 2575; prefix 2575; drift 0; derived | ΔRMS 1.138e-2; writes 2575; prefix 2575; drift 13 |
| 3 | 2 | pcm-difference-with-similar-write-sequence | 4.535e-2; 2581 | ΔRMS 6.078e-3; writes 2581; prefix 2581; drift 13; derived | identical PCM; writes 2581; prefix 2581; drift 0; derived | ΔRMS 6.078e-3; writes 2581; prefix 2581; drift 13 |
| 4 | 2 | pcm-difference-with-similar-write-sequence | 7.250e-2; 2581 | ΔRMS 7.297e-3; writes 2581; prefix 2581; drift 13; derived | identical PCM; writes 2581; prefix 2581; drift 0; derived | ΔRMS 7.297e-3; writes 2581; prefix 2581; drift 13 |
| 5 | 2 | pcm-difference-with-similar-write-sequence | 1.108e-1; 1776 | ΔRMS 1.283e-2; writes 1776; prefix 1776; drift 55; derived | identical PCM; writes 1776; prefix 1776; drift 0; derived | ΔRMS 1.283e-2; writes 1776; prefix 1776; drift 55 |
| 6 | 2 | pcm-difference-with-similar-write-sequence | 9.844e-2; 2581 | ΔRMS 2.919e-2; writes 2581; prefix 2581; drift 13; derived | identical PCM; writes 2581; prefix 2581; drift 0; derived | ΔRMS 2.919e-2; writes 2581; prefix 2581; drift 13 |
| 7 | 2 | pcm-difference-with-similar-write-sequence | 7.297e-2; 2581 | ΔRMS 5.987e-5; writes 2581; prefix 2581; drift 13; derived | identical PCM; writes 2581; prefix 2581; drift 0; derived | ΔRMS 5.987e-5; writes 2581; prefix 2581; drift 13 |
| 8 | 2 | pcm-difference-with-similar-write-sequence | 7.112e-2; 2581 | ΔRMS 5.972e-4; writes 2581; prefix 2581; drift 13; derived | identical PCM; writes 2581; prefix 2581; drift 0; derived | ΔRMS 5.972e-4; writes 2581; prefix 2581; drift 13 |
| 9 | 2 | pcm-difference-with-similar-write-sequence | 7.262e-2; 2581 | ΔRMS 6.553e-4; writes 2581; prefix 2581; drift 14; derived | identical PCM; writes 2581; prefix 2581; drift 0; derived | ΔRMS 6.553e-4; writes 2581; prefix 2581; drift 14 |
| 10 | 2 | pcm-difference-with-similar-write-sequence | 5.985e-2; 2581 | ΔRMS 2.057e-2; writes 2581; prefix 2581; drift 13; derived | identical PCM; writes 2581; prefix 2581; drift 0; derived | ΔRMS 2.057e-2; writes 2581; prefix 2581; drift 13 |
| 11 | 2 | pcm-difference-with-similar-write-sequence | 7.153e-2; 2581 | ΔRMS 1.262e-3; writes 2581; prefix 2581; drift 13; derived | identical PCM; writes 2581; prefix 2581; drift 0; derived | ΔRMS 1.262e-3; writes 2581; prefix 2581; drift 13 |
| 12 | 2 | pcm-difference-with-similar-write-sequence | 4.690e-2; 1095 | ΔRMS 2.091e-2; writes 1095; prefix 1095; drift 54; derived | identical PCM; writes 1095; prefix 1095; drift 0; derived | ΔRMS 2.091e-2; writes 1095; prefix 1095; drift 54 |
| 13 | 2 | pcm-difference-with-similar-write-sequence | 3.003e-2; 1231 | ΔRMS 2.449e-2; writes 1231; prefix 1231; drift 13; derived | identical PCM; writes 1231; prefix 1231; drift 0; derived | ΔRMS 2.449e-2; writes 1231; prefix 1231; drift 13 |
| 14 | 2 | pcm-difference-with-similar-write-sequence | 1.104e-1; 1168 | ΔRMS 2.142e-3; writes 1168; prefix 1168; drift 55; derived | identical PCM; writes 1168; prefix 1168; drift 0; derived | ΔRMS 2.142e-3; writes 1168; prefix 1168; drift 55 |
| 15 | 2 | pcm-difference-with-similar-write-sequence | 2.441e-2; 803 | ΔRMS 8.060e-3; writes 803; prefix 803; drift 13; derived | identical PCM; writes 803; prefix 803; drift 0; derived | ΔRMS 8.060e-3; writes 803; prefix 803; drift 13 |
| 16 | 2 | pcm-difference-with-similar-write-sequence | 1.047e-2; 181 | ΔRMS 1.789e-5; writes 181; prefix 181; drift 13; derived | identical PCM; writes 181; prefix 181; drift 0; derived | ΔRMS 1.789e-5; writes 181; prefix 181; drift 13 |
| 17 | 2 | pcm-difference-with-similar-write-sequence | 1.108e-2; 286 | ΔRMS 1.929e-5; writes 286; prefix 286; drift 13; derived | identical PCM; writes 286; prefix 286; drift 0; derived | ΔRMS 1.929e-5; writes 286; prefix 286; drift 13 |
| 18 | 2 | pcm-difference-with-similar-write-sequence | 1.732e-2; 202 | ΔRMS 1.775e-4; writes 202; prefix 202; drift 17; derived | identical PCM; writes 202; prefix 202; drift 0; derived | ΔRMS 1.775e-4; writes 202; prefix 202; drift 17 |
| 19 | 2 | pcm-difference-with-similar-write-sequence | 1.587e-2; 279 | ΔRMS 1.894e-5; writes 279; prefix 279; drift 20; derived | identical PCM; writes 279; prefix 279; drift 0; derived | ΔRMS 1.894e-5; writes 279; prefix 279; drift 20 |
| 20 | 10 | kernal-sensitive | 1.244e-2; 791 | ΔRMS 1.588e-2; writes 792; prefix 791; drift 17107; derived | identical PCM; writes 791; prefix 791; drift 0; derived | ΔRMS 1.588e-2; writes 792; prefix 791; drift 17107 |
| 21 | 2 | pcm-difference-with-similar-write-sequence | 3.433e-2; 390 | ΔRMS 3.291e-4; writes 390; prefix 390; drift 12; derived | identical PCM; writes 390; prefix 390; drift 0; derived | ΔRMS 3.291e-4; writes 390; prefix 390; drift 12 |
| 22 | 2 | pcm-difference-with-similar-write-sequence | 3.048e-2; 369 | ΔRMS 8.259e-3; writes 369; prefix 369; drift 13; derived | identical PCM; writes 369; prefix 369; drift 0; derived | ΔRMS 8.259e-3; writes 369; prefix 369; drift 13 |
| 23 | 2 | pcm-difference-with-similar-write-sequence | 3.935e-2; 971 | ΔRMS 1.288e-3; writes 971; prefix 971; drift 13; derived | identical PCM; writes 971; prefix 971; drift 0; derived | ΔRMS 1.288e-3; writes 971; prefix 971; drift 13 |
| 24 | 2 | pcm-difference-with-similar-write-sequence | 2.629e-2; 313 | ΔRMS 1.356e-5; writes 313; prefix 313; drift 13; derived | identical PCM; writes 313; prefix 313; drift 0; derived | ΔRMS 1.356e-5; writes 313; prefix 313; drift 13 |
| 25 | 2 | pcm-difference-with-similar-write-sequence | 1.263e-2; 222 | ΔRMS 1.850e-4; writes 222; prefix 222; drift 13; derived | identical PCM; writes 222; prefix 222; drift 0; derived | ΔRMS 1.850e-4; writes 222; prefix 222; drift 13 |
| 26 | 2 | pcm-difference-with-similar-write-sequence | 5.205e-2; 796 | ΔRMS 2.533e-2; writes 796; prefix 796; drift 13; derived | identical PCM; writes 796; prefix 796; drift 0; derived | ΔRMS 2.533e-2; writes 796; prefix 796; drift 13 |
| 27 | 2 | pcm-difference-with-similar-write-sequence | 2.323e-2; 575 | ΔRMS 1.028e-4; writes 575; prefix 575; drift 12; derived | identical PCM; writes 575; prefix 575; drift 0; derived | ΔRMS 1.028e-4; writes 575; prefix 575; drift 12 |
| 28 | 2 | pcm-difference-with-similar-write-sequence | 3.325e-2; 971 | ΔRMS 1.903e-5; writes 971; prefix 971; drift 13; derived | identical PCM; writes 971; prefix 971; drift 0; derived | ΔRMS 1.903e-5; writes 971; prefix 971; drift 13 |
| 29 | 2 | pcm-difference-with-similar-write-sequence | 3.045e-2; 327 | ΔRMS 1.879e-3; writes 327; prefix 327; drift 13; derived | identical PCM; writes 327; prefix 327; drift 0; derived | ΔRMS 1.879e-3; writes 327; prefix 327; drift 13 |
| 30 | 2 | pcm-difference-with-similar-write-sequence | 5.138e-2; 782 | ΔRMS 4.664e-4; writes 782; prefix 782; drift 13; derived | identical PCM; writes 782; prefix 782; drift 0; derived | ΔRMS 4.664e-4; writes 782; prefix 782; drift 13 |
| 31 | 2 | pcm-difference-with-similar-write-sequence | 3.570e-2; 572 | ΔRMS 9.321e-5; writes 572; prefix 572; drift 13; derived | identical PCM; writes 572; prefix 572; drift 0; derived | ΔRMS 9.321e-5; writes 572; prefix 572; drift 13 |
| 32 | 2 | pcm-difference-with-similar-write-sequence | 2.041e-2; 502 | ΔRMS 7.995e-4; writes 502; prefix 502; drift 13; derived | identical PCM; writes 502; prefix 502; drift 0; derived | ΔRMS 7.995e-4; writes 502; prefix 502; drift 13 |
| 33 | 2 | pcm-difference-with-similar-write-sequence | 8.936e-3; 292 | ΔRMS 3.662e-5; writes 292; prefix 292; drift 13; derived | identical PCM; writes 292; prefix 292; drift 0; derived | ΔRMS 3.662e-5; writes 292; prefix 292; drift 13 |
| 34 | 2 | pcm-difference-with-similar-write-sequence | 3.782e-2; 971 | ΔRMS 3.474e-3; writes 971; prefix 971; drift 13; derived | identical PCM; writes 971; prefix 971; drift 0; derived | ΔRMS 3.474e-3; writes 971; prefix 971; drift 13 |
| 35 | 2 | pcm-difference-with-similar-write-sequence | 1.495e-2; 929 | ΔRMS 1.346e-5; writes 929; prefix 929; drift 13; derived | identical PCM; writes 929; prefix 929; drift 0; derived | ΔRMS 1.346e-5; writes 929; prefix 929; drift 13 |
| 36 | 2 | pcm-difference-with-similar-write-sequence | 1.476e-2; 180 | ΔRMS 1.166e-5; writes 180; prefix 180; drift 12; derived | identical PCM; writes 180; prefix 180; drift 0; derived | ΔRMS 1.166e-5; writes 180; prefix 180; drift 12 |
| 37 | 2 | pcm-difference-with-similar-write-sequence | 3.789e-2; 502 | ΔRMS 3.021e-5; writes 502; prefix 502; drift 13; derived | identical PCM; writes 502; prefix 502; drift 0; derived | ΔRMS 3.021e-5; writes 502; prefix 502; drift 13 |
| 38 | 2 | pcm-difference-with-similar-write-sequence | 2.864e-2; 390 | ΔRMS 3.629e-5; writes 390; prefix 390; drift 13; derived | identical PCM; writes 390; prefix 390; drift 0; derived | ΔRMS 3.629e-5; writes 390; prefix 390; drift 13 |
| 39 | 2 | pcm-difference-with-similar-write-sequence | 2.059e-2; 166 | ΔRMS 2.068e-5; writes 166; prefix 166; drift 12; derived | identical PCM; writes 166; prefix 166; drift 0; derived | ΔRMS 2.068e-5; writes 166; prefix 166; drift 12 |
| 40 | 2 | pcm-difference-with-similar-write-sequence | 2.249e-2; 315 | ΔRMS 8.961e-3; writes 315; prefix 315; drift 12; derived | identical PCM; writes 315; prefix 315; drift 0; derived | ΔRMS 8.961e-3; writes 315; prefix 315; drift 12 |
| 41 | 2 | pcm-difference-with-similar-write-sequence | 1.157e-2; 196 | ΔRMS 1.917e-5; writes 196; prefix 196; drift 12; derived | identical PCM; writes 196; prefix 196; drift 0; derived | ΔRMS 1.917e-5; writes 196; prefix 196; drift 12 |
| 42 | 2 | pcm-difference-with-similar-write-sequence | 2.162e-2; 210 | ΔRMS 8.244e-4; writes 210; prefix 210; drift 14; derived | identical PCM; writes 210; prefix 210; drift 0; derived | ΔRMS 8.244e-4; writes 210; prefix 210; drift 14 |
| 43 | 2 | pcm-difference-with-similar-write-sequence | 2.043e-2; 428 | ΔRMS 8.748e-4; writes 428; prefix 428; drift 55; derived | identical PCM; writes 428; prefix 428; drift 0; derived | ΔRMS 8.748e-4; writes 428; prefix 428; drift 55 |
| 44 | 2 | pcm-difference-with-similar-write-sequence | 2.790e-2; 301 | ΔRMS 2.386e-2; writes 301; prefix 301; drift 13; derived | identical PCM; writes 301; prefix 301; drift 0; derived | ΔRMS 2.386e-2; writes 301; prefix 301; drift 13 |
| 45 | 2 | pcm-difference-with-similar-write-sequence | 1.357e-2; 567 | ΔRMS 5.876e-3; writes 567; prefix 567; drift 21; derived | identical PCM; writes 567; prefix 567; drift 0; derived | ΔRMS 5.876e-3; writes 567; prefix 567; drift 21 |
| 46 | 10 | kernal-sensitive | 1.033e-2; 694 | ΔRMS 9.382e-3; writes 695; prefix 694; drift 17107; derived | identical PCM; writes 694; prefix 694; drift 0; derived | ΔRMS 9.382e-3; writes 695; prefix 694; drift 17107 |
| 47 | 2 | pcm-difference-with-similar-write-sequence | 3.577e-2; 567 | ΔRMS 7.901e-5; writes 567; prefix 567; drift 13; derived | identical PCM; writes 567; prefix 567; drift 0; derived | ΔRMS 7.901e-5; writes 567; prefix 567; drift 13 |
| 48 | 2 | pcm-difference-with-similar-write-sequence | 5.178e-2; 706 | ΔRMS 1.520e-2; writes 706; prefix 706; drift 12; derived | identical PCM; writes 706; prefix 706; drift 0; derived | ΔRMS 1.520e-2; writes 706; prefix 706; drift 12 |
| 49 | 2 | pcm-difference-with-similar-write-sequence | 2.227e-2; 224 | ΔRMS 1.614e-5; writes 224; prefix 224; drift 52; derived | identical PCM; writes 224; prefix 224; drift 0; derived | ΔRMS 1.614e-5; writes 224; prefix 224; drift 52 |
| 50 | 2 | pcm-difference-with-similar-write-sequence | 4.714e-2; 567 | ΔRMS 6.321e-3; writes 567; prefix 567; drift 13; derived | identical PCM; writes 567; prefix 567; drift 0; derived | ΔRMS 6.321e-3; writes 567; prefix 567; drift 13 |
| 51 | 2 | pcm-difference-with-similar-write-sequence | 6.623e-2; 2575 | ΔRMS 2.244e-2; writes 2575; prefix 2575; drift 12; derived | identical PCM; writes 2575; prefix 2575; drift 0; derived | ΔRMS 2.244e-2; writes 2575; prefix 2575; drift 12 |
| 52 | 2 | pcm-difference-with-similar-write-sequence | 2.320e-2; 575 | ΔRMS 1.027e-4; writes 575; prefix 575; drift 13; derived | identical PCM; writes 575; prefix 575; drift 0; derived | ΔRMS 1.027e-4; writes 575; prefix 575; drift 13 |
| 53 | 2 | pcm-difference-with-similar-write-sequence | 7.806e-2; 2575 | ΔRMS 1.126e-2; writes 2575; prefix 2575; drift 13; derived | identical PCM; writes 2575; prefix 2575; drift 0; derived | ΔRMS 1.126e-2; writes 2575; prefix 2575; drift 13 |
| 54 | 2 | pcm-difference-with-similar-write-sequence | 1.490e-2; 175 | ΔRMS 9.079e-6; writes 175; prefix 175; drift 13; derived | identical PCM; writes 175; prefix 175; drift 0; derived | ΔRMS 9.079e-6; writes 175; prefix 175; drift 13 |
| 55 | 2 | pcm-difference-with-similar-write-sequence | 1.932e-2; 217 | ΔRMS 2.591e-3; writes 217; prefix 217; drift 14; derived | identical PCM; writes 217; prefix 217; drift 0; derived | ΔRMS 2.591e-3; writes 217; prefix 217; drift 14 |
| 56 | 2 | pcm-difference-with-similar-write-sequence | 1.979e-2; 384 | ΔRMS 4.618e-4; writes 384; prefix 384; drift 13; derived | identical PCM; writes 384; prefix 384; drift 0; derived | ΔRMS 4.618e-4; writes 384; prefix 384; drift 13 |
| 57 | 2 | pcm-difference-with-similar-write-sequence | 2.653e-2; 539 | ΔRMS 4.700e-3; writes 539; prefix 539; drift 13; derived | identical PCM; writes 539; prefix 539; drift 0; derived | ΔRMS 4.700e-3; writes 539; prefix 539; drift 13 |
| 58 | 2 | pcm-difference-with-similar-write-sequence | 2.568e-2; 1174 | ΔRMS 4.496e-3; writes 1174; prefix 1174; drift 12; derived | identical PCM; writes 1174; prefix 1174; drift 0; derived | ΔRMS 4.496e-3; writes 1174; prefix 1174; drift 12 |
| 59 | 2 | pcm-difference-with-similar-write-sequence | 1.115e-2; 196 | ΔRMS 1.173e-5; writes 196; prefix 196; drift 13; derived | identical PCM; writes 196; prefix 196; drift 0; derived | ΔRMS 1.173e-5; writes 196; prefix 196; drift 13 |
| 60 | 2 | pcm-difference-with-similar-write-sequence | 1.073e-2; 196 | ΔRMS 7.841e-3; writes 196; prefix 196; drift 13; derived | identical PCM; writes 196; prefix 196; drift 0; derived | ΔRMS 7.841e-3; writes 196; prefix 196; drift 13 |
| 61 | 2 | pcm-difference-with-similar-write-sequence | 2.157e-2; 224 | ΔRMS 1.693e-5; writes 224; prefix 224; drift 12; derived | identical PCM; writes 224; prefix 224; drift 0; derived | ΔRMS 1.693e-5; writes 224; prefix 224; drift 12 |
| 62 | 2 | pcm-difference-with-similar-write-sequence | 1.950e-2; 637 | ΔRMS 1.767e-2; writes 637; prefix 637; drift 13; derived | identical PCM; writes 637; prefix 637; drift 0; derived | ΔRMS 1.767e-2; writes 637; prefix 637; drift 13 |
| 63 | 2 | pcm-difference-with-similar-write-sequence | 2.227e-2; 224 | ΔRMS 1.010e-5; writes 224; prefix 224; drift 13; derived | identical PCM; writes 224; prefix 224; drift 0; derived | ΔRMS 1.010e-5; writes 224; prefix 224; drift 13 |

STIL (full available entry and applicable directory notes):

> COMMENT: Some of the subtunes are intentionally out of the tune. This is to be
>          in line with the prehistoric nature of the game.
> (#1)
>   TITLE: Bugler's Dream (0:31)
>  ARTIST: Leo Arnaud
> (#2)
>   TITLE: Bugler's Dream
>  ARTIST: Leo Arnaud

## Chain-Reaction

Path: `GAMES/A-F/Chain-Reaction_BASIC.sid`

Author: &lt;?&gt; · Release/year: 1987 ACW Software

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `dee0e90b9c9658f2d15e4115d71353b2`; SHA-256: `e447e681047204bf4927893049ef9372f526bdb894e8434daaf838959d0038f7`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 3.202e-2; 173 | ΔRMS 3.351e-2; writes 1; prefix 1; drift 0 | ΔRMS 4.416e-2; writes 148; prefix 1; drift 0 | ΔRMS 3.351e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> No STIL entry or applicable directory note in this release.

## Charlie and the Jugs

Path: `GAMES/A-F/Charlie_and_the_Jugs_BASIC.sid`

Author: Michael Solomon · Release/year: 1985 Your Computer

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `09dcaf7f424d083afbd37c285e500898`; SHA-256: `fb76b3d85f2af1d917dbcd387639b004f6d2d783e5b52008d1aba11d8821b392`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 1.185e-1; 238 | ΔRMS 1.185e-1; writes 1; prefix 1; drift 0 | ΔRMS 1.212e-1; writes 148; prefix 1; drift 0 | ΔRMS 1.185e-1; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: The Entertainer
>  ARTIST: Scott Joplin

## Chenille

Path: `GAMES/A-F/Chenille.sid`

Author: Thierry Olivier · Release/year: 1985 Hebdogiciel

RSID; BASIC flag clear; 1 subtunes. Complete-file MD5: `49ad50524b8d207cee7c6adda1ab885f`; SHA-256: `276769d0ae223fc52c9a9a1e4a74380f3ad324c10d8b3ef5d04c16b4603b6b5b`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | kernal-sensitive | 8.424e-2; 271 | ΔRMS 1.009e-1; writes 19; prefix 19; drift 0; derived | identical PCM; writes 271; prefix 271; drift 0; derived | ΔRMS 1.009e-1; writes 19; prefix 19; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: Swing Low, Sweet Chariot
>  ARTIST: Traditional
> COMMENT: Covers /MUSICIANS/V/Vogel_James/Swing_Low_Sweet_Chariot_BASIC.sid

## Christmas Eve

Path: `GAMES/A-F/Christmas_Eve_1983_BASIC.sid`

Author: David A. Ponting · Release/year: 1983 Pan Books/P.C.News

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `d2b23e4c5d9b8ea2257468d61bdc1934`; SHA-256: `3767d68bcf08d3595e511699560e7a99fe6ba9e0be18772ab020e2090071975c`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 7.521e-2; 329 | ΔRMS 7.518e-2; writes 1; prefix 1; drift 0 | ΔRMS 7.931e-2; writes 148; prefix 1; drift 0 | ΔRMS 7.518e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: One Horse Open Sleigh (0:00)
>  ARTIST: James Lord Pierpont
> COMMENT: Winter song commonly referred to as Christmas song "Jingle Bells".
>   TITLE: Rudolph The Red Nosed Reindeer (0:11)
>  ARTIST: Johnny Marks

## Christmas Eve

Path: `GAMES/A-F/Christmas_Eve_1986_BASIC.sid`

Author: Sandy Munro · Release/year: 1986 Commodore User

RSID; BASIC flag set; 1 subtunes. Complete-file MD5: `58a7b495004775d813ca1cf35803dc99`; SHA-256: `442073d89ab5264a80a33042ca39a47f12e3297c75c9faacc96b1ea02996694f`.

| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |
|---:|---:|---|---|---|---|---|
| 1 | 10 | both-sensitive | 6.238e-2; 143 | ΔRMS 9.722e-2; writes 1; prefix 1; drift 0 | ΔRMS 9.303e-2; writes 148; prefix 1; drift 0 | ΔRMS 9.722e-2; writes 1; prefix 1; drift 0 |

STIL (full available entry and applicable directory notes):

> TITLE: We Wish You a Merry Christmas
>  ARTIST: Traditional
> COMMENT: English carol.
