<# 
setup-brand-renderer.ps1
Full automated setup for iTrader brand renderer.
#>

$ErrorActionPreference = "Stop"

# ---------- CONFIG ----------
$RootPath = "D:\Websites\iommarket"
$PrivatePath = "$RootPath\private"
$RendererPath = "$RootPath\brand-renderer"
$InputPath = "$RendererPath\input"
$OutputPath = "$RendererPath\output"
$SrcPath = "$RendererPath\src"
$SvgPath = "$SrcPath\svg"

$JsonSource = "$PrivatePath\create-ui-components-2.json"
$BoardSource = "$PrivatePath\DesignBoard2.png"

# ---------- FUNCTIONS ----------
function Section($t) {
    Write-Host "`n=== $t ===" -ForegroundColor Cyan
}

function Confirm($msg) {
    $ans = Read-Host "$msg [Y/n]"
    if ($ans -and $ans.ToLower() -eq "n") { exit 1 }
}

function Ensure-Dir($p) {
    if (!(Test-Path $p)) { New-Item -ItemType Directory -Path $p | Out-Null }
}

# ---------- START ----------
Section "Validating Source Files"

if (!(Test-Path $JsonSource)) {
    Write-Host "JSON not found: $JsonSource" -ForegroundColor Red
    exit 1
}

if (!(Test-Path $BoardSource)) {
    Write-Host "Design board not found: $BoardSource" -ForegroundColor Red
    exit 1
}

Write-Host "✓ Source files found."

Confirm "Proceed with creating / overwriting brand-renderer folder?"

# ---------- CREATE STRUCTURE ----------
Section "Creating Folder Structure"

Ensure-Dir $RendererPath
Ensure-Dir $InputPath
Ensure-Dir $OutputPath
Ensure-Dir $SrcPath
Ensure-Dir $SvgPath

Write-Host "✓ Folder structure ready."

# ---------- COPY INPUT FILES ----------
Section "Copying Input Files"

Copy-Item $JsonSource "$InputPath\brand.json" -Force
Copy-Item $BoardSource "$InputPath\DesignBoard2.png" -Force

Write-Host "✓ Input files copied."

# ---------- WRITE FILES ----------
Section "Writing package.json"

@'
{
  "name": "itrader-brand-renderer",
  "private": true,
  "type": "module",
  "scripts": {
    "render": "node ./src/render.mjs"
  },
  "dependencies": {
    "archiver": "^7.0.1",
    "sharp": "^0.34.1"
  }
}
'@ | Set-Content "$RendererPath\package.json"

# ---------- WRITE SIMPLE RENDERER ----------
Section "Writing Renderer Files"

@'
import fs from "fs";
import path from "path";
import sharp from "sharp";
import archiver from "archiver";

const ROOT = process.cwd();
const INPUT = path.join(ROOT, "input");
const OUTPUT = path.join(ROOT, "output");

const WEB_SIZES = [256,512,1024,2048];

function ensureDir(p){ fs.mkdirSync(p,{recursive:true}); }

function simpleLogo(){
  return `<svg width="2048" height="768" viewBox="0 0 2048 768" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="#050405"/>
  <text x="50%" y="45%" text-anchor="middle"
        font-family="Montserrat, Arial"
        font-weight="800"
        font-style="italic"
        font-size="280"
        fill="#EFF0F3">iTrader<tspan fill="#E22229">.im</tspan></text>
  <text x="50%" y="70%" text-anchor="middle"
        font-family="Montserrat, Arial"
        font-size="70"
        fill="#FAFAFC"
        letter-spacing="12">BUY • SELL • UPGRADE</text>
</svg>`;
}

async function exportPngs(svg,name){
  for(const s of WEB_SIZES){
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
  ensureDir(OUTPUT);

  const svg=simpleLogo();
  fs.writeFileSync(path.join(OUTPUT,"logo.svg"),svg);

  await exportPngs(svg,"logo");

  await zip();

  console.log("DONE");
}

main();
'@ | Set-Content "$SrcPath\render.mjs"

Write-Host "✓ Renderer written."

# ---------- INSTALL ----------
Section "Installing Dependencies"

Set-Location $RendererPath
pnpm install

# ---------- RUN ----------
Section "Running Renderer"

pnpm render

$ZipPath = "$OutputPath\itrader-assets.zip"

Section "COMPLETE"

if (Test-Path $ZipPath) {
    Write-Host "ZIP created at:" -ForegroundColor Green
    Write-Host $ZipPath
} else {
    Write-Host "ZIP not found. Something went wrong." -ForegroundColor Red
}

Read-Host "Press ENTER to exit"