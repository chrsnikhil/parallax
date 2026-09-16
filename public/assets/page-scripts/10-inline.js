
  import * as THREE from 'three';
  import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
  import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
  try {
        const CONFIG = {
            glbPath: window.innerWidth < 768
                ? '/assets/pub-6903216751f64c07b3cecf6009faf318.r2.dev/Sprint_mobile.glb'
                : '/assets/pub-6903216751f64c07b3cecf6009faf318.r2.dev/Sprint.glb',
            showDebug: false,
            targetCamera: 'DutchCamera001',
            parallax: {
                enabled: true,
                horizontalIntensityMin: 0.2,
                horizontalIntensityMax: 1.4,
                verticalIntensity: 0.15,
                rotationIntensity: 0.04,
                smoothness: 0.06,
            },
            mobile: {
                breakpoint: 768,
                cameraOffsetX: 0.35,
                disableParallax: true,
                parallaxBreakpoint: 768
            }
        };
        const scrollSection = document.querySelector('.threejs-scroll-section');
        const heroSection = document.querySelector('.Hero-Section') || document.querySelector('.hero-section');
        let heroPlaceholder = null;
        const sectionBottom = scrollSection ? scrollSection.offsetHeight : 0;
        if (heroSection) {
            heroPlaceholder = document.createElement('div');
            heroPlaceholder.style.height = heroSection.offsetHeight + 'px';
            heroPlaceholder.style.width = '100%';
            heroPlaceholder.className = 'hero-placeholder';
            heroSection.parentNode.insertBefore(heroPlaceholder, heroSection.nextSibling);
            heroSection.style.position = 'fixed';
            heroSection.style.top = '0';
            heroSection.style.left = '0';
            heroSection.style.width = '100%';
            heroSection.style.height = '100vh';
            heroSection.style.zIndex = '1';
            heroSection.style.opacity = '0';
        }
        let heroIsFixed = true;
        let stableViewportHeight = window.innerHeight;
        function getMaxScroll() {
            if (scrollSection) {
                const val = scrollSection.offsetHeight - stableViewportHeight;
                if (val > 100) return val;
            }
            return Math.max(document.body.scrollHeight - stableViewportHeight, 1);
        }
        const mouse = { x: 0, y: 0, targetX: 0, targetY: 0 };
        window.addEventListener('mousemove', (event) => {
            mouse.targetX = (event.clientX / window.innerWidth) * 2 - 1;
            mouse.targetY = -(event.clientY / window.innerHeight) * 2 + 1;
        }, { passive: true });
        window.addEventListener('touchmove', (event) => {
            if (event.touches.length > 0) {
                const touch = event.touches[0];
                mouse.targetX = (touch.clientX / window.innerWidth) * 2 - 1;
                mouse.targetY = -(touch.clientY / window.innerHeight) * 2 + 1;
            }
        }, { passive: true });
        window.addEventListener('mouseleave', () => {
            mouse.targetX = 0;
            mouse.targetY = 0;
        });
        const container = document.getElementById('canvas-container');
        const progressBar = document.getElementById('progress-bar');
        const debugInfo = document.getElementById('debug-info');
        if (debugInfo) debugInfo.style.display = 'none';
        const isMobile = window.innerWidth < CONFIG.mobile.breakpoint;
        const scene = new THREE.Scene();
        scene.background = new THREE.Color('#006622');
        const renderer = new THREE.WebGLRenderer({
            antialias: !isMobile,
            powerPreference: isMobile ? "low-power" : "high-performance",
            logarithmicDepthBuffer: false,
            failIfMajorPerformanceCaveat: false
        });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.0 : 1.5));
        renderer.shadowMap.enabled = false;
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 0.75;
        container.appendChild(renderer.domElement);
        renderer.domElement.addEventListener('webglcontextlost', (event) => {
            event.preventDefault();
        });
        renderer.domElement.addEventListener('webglcontextrestored', () => {
            renderer.setSize(window.innerWidth, window.innerHeight);
            renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.0 : 1.5));
        });
        let camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        let mixer = null;
        let animationDuration = 0;
        let glbCamera = null;
        const dracoLoader = new DRACOLoader();
        dracoLoader.setDecoderPath('/assets/www.gstatic.com/draco/versioned/decoders/1.5.6/');
        const loader = new GLTFLoader();
        loader.setDRACOLoader(dracoLoader);
        // --- PARALLAX typeface: TASA Orbiter Display, served locally ---
        // The asset's real display face - the untouched 'AGENTIC COMMERCE'
        // curve geometry in the scene is set in it, and the replacement
        // CanvasTexture type must match. The three OTFs start loading at
        // script parse so they race the multi-MB GLB fetch, and every canvas
        // draw waits on TYPEFACE.ready, because 2D canvas SILENTLY
        // substitutes a default face for any font not yet loaded. The
        // .then() proves the face really applied: measureText widths for the
        // registered family are compared against monospace and Arial - if
        // 'TasaOrbiter' had resolved to a fallback its width would equal one
        // of them - and the result is logged with a [TYPE] prefix.
        const TYPEFACE = (() => {
            const family = 'TasaOrbiter';
            const sources = [
                ['400', '/assets/fonts/TASAOrbiterDisplay-Regular.otf'],
                ['500', '/assets/fonts/TASAOrbiterDisplay-Medium.otf'],
                ['700', '/assets/fonts/TASAOrbiterDisplay-Bold.otf']
            ];
            const ready = Promise.all(sources.map(function (src) {
                const face = new FontFace(family, 'url(' + src[1] + ')', { weight: src[0] });
                return face.load()
                    .then(function (f) { document.fonts.add(f); return true; })
                    .catch(function (e) {
                        console.error('[TYPE] FontFace load FAILED for weight ' + src[0] + ':', e);
                        return false;
                    });
            })).then(function (oks) {
                const loaded = oks.every(Boolean);
                let applied = false;
                try {
                    const ctx = document.createElement('canvas').getContext('2d');
                    const probe = 'PARALLAX WALLET';
                    const rows = ['400', '500', '700'].map(function (w) {
                        ctx.font = w + ' 100px ' + family + ', monospace';
                        const wTasa = ctx.measureText(probe).width;
                        ctx.font = w + ' 100px monospace';
                        const wMono = ctx.measureText(probe).width;
                        ctx.font = w + ' 100px Arial';
                        const wArial = ctx.measureText(probe).width;
                        return { w: w, t: wTasa, m: wMono, a: wArial };
                    });
                    const checked = document.fonts.check('500 100px ' + family);
                    applied = loaded && checked && rows.every(function (r) {
                        return Math.abs(r.t - r.m) > 0.5 && Math.abs(r.t - r.a) > 0.5;
                    });
                    console.log('[TYPE] TasaOrbiter loaded=' + loaded + ' check=' + checked +
                        ' applied=' + applied + ' | ' +
                        rows.map(function (r) {
                            return r.w + ' tasa=' + r.t.toFixed(1) + ' mono=' + r.m.toFixed(1) + ' arial=' + r.a.toFixed(1);
                        }).join(' | '));
                } catch (e) {
                    console.error('[TYPE] verification threw:', e);
                }
                if (!applied) console.error('[TYPE] TASA Orbiter NOT proven applied - canvas type may be in a fallback face');
                return applied;
            });
            return { stack: family + ', Arial, Helvetica, sans-serif', ready: ready };
        })();
        // --- PARALLAX recolour: deep forest green field, original structure ---
        // The composition keeps the original Razorpay structure - saturated
        // field, dark billboard panels, white type and linework - but the blue
        // family (baseColor factors, emissive factors, and baked baseColor/
        // emissive WebP textures) is rotated onto a deep forest green: the
        // dominant blue ('MainBlue' #0039ff, S=1 L=0.5 in sRGB HSL) maps
        // exactly onto deepGreen via a hue rotation plus a lightness scale.
        // Very light pastel blues keep their lightness (they read as
        // near-white UI tints), so the taper between pastelLo/pastelHi blends
        // full darkening into full preservation. Greys, whites and blacks are
        // untouched, which preserves the dark panels and white type exactly
        // as authored.
        const RECOLOR = (() => {
            const deepGreen = '#006622';
            const hsl = {};
            new THREE.Color(deepGreen).getHSL(hsl, THREE.SRGBColorSpace);
            const gH = hsl.h, gL = hsl.l;
            new THREE.Color('#0039ff').getHSL(hsl, THREE.SRGBColorSpace);
            return {
                hueShift: gH - hsl.h,         // ~ -85deg, normalised
                darken: gL / hsl.l,           // ~0.40 lightness scale to deep green
                pastelLo: 0.78,               // below: fully darkened
                pastelHi: 0.92,               // above: lightness preserved
                hueMin: 0.52,                 // only touch hues in ~187..300deg
                hueMax: 0.835,
                minSat: 0.05
            };
        })();
        function shiftedLightness(l) {
            let t = (l - RECOLOR.pastelLo) / (RECOLOR.pastelHi - RECOLOR.pastelLo);
            t = Math.max(0, Math.min(1, t));
            t = t * t * (3 - 2 * t); // smoothstep
            return l * (RECOLOR.darken + (1 - RECOLOR.darken) * t);
        }
        function shiftMaterialColor(color) {
            const hsl = {};
            color.getHSL(hsl, THREE.SRGBColorSpace);
            if (hsl.s < RECOLOR.minSat) return;
            if (hsl.h < RECOLOR.hueMin || hsl.h > RECOLOR.hueMax) return;
            let h = hsl.h + RECOLOR.hueShift;
            if (h < 0) h += 1;
            color.setHSL(h, hsl.s, shiftedLightness(hsl.l), THREE.SRGBColorSpace);
        }
        // Blue is baked into the baseColor/emissive textures (WebP), so a
        // factor change alone cannot recolour textured materials. Redraw each
        // texture onto a canvas and shift only the blue-ish pixels (same
        // rotation and lightness treatment as the factors, in sRGB), leaving
        // greys/whites/blacks - the dark panels, white type and linework -
        // untouched. One-time cost at load; the canvas replaces the image on
        // the existing Texture so flipY/colorSpace/transform are preserved.
        function shiftTexturePixels(texture) {
            const img = texture.image;
            if (!img || !img.width || !img.height) return;
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (!ctx) return;
            ctx.drawImage(img, 0, 0);
            let imageData;
            try {
                imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            } catch (e) { return; }
            const px = imageData.data;
            const hueMinDeg = RECOLOR.hueMin * 360;
            const hueMaxDeg = RECOLOR.hueMax * 360;
            const hueShiftDeg = RECOLOR.hueShift * 360;
            for (let i = 0; i < px.length; i += 4) {
                const r = px[i], g = px[i + 1], b = px[i + 2];
                const max = Math.max(r, g, b), min = Math.min(r, g, b);
                const delta = max - min;
                const s = delta === 0 ? 0 : delta / (255 - Math.abs(max + min - 255));
                if (s < RECOLOR.minSat) continue; // grey/white/black untouched
                let h;
                if (max === r) h = ((g - b) / delta) % 6;
                else if (max === g) h = (b - r) / delta + 2;
                else h = (r - g) / delta + 4;
                h *= 60;
                if (h < 0) h += 360;
                if (h < hueMinDeg || h > hueMaxDeg) continue;
                h += hueShiftDeg;
                if (h < 0) h += 360;
                const l = shiftedLightness((max + min) / 510);
                const c = (1 - Math.abs(2 * l - 1)) * s;
                const x = c * (1 - Math.abs((h / 60) % 2 - 1));
                const m = l - c / 2;
                let r1, g1, b1;
                if (h < 60)       { r1 = c; g1 = x; b1 = 0; }
                else if (h < 120) { r1 = x; g1 = c; b1 = 0; }
                else if (h < 180) { r1 = 0; g1 = c; b1 = x; }
                else if (h < 240) { r1 = 0; g1 = x; b1 = c; }
                else if (h < 300) { r1 = x; g1 = 0; b1 = c; }
                else              { r1 = c; g1 = 0; b1 = x; }
                px[i]     = Math.round((r1 + m) * 255);
                px[i + 1] = Math.round((g1 + m) * 255);
                px[i + 2] = Math.round((b1 + m) * 255);
            }
            ctx.putImageData(imageData, 0, 0);
            texture.image = canvas;
            texture.needsUpdate = true;
        }
        // --- PARALLAX rebrand of texture-baked copy ---
        // Most of the scene's headline copy is 3D curve geometry and cannot be
        // retyped from JS ('SPRINT 26', its subtitle, 'MAGIC CHECKOUT',
        // 'AGENTIC COMMERCE', 'Payment Completed', 'Ask me anything',
        // 'Speak/Confirm/Done', and the hero shoe tag). One string is baked
        // into a texture decal and IS replaced here, drawing onto the same
        // canvas the recolour pass produced:
        //   'GLOBAL CHECKOUT' (GlobalCheckout decal) -> 'CROSS-CHAIN'
        // 'CONVERSIONS' (AdSpends) is also a texture, but its type sits on a
        // dense halftone ground that a flat-colour erase would visibly scar,
        // so it is deliberately left as authored.
        function brandCanvas(tex) {
            const img = tex.image;
            if (!img || !img.width) return null;
            if (typeof img.getContext === 'function') return img;
            const cv = document.createElement('canvas');
            cv.width = img.width;
            cv.height = img.height;
            const cx = cv.getContext('2d');
            if (!cx) return null;
            cx.drawImage(img, 0, 0);
            tex.image = cv;
            return cv;
        }
        // The GlobalCheckout texture is a type decal on a transparent ground
        // (the dark card behind it is separate geometry), so it can be fully
        // cleared and retyped in the same two-line composition.
        function repaintCrossChain(tex) {
            const cv = brandCanvas(tex);
            if (!cv) return;
            const ctx = cv.getContext('2d');
            const W = cv.width, H = cv.height;
            ctx.clearRect(0, 0, W, H);
            ctx.fillStyle = '#ffffff';
            try { ctx.letterSpacing = '-' + Math.round(H * 0.012) + 'px'; } catch (e) {}
            ctx.font = '700 ' + Math.round(H * 0.40) + 'px ' + TYPEFACE.stack;
            ctx.textBaseline = 'alphabetic';
            ctx.fillText('CROSS-', W * 0.02, H * 0.42);
            ctx.fillText('CHAIN', W * 0.02, H * 0.88);
            tex.needsUpdate = true;
        }
        // The LEFT shoe tag spells 'SPRINT/26' with extruded glyph geometry
        // that is part of the same primitive as the flag; those glyph faces
        // take their colour from the TOP BAND of the BlueTag emissive
        // texture (its background stores black under zero alpha, which is
        // why the type read near-black). The glyphs cannot be retyped -
        // they are relief in a single-primitive skinned mesh - so the band
        // is flooded with the tag-body green sampled from the recoloured
        // blob: the relief type goes tone-on-tone and the flag reads as a
        // clean blank tag. (The right tag's type is separate geometry and
        // is properly retyped in rebrandTypeMeshes below.)
        function repaintTagBand(tex) {
            const cv = brandCanvas(tex);
            if (!cv) return;
            const ctx = cv.getContext('2d');
            const W = cv.width, H = cv.height;
            let c = null;
            try { c = ctx.getImageData(Math.round(W * 0.33), Math.round(H * 0.5), 1, 1).data; } catch (e) {}
            if (!c || c[3] === 0) c = [0, 90, 40, 255];
            ctx.fillStyle = 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
            ctx.fillRect(0, 0, W, Math.round(H * 0.19));
            tex.needsUpdate = true;
        }
        // --- PARALLAX rebrand of copy that is 3D GEOMETRY, not texture ---
        // The headline copy ('SPRINT 26', its subtitle, 'MAGIC CHECKOUT',
        // 'Buy now', the right-shoe tag, the rupee coin glyph) is extruded
        // curve/text geometry, out of reach of the texture repaints above.
        // Each target node is keyframed (or rides the keyframed graph), so
        // the node is KEPT - position/rotation/scale and parent untouched,
        // animation and camera behaviour inherited for free - and only what
        // it renders is swapped: geometry becomes a plane fitted to the
        // exact bounding box the original glyphs occupied, material becomes
        // an unlit transparent CanvasTexture with the new string.
        function makeTypeTexture(opt) {
            const aspect = Math.max(0.05, opt.aspect || 1);
            let H = opt.texH || 256;
            let W = Math.round(H * aspect);
            if (W > 2048) { W = 2048; H = Math.max(16, Math.round(W / aspect)); }
            const cv = document.createElement('canvas');
            cv.width = W;
            cv.height = H;
            const ctx = cv.getContext('2d');
            if (!ctx) return null;
            if (opt.draw) {
                opt.draw(ctx, W, H);
            } else {
                const lines = opt.lines;
                const pad = (opt.pad !== undefined ? opt.pad : 0.03) * W;
                const lineH = H / lines.length;
                let size = lineH * (opt.sizeScale || 0.78);
                const font = function (s) {
                    return (opt.italic ? 'italic ' : '') + (opt.weight || 500) + ' ' +
                        s.toFixed(1) + 'px ' + (opt.family || TYPEFACE.stack);
                };
                const setTracking = function (s) {
                    try { ctx.letterSpacing = ((opt.tracking || 0) * s).toFixed(2) + 'px'; } catch (e) {}
                };
                setTracking(size);
                ctx.font = font(size);
                let maxW = 0;
                lines.forEach(function (t) { maxW = Math.max(maxW, ctx.measureText(t).width); });
                const avail = W - pad * 2;
                if (maxW > avail) { size *= avail / maxW; setTracking(size); ctx.font = font(size); }
                ctx.fillStyle = opt.color || '#f2f2f2';
                ctx.textAlign = opt.align || 'center';
                ctx.textBaseline = 'middle';
                const x = opt.align === 'left' ? pad : (opt.align === 'right' ? W - pad : W / 2);
                const yBias = 0.52 + (opt.baselineShift || 0);
                lines.forEach(function (t, i) { ctx.fillText(t, x, lineH * (i + yBias)); });
            }
            const tex = new THREE.CanvasTexture(cv);
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
            return tex;
        }
        function typeMaterial(opt) {
            return new THREE.MeshBasicMaterial({
                map: makeTypeTexture(opt),
                transparent: true,
                alphaTest: 0.02
            });
        }
        // Blender text exported to glTF lies flat in node-local XZ (y = 0):
        // reading direction +X, glyph-up -Z, face normal +Y. The plane is
        // built in that same frame at the glyph bbox centre (the bbox is NOT
        // origin-centred - e.g. 'MAGIC CHECKOUT' starts at its origin).
        function swapToTypePlane(mesh, opt) {
            const g = mesh.geometry;
            g.computeBoundingBox();
            const bb = g.boundingBox;
            const w = bb.max.x - bb.min.x;
            const h = bb.max.z - bb.min.z;
            if (!(w > 0) || !(h > 0)) { mesh.visible = false; return; }
            const plane = new THREE.PlaneGeometry(w, h);
            plane.rotateX(-Math.PI / 2);
            plane.translate(
                (bb.min.x + bb.max.x) / 2,
                (bb.min.y + bb.max.y) / 2 + (opt.lift || 0),
                (bb.min.z + bb.max.z) / 2
            );
            mesh.geometry = plane;
            mesh.material = typeMaterial(Object.assign({ aspect: w / h }, opt));
        }
        // The shoe-tag type is a SkinnedMesh primitive whose bind-space
        // orientation is diagonal, so an axis-aligned fit is wrong. A PCA
        // (power-iteration) fit finds the type plane: e1 = reading
        // direction, e2 = glyph up, e3 = face normal. The replacement plane
        // is rebuilt in that oriented frame and re-skinned by copying the
        // bone binding of the original vertex nearest the type centre (the
        // tag is stiff, so one rigid binding is enough).
        function swapSkinnedTypePlane(mesh, opt) {
            const g = mesh.geometry;
            const pos = g.attributes.position;
            const si = g.attributes.skinIndex;
            const sw = g.attributes.skinWeight;
            if (!pos || !si || !sw) { mesh.visible = false; return; }
            const n = pos.count;
            let mx = 0, my = 0, mz = 0;
            for (let i = 0; i < n; i++) { mx += pos.getX(i); my += pos.getY(i); mz += pos.getZ(i); }
            mx /= n; my /= n; mz /= n;
            let C = [0, 0, 0, 0, 0, 0, 0, 0, 0];
            for (let i = 0; i < n; i++) {
                const dx = pos.getX(i) - mx, dy = pos.getY(i) - my, dz = pos.getZ(i) - mz;
                C[0] += dx * dx; C[1] += dx * dy; C[2] += dx * dz;
                C[4] += dy * dy; C[5] += dy * dz; C[8] += dz * dz;
            }
            C[3] = C[1]; C[6] = C[2]; C[7] = C[5];
            const mulC = function (v) {
                return [
                    C[0] * v[0] + C[1] * v[1] + C[2] * v[2],
                    C[3] * v[0] + C[4] * v[1] + C[5] * v[2],
                    C[6] * v[0] + C[7] * v[1] + C[8] * v[2]
                ];
            };
            const norm = function (v) {
                const l = Math.hypot(v[0], v[1], v[2]) || 1;
                return [v[0] / l, v[1] / l, v[2] / l];
            };
            const power = function (seed) {
                let v = norm(seed);
                for (let k = 0; k < 80; k++) v = norm(mulC(v));
                return v;
            };
            let e1 = power([1, 1, 1]);
            const w1v = mulC(e1);
            const l1 = w1v[0] * e1[0] + w1v[1] * e1[1] + w1v[2] * e1[2];
            for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) C[r * 3 + c] -= l1 * e1[r] * e1[c];
            let e2 = power([e1[1], e1[2], e1[0]]);
            const d = e2[0] * e1[0] + e2[1] * e1[1] + e2[2] * e1[2];
            e2 = norm([e2[0] - d * e1[0], e2[1] - d * e1[1], e2[2] - d * e1[2]]);
            if (opt.flipH) e1 = [-e1[0], -e1[1], -e1[2]];
            if (opt.flipV) e2 = [-e2[0], -e2[1], -e2[2]];
            const e3 = [
                e1[1] * e2[2] - e1[2] * e2[1],
                e1[2] * e2[0] - e1[0] * e2[2],
                e1[0] * e2[1] - e1[1] * e2[0]
            ];
            let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity, w0 = Infinity, w1 = -Infinity;
            for (let i = 0; i < n; i++) {
                const dx = pos.getX(i) - mx, dy = pos.getY(i) - my, dz = pos.getZ(i) - mz;
                const u = dx * e1[0] + dy * e1[1] + dz * e1[2];
                const v = dx * e2[0] + dy * e2[1] + dz * e2[2];
                const w = dx * e3[0] + dy * e3[1] + dz * e3[2];
                if (u < u0) u0 = u; if (u > u1) u1 = u;
                if (v < v0) v0 = v; if (v > v1) v1 = v;
                if (w < w0) w0 = w; if (w > w1) w1 = w;
            }
            const pw = u1 - u0, ph = v1 - v0;
            if (!(pw > 0) || !(ph > 0)) { mesh.visible = false; return; }
            const E1 = new THREE.Vector3(e1[0], e1[1], e1[2]);
            const E2 = new THREE.Vector3(e2[0], e2[1], e2[2]);
            const E3 = new THREE.Vector3(e3[0], e3[1], e3[2]);
            const lift = (w1 - w0) * (opt.liftFrac !== undefined ? opt.liftFrac : 0.75);
            const center = new THREE.Vector3(mx, my, mz)
                .addScaledVector(E1, (u0 + u1) / 2)
                .addScaledVector(E2, (v0 + v1) / 2)
                .addScaledVector(E3, (w0 + w1) / 2 + lift);
            const plane = new THREE.PlaneGeometry(pw, ph);
            plane.applyMatrix4(new THREE.Matrix4().makeBasis(E1, E2, E3).setPosition(center));
            let best = 0, bestD = Infinity;
            for (let i = 0; i < n; i++) {
                const dx = pos.getX(i) - mx, dy = pos.getY(i) - my, dz = pos.getZ(i) - mz;
                const dd = dx * dx + dy * dy + dz * dz;
                if (dd < bestD) { bestD = dd; best = i; }
            }
            const bi = [si.getX(best), si.getY(best), si.getZ(best), si.getW(best)];
            let bw = [sw.getX(best), sw.getY(best), sw.getZ(best), sw.getW(best)];
            const wsum = bw[0] + bw[1] + bw[2] + bw[3];
            if (wsum > 0) bw = bw.map(function (x) { return x / wsum; });
            const vc = plane.attributes.position.count;
            const ia = new Float32Array(vc * 4), wa = new Float32Array(vc * 4);
            for (let i = 0; i < vc; i++) {
                for (let c = 0; c < 4; c++) { ia[i * 4 + c] = bi[c]; wa[i * 4 + c] = bw[c]; }
            }
            plane.setAttribute('skinIndex', new THREE.BufferAttribute(ia, 4));
            plane.setAttribute('skinWeight', new THREE.BufferAttribute(wa, 4));
            mesh.geometry = plane;
            mesh.material = typeMaterial(Object.assign({ aspect: pw / ph }, opt));
        }
        // Generic token mark (hexagon + diamond core) for the coin face -
        // replaces the rupee glyph, which is wrong branding for a
        // cross-chain wallet.
        function drawTokenGlyph(ctx, W, H) {
            const cx = W / 2, cy = H / 2, r = Math.min(W, H) * 0.46;
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = Math.max(2, r * 0.18);
            ctx.lineJoin = 'round';
            ctx.beginPath();
            for (let i = 0; i < 6; i++) {
                const a = -Math.PI / 2 + i * Math.PI / 3;
                const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
                if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
            }
            ctx.closePath();
            ctx.stroke();
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.moveTo(cx, cy - r * 0.40);
            ctx.lineTo(cx + r * 0.34, cy);
            ctx.lineTo(cx, cy + r * 0.40);
            ctx.lineTo(cx - r * 0.34, cy);
            ctx.closePath();
            ctx.fill();
        }
        function rebrandTypeMeshes(root) {
            root.traverse(function (o) {
                if (!o.isMesh) return;
                const matName = (o.material && !Array.isArray(o.material)) ? o.material.name : '';
                if (o.name === 'Curve126') {
                    // main billboard headline: 'SPRINT 26' -> 'PARALLAX'
                    // Weight + tracking are MEASURED, not eyeballed: TASA
                    // probe planes were injected co-planar with the untouched
                    // 'AGENTIC COMMERCE' geometry (Curve002), homography-
                    // rectified to its local frame and scanline-measured.
                    // Stem-stroke/cap-height: real 0.149 vs TASA 400 0.123 /
                    // 500 0.154 / 700 0.192 -> Medium 500. Letter advance:
                    // real is 0.085 cap TIGHTER than TASA at zero spacing
                    // (M-M and C..E span agree) = -0.058 em - the reference
                    // letters all but touch, so every replaced string gets
                    // tracking -0.058 to match.
                    swapToTypePlane(o, { lines: ['PARALLAX'], weight: 500, tracking: -0.058, sizeScale: 0.92 });
                } else if (o.name === 'Curve127') {
                    // billboard subtitle: '100+ LAUNCHES & UPDATES' -> new
                    // tagline (subordinate via size, same measured weight and
                    // tracking as the headline)
                    swapToTypePlane(o, { lines: ['THE WALLET YOU TALK TO'], weight: 500, tracking: -0.058, sizeScale: 0.80, baselineShift: 0.12 });
                } else if (o.name === 'Text' && o.parent && o.parent.name === 'vaseCTRL001') {
                    // product card: 'MAGIC CHECKOUT' -> 'VOICE INTENT' (two lines, left aligned like the original)
                    swapToTypePlane(o, { lines: ['VOICE', 'INTENT'], weight: 500, tracking: -0.058, align: 'left', sizeScale: 0.82 });
                } else if (o.name === 'Text005') {
                    // card button: 'Buy now' -> 'DRY RUN' (Medium 500 like
                    // the rest of the scene's display type)
                    swapToTypePlane(o, { lines: ['DRY RUN'], weight: 500, tracking: -0.058, sizeScale: 0.80, color: '#ffffff' });
                } else if (matName === 'EmissionText.001') {
                    // right-shoe tag 3D type: 'SPRINT/26' -> 'PARALLAX'
                    // (Medium 500 - the scene's measured display weight -
                    // with the tag's oblique kept)
                    swapSkinnedTypePlane(o, { lines: ['PARALLAX'], weight: 500, tracking: -0.058, italic: true, sizeScale: 0.95, color: '#ffffff' });
                } else if (o.name === 'Label_R002') {
                    // blue drop-shadow copy of the old tag type - retire it
                    o.visible = false;
                }
            });
            // phone-card coin: white rupee glyph (Curve070 group: type face +
            // offset shadow copy) -> generic token mark on the face, shadow off
            const coinGlyph = root.getObjectByName('Curve070');
            if (coinGlyph) {
                let face = null;
                coinGlyph.traverse(function (o) {
                    if (!o.isMesh) return;
                    if (!face && o.material && o.material.name === 'EmissionSomewhatWhite') face = o;
                    else o.visible = false;
                });
                if (face) swapToTypePlane(face, { draw: drawTokenGlyph });
            }
        }
        function recolorScene(root) {
            const doneMaterials = new Set();
            const doneTextures = new Set();
            const brandTextures = {};
            root.traverse((child) => {
                if (!child.isMesh && !child.isLine && !child.isPoints) return;
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                materials.forEach((mat) => {
                    if (!mat || doneMaterials.has(mat)) return;
                    doneMaterials.add(mat);
                    if (mat.color) shiftMaterialColor(mat.color);
                    if (mat.emissive) shiftMaterialColor(mat.emissive);
                    [mat.map, mat.emissiveMap].forEach((tex) => {
                        if (!tex || doneTextures.has(tex)) return;
                        doneTextures.add(tex);
                        shiftTexturePixels(tex);
                    });
                    if (mat.name === 'GlobalCheckout' && mat.map) brandTextures.checkout = mat.map;
                    if (mat.name === 'BlueTag' && mat.emissiveMap) brandTextures.tag = mat.emissiveMap;
                });
            });
            if (brandTextures.checkout) repaintCrossChain(brandTextures.checkout);
            if (brandTextures.tag) repaintTagBand(brandTextures.tag);
        }
        let renderStopped = false;
        let completionPermanent = false;  // once true, re-entry into Three.js section is blocked
        function skipThreeJs() {
            renderStopped = true;
            if (isMobile) completionPermanent = true;  // mobile only: no re-entry when GLB skipped
            var canvasEl = document.getElementById('canvas-container');
            if (canvasEl) canvasEl.style.display = 'none';
            var scrollSectionEl = document.querySelector('.threejs-scroll-section');
            if (scrollSectionEl) scrollSectionEl.style.display = 'none';
            if (heroSection) {
                heroSection.style.position = '';
                heroSection.style.top = '';
                heroSection.style.left = '';
                heroSection.style.width = '';
                heroSection.style.height = '';
                heroSection.style.zIndex = '';
                heroSection.style.opacity = '1';
            }
            if (heroPlaceholder) heroPlaceholder.style.display = 'none';
            window.scrollTo(0, 0);
            window.dispatchEvent(new CustomEvent('glbLoaded'));
            window.dispatchEvent(new CustomEvent('threeJsCanvas', { detail: { active: false } }));
            // After the loader exits and body styles are restored, iOS Safari's
            // IntersectionObserver does not re-evaluate on CSS layout changes alone.
            // Firing scroll + resize forces it to re-check all observed elements
            // (Rive containers, lazy images) that are now in view.
            window.addEventListener('loaderExited', function onSkipReveal() {
                window.removeEventListener('loaderExited', onSkipReveal);
                requestAnimationFrame(function() {
                    window.dispatchEvent(new Event('scroll'));
                    window.dispatchEvent(new Event('resize'));
                });
            });
        }
        // 6-second timeout for mobile — skip gracefully if GLB hasn't loaded
        var mobileGlbTimeout = null;
        if (isMobile) {
            mobileGlbTimeout = setTimeout(function() {
                if (!mixer) {
                    skipThreeJs();
                }
            }, 6000);
        }
        loader.load(
            CONFIG.glbPath,
            (gltf) => {
                if (renderStopped) return;  // timeout already fired skipThreeJs() — ignore late load
                if (mobileGlbTimeout) clearTimeout(mobileGlbTimeout);
                // Gate ALL scene branding on the typeface being ready: 2D
                // canvas draws issued before the FontFace resolves silently
                // fall back to a default face. The OTFs started loading at
                // script parse and are a fraction of the GLB's size, so in
                // practice this resolves immediately; the promise also
                // resolves (with a logged error) if a font fails, so the
                // scene never stalls behind a missing file.
                TYPEFACE.ready.then(() => {
                    recolorScene(gltf.scene);
                    rebrandTypeMeshes(gltf.scene);
                    scene.add(gltf.scene);
                    gltf.scene.traverse((child) => {
                        if (child.name === CONFIG.targetCamera || child.name.includes(CONFIG.targetCamera)) {
                            if (child.isCamera) {
                                glbCamera = child;
                            } else {
                                child.traverse((sub) => {
                                    if (sub.isCamera) glbCamera = sub;
                                });
                            }
                        }
                        if (child.isCamera && !glbCamera) glbCamera = child;
                        if (child.isMesh) {
                            if (child.material) child.material.side = THREE.DoubleSide;
                            child.frustumCulled = false;
                        }
                    });
                    if (!glbCamera && gltf.cameras.length > 0) {
                        glbCamera = gltf.cameras.find(c => c.name.includes(CONFIG.targetCamera)) || gltf.cameras[0];
                    }
                    if (glbCamera) {
                        glbCamera.aspect = window.innerWidth / window.innerHeight;
                        glbCamera.near = 0.01;
                        glbCamera.far = 1000;
                        glbCamera.updateProjectionMatrix();
                        camera = glbCamera;
                    }
                    if (gltf.animations.length > 0) {
                        mixer = new THREE.AnimationMixer(gltf.scene);
                        gltf.animations.forEach((clip) => {
                            const action = mixer.clipAction(clip);
                            action.setLoop(THREE.LoopOnce);
                            action.clampWhenFinished = true;
                            action.play();
                        });
                        animationDuration = Math.max(...gltf.animations.map(a => a.duration));
                    }
                    // Debug handle for headless verification probes (no render effect).
                    window.__PXDBG = { scene: gltf.scene, getCamera: function () { return camera; } };
                    window.dispatchEvent(new CustomEvent('glbLoaded'));
                    window.dispatchEvent(new CustomEvent('threeJsCanvas', { detail: { active: true } }));
                    setTimeout(() => {
                        const si = document.querySelector('#scroll-indicator');
                        if (si) si.style.opacity = '0';
                    }, 3000);
                });
            },
            undefined,
            (error) => {
                if (mobileGlbTimeout) clearTimeout(mobileGlbTimeout);
                skipThreeJs();
            }
        );
        let currentScrollProgress = 0;
        let targetScrollProgress = 0;
        function updateScrollProgress() {
            const scrollTop = window.scrollY;
            const maxScroll = getMaxScroll();
            targetScrollProgress = Math.max(0, Math.min(1, scrollTop / maxScroll));
        }
        let isAutoScrolling = false;
        let introScrollDone = false;
        let completionTriggered = false;
        let lastCompletionTime = 0;
        function smoothScrollTo(targetY, duration, onComplete) {
            isAutoScrolling = true;
            const startY = window.scrollY;
            const distance = targetY - startY;
            const startTime = performance.now();
            function step(currentTime) {
                const elapsed = currentTime - startTime;
                const t = Math.min(elapsed / duration, 1);
                const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
                window.scrollTo(0, startY + distance * eased);
                if (t < 1) {
                    requestAnimationFrame(step);
                } else {
                    isAutoScrolling = false;
                    if (onComplete) onComplete();
                }
            }
            requestAnimationFrame(step);
        }
        function startIntroScroll() {
            if (introScrollDone || window.scrollY > 0) return;
            const maxScroll = getMaxScroll();
            smoothScrollTo(maxScroll * 0.02, 1200, () => { introScrollDone = true; });
        }
        function triggerCompletionScroll() {
            if (completionTriggered) return;
            completionTriggered = true;
            smoothScrollTo(sectionBottom, 1500);
        }
        window.addEventListener('scroll', () => {
            updateScrollProgress();
            if (renderStopped && !completionPermanent && window.scrollY < sectionBottom) {
                renderStopped = false;
                if (isMobile) {
                    completionTriggered = true;
                    setTimeout(function() { completionTriggered = false; }, 2500);
                } else {
                    completionTriggered = false;
                }
                const snapTarget = getMaxScroll() * 0.7;
                window.scrollTo(0, snapTarget);
                targetScrollProgress = 0.7;
                currentScrollProgress = 0.7;
                container.style.opacity = '1';
                container.style.pointerEvents = '';
                if (progressBar) progressBar.style.opacity = '1';
                if (heroSection && !heroIsFixed) {
                    heroSection.style.position = 'fixed';
                    heroSection.style.top = '0';
                    heroSection.style.left = '0';
                    heroSection.style.width = '100%';
                    heroSection.style.height = '100vh';
                    heroSection.style.zIndex = '1';
                    if (heroPlaceholder) heroPlaceholder.style.display = 'block';
                    heroIsFixed = true;
                }
                window.dispatchEvent(new CustomEvent('threeJsCanvas', { detail: { active: true } }));
                requestAnimationFrame(animate);
            }
            if (window.scrollY <= sectionBottom) {
                if (completionTriggered && targetScrollProgress < 0.60) {
                    completionTriggered = false;
                }
                if (!completionTriggered && !completionPermanent && targetScrollProgress >= (isMobile ? 0.85 : 0.98)) {
                    var now = Date.now();
                    if (now - lastCompletionTime > 2500) {
                        lastCompletionTime = now;
                        triggerCompletionScroll();
                    }
                }
            }
        }, { passive: true });
        requestAnimationFrame(startIntroScroll);
        function lerp(start, end, factor) {
            return start + (end - start) * factor;
        }
        let lastTime = 0;
        const _savedPos = new THREE.Vector3();
        const _savedRot = new THREE.Euler();
        function animate(currentTime) {
            if (renderStopped) return;
            requestAnimationFrame(animate);
            try {
                const gl = renderer.getContext();
                if (gl && gl.isContextLost()) return;
            } catch(e) { return; }
            const delta = currentTime - lastTime;
            if (delta < 16) return;
            lastTime = currentTime;
            currentScrollProgress = lerp(currentScrollProgress, targetScrollProgress, 0.05);
            if (Math.abs(currentScrollProgress - targetScrollProgress) < 0.005) {
                currentScrollProgress = targetScrollProgress;
            }
            if (mixer && animationDuration > 0) {
                const targetTime = Math.min(currentScrollProgress * animationDuration, animationDuration - 0.01);
                mixer.setTime(targetTime);
                if (glbCamera) {
                    glbCamera.near = 0.001;
                    glbCamera.far = 1000;
                    glbCamera.updateProjectionMatrix();
                }
            }
            const scrollTop = window.scrollY;
            if (heroSection) {
                if (scrollTop >= sectionBottom) {
                    if (heroIsFixed) {
                        heroSection.style.position = '';
                        heroSection.style.top = '';
                        heroSection.style.left = '';
                        heroSection.style.width = '';
                        heroSection.style.height = '';
                        heroSection.style.zIndex = '';
                        heroSection.style.opacity = '1';
                        if (heroPlaceholder) heroPlaceholder.style.display = 'none';
                        heroIsFixed = false;
                    }
                    container.style.opacity = '0';
                    container.style.pointerEvents = 'none';
                    if (progressBar) progressBar.style.opacity = '0';
                    renderStopped = true;
                    window.dispatchEvent(new CustomEvent('threeJsCanvas', { detail: { active: false } }));
                    return;
                } else {
                    if (!heroIsFixed) {
                        heroSection.style.position = 'fixed';
                        heroSection.style.top = '0';
                        heroSection.style.left = '0';
                        heroSection.style.width = '100%';
                        heroSection.style.height = '100vh';
                        heroSection.style.zIndex = '1';
                        if (heroPlaceholder) heroPlaceholder.style.display = 'block';
                        heroIsFixed = true;
                    }
                    container.style.pointerEvents = '';
                    if (currentScrollProgress >= 0.99) {
                        const fadeProgress = Math.min((currentScrollProgress - 0.99) / 0.01, 1);
                        container.style.opacity = String(1 - fadeProgress);
                        heroSection.style.opacity = String(fadeProgress);
                        if (progressBar) progressBar.style.opacity = String(1 - fadeProgress);
                    } else {
                        container.style.opacity = '1';
                        heroSection.style.opacity = '0';
                        if (progressBar) progressBar.style.opacity = '1';
                    }
                }
            }
            _savedPos.copy(camera.position);
            _savedRot.copy(camera.rotation);
            const intensityProgress = Math.min(currentScrollProgress / 0.3, 1.0);
            const dynamicHorizontalIntensity = lerp(
                CONFIG.parallax.horizontalIntensityMin,
                CONFIG.parallax.horizontalIntensityMax,
                intensityProgress
            );
            const shouldDisableParallax = CONFIG.mobile.disableParallax && (window.innerWidth < CONFIG.mobile.parallaxBreakpoint);
            const parallaxEnabled = CONFIG.parallax.enabled && !shouldDisableParallax;
            if (parallaxEnabled && glbCamera && mixer) {
                mouse.x = lerp(mouse.x, mouse.targetX, CONFIG.parallax.smoothness);
                mouse.y = lerp(mouse.y, mouse.targetY, CONFIG.parallax.smoothness);
                camera.position.x += mouse.x * dynamicHorizontalIntensity;
                camera.position.y += mouse.y * CONFIG.parallax.verticalIntensity;
                camera.position.y = Math.min(camera.position.y, 0.6);
                camera.rotation.y -= mouse.x * CONFIG.parallax.rotationIntensity;
            }
            if (window.innerWidth < CONFIG.mobile.breakpoint) {
                camera.position.x += CONFIG.mobile.cameraOffsetX;
            }
            if (progressBar) progressBar.style.width = `${currentScrollProgress * 100}%`;
            renderer.render(scene, camera);
            camera.position.copy(_savedPos);
            camera.rotation.copy(_savedRot);
        }
        animate(0);
        let resizeTimeout;
        let lastWidth = window.innerWidth;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                if (renderStopped) return;
                const newWidth = window.innerWidth;
                const newHeight = window.innerHeight;
                const widthChanged = newWidth !== lastWidth;
                const bigHeightChange = Math.abs(newHeight - stableViewportHeight) > 100;
                if (widthChanged || bigHeightChange) {
                    stableViewportHeight = newHeight;
                    lastWidth = newWidth;
                }
                camera.aspect = newWidth / newHeight;
                camera.updateProjectionMatrix();
                renderer.setSize(newWidth, newHeight);
            }, 100);
        });
        window.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown' || e.key === ' ') window.scrollBy(0, 200);
            if (e.key === 'ArrowUp') window.scrollBy(0, -200);
        });
    } catch (fatalError) {
        // fatal error — animation silently disabled
    }
