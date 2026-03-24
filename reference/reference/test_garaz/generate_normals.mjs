/**
 * Generate normal maps from color textures using Sobel filter.
 * Uses pure Node.js with the sharp library (or canvas fallback).
 * Reads PNG color textures, outputs _normal.png files.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { createCanvas, loadImage } from 'canvas';
import { join } from 'path';

const TEXTURES_DIR = './public/textures';
const STRENGTH = 2.0; // Normal map intensity

const textures = ['wood_planks', 'concrete', 'zinc', 'plaster', 'cetris', 'pavement'];

function grayscale(r, g, b) {
    return 0.299 * r + 0.587 * g + 0.114 * b;
}

async function generateNormalMap(name) {
    const inputPath = join(TEXTURES_DIR, `${name}.png`);
    if (!existsSync(inputPath)) {
        console.log(`  Skip: ${inputPath} not found`);
        return;
    }

    const img = await loadImage(inputPath);
    const w = img.width;
    const h = img.height;

    // Read pixels
    const srcCanvas = createCanvas(w, h);
    const srcCtx = srcCanvas.getContext('2d');
    srcCtx.drawImage(img, 0, 0);
    const srcData = srcCtx.getImageData(0, 0, w, h).data;

    // Convert to grayscale heightmap
    const height = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
        height[i] = grayscale(srcData[i * 4], srcData[i * 4 + 1], srcData[i * 4 + 2]) / 255;
    }

    // Generate normal map using Sobel
    const dstCanvas = createCanvas(w, h);
    const dstCtx = dstCanvas.getContext('2d');
    const dstImg = dstCtx.createImageData(w, h);

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const idx = y * w + x;

            // Sample neighbors (wrapping for tileability)
            const l = height[y * w + ((x - 1 + w) % w)];
            const r = height[y * w + ((x + 1) % w)];
            const t = height[((y - 1 + h) % h) * w + x];
            const b = height[((y + 1) % h) * w + x];

            // Sobel derivatives
            const dx = (l - r) * STRENGTH;
            const dy = (t - b) * STRENGTH;
            const dz = 1.0;

            // Normalize
            const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
            const nx = dx / len;
            const ny = dy / len;
            const nz = dz / len;

            // Encode to RGB [0,255]
            const pi = idx * 4;
            dstImg.data[pi] = Math.round((nx * 0.5 + 0.5) * 255);
            dstImg.data[pi + 1] = Math.round((ny * 0.5 + 0.5) * 255);
            dstImg.data[pi + 2] = Math.round((nz * 0.5 + 0.5) * 255);
            dstImg.data[pi + 3] = 255;
        }
    }

    dstCtx.putImageData(dstImg, 0, 0);
    const buffer = dstCanvas.toBuffer('image/png');
    const outputPath = join(TEXTURES_DIR, `${name}_normal.png`);
    writeFileSync(outputPath, buffer);
    console.log(`  ✓ ${outputPath}`);
}

console.log('Generating normal maps...');
for (const name of textures) {
    await generateNormalMap(name);
}
console.log('Done!');
