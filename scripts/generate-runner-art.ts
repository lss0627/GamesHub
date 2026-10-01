import { mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const wrap = (w: number, h: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><title>GamerHub original forest runner artwork</title>${body}</svg>`;
const art = {
  cat: wrap(
    256,
    256,
    `<defs><linearGradient id="fur" x2="0.8" y2="1"><stop stop-color="#ffcf79"/><stop offset="1" stop-color="#ef8f49"/></linearGradient></defs><path d="M60 180Q10 170 23 131Q33 112 46 127Q32 154 72 153" fill="none" stroke="#cf7138" stroke-width="23" stroke-linecap="round"/><ellipse cx="125" cy="178" rx="70" ry="55" fill="url(#fur)" stroke="#9d5538" stroke-width="5"/><path d="M88 218v12h28v-22m36 5v17h28v-24" fill="#f9c37a" stroke="#9d5538" stroke-width="5" stroke-linejoin="round"/><path d="M88 91L84 22l54 29 35-27 19 72" fill="#f5a25c" stroke="#9d5538" stroke-width="5" stroke-linejoin="round"/><path d="M98 40l4 40 20-24m48-12l-18 26 29 9" fill="#ed9294"/><ellipse cx="145" cy="108" rx="71" ry="63" fill="url(#fur)" stroke="#9d5538" stroke-width="5"/><path d="M130 49l9 19 8-20m16 3l-1 15" fill="none" stroke="#d6783c" stroke-width="9" stroke-linecap="round"/><ellipse cx="174" cy="129" rx="32" ry="25" fill="#ffebc6"/><ellipse cx="131" cy="99" rx="7" ry="12" fill="#44352c"/><ellipse cx="186" cy="99" rx="7" ry="12" fill="#44352c"/><circle cx="133" cy="95" r="2.5" fill="white"/><circle cx="188" cy="95" r="2.5" fill="white"/><path d="M159 118h15l-8 8z" fill="#b15c52"/><path d="M166 125v9m0-1q-9 10-16 0m16 0q9 10 16 0" fill="none" stroke="#794d3d" stroke-width="3" stroke-linecap="round"/><path d="M92 120l-22-4m22 14l-24 5m133-14l22-4m-21 14l24 5" stroke="#794d3d" stroke-width="3" stroke-linecap="round"/><path d="M87 158q56 26 101-1" fill="none" stroke="#49998b" stroke-width="14"/><path d="M167 164l32 29-29 3-12-32" fill="#49998b"/><ellipse cx="119" cy="191" rx="25" ry="20" fill="#ffdf9f"/>`,
  ),
  coin: wrap(
    128,
    128,
    `<defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#fff7af"/><stop offset="1" stop-color="#f4af36"/></linearGradient></defs><circle cx="66" cy="67" r="52" fill="#b57b26"/><circle cx="62" cy="60" r="51" fill="url(#g)" stroke="#eab144" stroke-width="5"/><circle cx="62" cy="60" r="39" fill="none" stroke="#fff0a1" stroke-width="4"/><path d="M62 29l9 20 23 3-17 15 4 24-19-12-20 12 4-24-17-15 24-3z" fill="#d79329"/><path d="M20 15v16m-8-8h16m80 72v20m-10-10h20" stroke="#fff4be" stroke-width="4" stroke-linecap="round"/>`,
  ),
  stump: wrap(
    256,
    256,
    `<path d="M59 62l-9 141-25 22h70l20-20 9 20h100l-25-29-9-134z" fill="#a76d4c" stroke="#674e3b" stroke-width="6" stroke-linejoin="round"/><path d="M77 100l-4 93m27-86l-3 42m45-42v92m28-94l9 64m-79 5l-8 31" stroke="#744f3c" stroke-width="10" stroke-linecap="round"/><ellipse cx="123" cy="65" rx="72" ry="33" fill="#e8bc82" stroke="#674e3b" stroke-width="6"/><ellipse cx="123" cy="65" rx="48" ry="21" fill="none" stroke="#bd8e61" stroke-width="4"/><ellipse cx="123" cy="65" rx="23" ry="10" fill="none" stroke="#bd8e61" stroke-width="4"/><path d="M38 206q10-40 20-6l6-22 12 34m93 0q13-32 20-11l10-30 7 39" fill="#6b9255"/><circle cx="48" cy="185" r="9" fill="#d18763"/><circle cx="185" cy="144" r="8" fill="#d18763"/>`,
  ),
  forest: wrap(
    1600,
    1000,
    `<defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="#c8e6df"/><stop offset=".75" stop-color="#f7efd7"/></linearGradient><linearGradient id="earth" x2="0" y2="1"><stop stop-color="#bd916d"/><stop offset="1" stop-color="#82664f"/></linearGradient></defs><path fill="url(#sky)" d="M0 0h1600v1000H0z"/><circle cx="1180" cy="195" r="88" fill="#fff7cd"/><g fill="#f5f6e8" opacity=".8"><ellipse cx="235" cy="192" rx="134" ry="30"/><ellipse cx="290" cy="170" rx="76" ry="45"/><ellipse cx="795" cy="122" rx="112" ry="24"/><ellipse cx="751" cy="105" rx="60" ry="35"/></g><path d="M0 580Q190 260 420 520Q730 170 1000 515Q1240 260 1600 480V900H0" fill="#a6cabe"/><path d="M0 659Q280 400 590 629Q860 394 1160 607Q1390 431 1600 594V900H0" fill="#82aea0"/><g fill="#619589" opacity=".75">${[80, 240, 420, 660, 950, 1210, 1460, 1570].map((x, i) => `<path d="M${x} ${380 + (i % 3) * 40}l-90 180h48l-74 114h235l-78-114h50z"/>`).join('')}</g><g fill="#477b69"><path d="M0 70q120 28 146 171q83 60 18 138q-76 83-164 39z"/><path d="M1600 32q-126 80-130 199q-104 69-70 141q70 78 200 8z"/></g><path d="M0 701Q430 674 810 706Q1200 667 1600 700V1000H0" fill="#658852"/><path d="M0 745h1600v255H0" fill="url(#earth)"/><path d="M0 717q300-16 580 0t540 0 480 0v33q-80 20-140 0t-150 0-140 0-150 0-150 0-150 0-150 0-150 0-150 0-170 0z" fill="#91ad67"/><g fill="#d1ae83" opacity=".5">${[80, 260, 430, 700, 980, 1100, 1360, 1500].map((x, i) => `<ellipse cx="${x}" cy="${805 + (i % 3) * 53}" rx="${9 + (i % 3) * 5}" ry="6"/>`).join('')}</g><g stroke="#bad284" stroke-width="5" stroke-linecap="round">${[32, 182, 333, 470, 635, 800, 991, 1182, 1320, 1520].map((x) => `<path d="M${x} 716l-7-14m7 14l9-18"/>`).join('')}</g><g fill="#f5d5a0"><circle cx="333" cy="694" r="5"/><circle cx="1182" cy="694" r="5"/></g>`,
  ),
};
async function main() {
  for (const path of [
    'assets/runner-art',
    'apps/studio-web/public/runner-art',
    'unity/Templates/Runner/Assets/Resources/Art',
  ])
    await mkdir(path, { recursive: true });
  for (const [name, svg] of Object.entries(art)) {
    await writeFile(`assets/runner-art/${name}.svg`, svg);
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    await writeFile(`apps/studio-web/public/runner-art/${name}.png`, png);
    await writeFile(
      `unity/Templates/Runner/Assets/Resources/Art/${name}.png`,
      png,
    );
  }
  console.log('Generated original Runner art for both the studio and Unity.');
}
void main();
