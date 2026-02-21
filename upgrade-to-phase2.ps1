<# 
upgrade-to-phase2.ps1
Upgrades renderer to full deterministic multi-asset engine.
#>

$RootPath = "D:\Websites\iommarket\brand-renderer"
$SrcPath = "$RootPath\src"

Write-Host "`n=== Upgrading to Phase 2 Engine ===" -ForegroundColor Cyan

if (!(Test-Path $RootPath)) {
    Write-Host "brand-renderer folder not found." -ForegroundColor Red
    exit 1
}

# ----------------------------
# FULL ENGINE RENDERER
# ----------------------------
@'
import fs from "fs";
import path from "path";
import sharp from "sharp";
import archiver from "archiver";

const ROOT = process.cwd();
const INPUT = path.join(ROOT,"input");
const OUTPUT = path.join(ROOT,"output");

const WEB_SIZES=[256,512,1024,2048];
const APP_SIZES=[16,32,48,64,128,256,512,1024];
const BACKGROUNDS=["transparent","vignette"];

function ensure(p){fs.mkdirSync(p,{recursive:true});}

function readSpec(){
  return JSON.parse(fs.readFileSync(path.join(INPUT,"brand.json"),"utf8"));
}

function vortexSVG(size,variant="core"){
  const cx=size/2;
  const cy=size/2;
  const rx=size*0.46;
  const ry=size*0.34;

  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="glowRed"><feGaussianBlur stdDeviation="40"/></filter>
    <filter id="glowBlue"><feGaussianBlur stdDeviation="40"/></filter>
  </defs>

  <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"
    fill="none" stroke="#157BCA" stroke-width="${ry*0.3}"
    filter="url(#glowBlue)" />

  <ellipse cx="${cx}" cy="${cy}" rx="${rx*0.72}" ry="${ry*0.72}"
    fill="none" stroke="#EFF0F3" stroke-width="${ry*0.28}" />

  <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"
    fill="none" stroke="#E22229" stroke-width="${ry*0.3}"
    filter="url(#glowRed)" />
</svg>`;
}

function logoSVG(bg){
  const background=bg==="vignette"
    ? `<rect width="2048" height="768" fill="#050405"/>`
    : "";

  return `<svg width="2048" height="768" viewBox="0 0 2048 768" xmlns="http://www.w3.org/2000/svg">
  ${background}
  <text x="50%" y="40%" text-anchor="middle"
        font-family="Montserrat, Arial"
        font-weight="800"
        font-style="italic"
        font-size="300"
        fill="#EFF0F3">iTrader<tspan fill="#E22229">.im</tspan></text>
  <text x="50%" y="65%" text-anchor="middle"
        font-family="Montserrat"
        font-size="80"
        fill="#FAFAFC"
        letter-spacing="12">BUY • SELL • UPGRADE</text>
</svg>`;
}

async function exportPng(svg,name,sizes){
  for(const s of sizes){
    await sharp(Buffer.from(svg))
      .resize(s,null,{fit:"contain"})
      .png()
      .toFile(path.join(OUTPUT,`${name}_${s}.png`));
  }
}

async function zip(){
  return new Promise((res,rej)=>{
    const output=fs.createWriteStream(path.join(OUTPUT,"itrader-assets.zip"));
    const archive=archiver("zip",{zlib:{level:9}});
    archive.pipe(output);
    archive.directory(OUTPUT,false);
    archive.finalize();
    output.on("close",res);
    archive.on("error",rej);
  });
}

async function main(){
  ensure(OUTPUT);
  const spec=readSpec();

  for(const bg of BACKGROUNDS){
    const l=logoSVG(bg);
    fs.writeFileSync(path.join(OUTPUT,`logo_${bg}.svg`),l);
    await exportPng(l,`logo_${bg}`,WEB_SIZES);
  }

  const variants=Object.keys(spec.iconSystem?.variants||{core:{}});
  for(const v of variants){
    const icon=vortexSVG(1024,v);
    fs.writeFileSync(path.join(OUTPUT,`vortex_${v}.svg`),icon);
    await exportPng(icon,`vortex_${v}`,WEB_SIZES);
  }

  await zip();
  console.log("PHASE 2 COMPLETE");
}

main();
'@ | Set-Content "$SrcPath\render.mjs"

Write-Host "✓ Engine upgraded."

Set-Location $RootPath
pnpm render

Write-Host "`nPhase 2 complete. Check output folder." -ForegroundColor Green
Read-Host "Press ENTER to exit"