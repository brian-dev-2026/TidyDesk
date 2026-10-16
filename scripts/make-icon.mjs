// Renders build/icon.svg to build/icon.png (512) and build/icon.ico (16–256).
import fs from 'fs/promises'
import sharp from 'sharp'
import pngToIco from 'png-to-ico'

const svg = await fs.readFile('build/icon.svg')
await sharp(svg).resize(512, 512).png().toFile('build/icon.png')
const sizes = [16, 24, 32, 48, 64, 128, 256]
const pngs = await Promise.all(sizes.map((s) => sharp(svg).resize(s, s).png().toBuffer()))
await fs.writeFile('build/icon.ico', await pngToIco(pngs))
console.log('wrote build/icon.png and build/icon.ico')
