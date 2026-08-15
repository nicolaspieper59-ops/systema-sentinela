// ==========================================
// WORKER ASTRONOMIE — KERNEL SENTINELA v18.5
// Intégration analytique pure VSOP2013 & ELP-2000
// ==========================================

class Orbit {
    constructor(data) {
        if (typeof data === 'object' && data !== null) {
            Object.assign(this, data);
        }
        if (!this.r || typeof this.r !== 'object') {
            this.r = { x: 0, y: 0, z: 0, applyMatrix3: function() {} };
        }
        if (!this.v || typeof this.v !== 'object') {
            this.v = { x: 0, y: 0, z: 0, applyMatrix3: function() {} };
        }
    }

    position(jd) {
        return { x: this.r.x || 0, y: this.r.y || 0, z: this.r.z || 0 };
    }

    state(jd) {
        return {
            r: this.r,
            v: this.v,
            _a: this._a !== undefined ? this._a : (this.a || 0),
            L: () => this.L_val || 0,
            k: () => this.k_val || 0,
            h: () => this.h_val || 0,
            q: () => this.q_val || 0,
            p: () => this.p_val || 0
        };
    }

    _a() { return this.a || 0; }
    L() { return this.L_val || 0; }
    k() { return this.k_val || 0; }
    h() { return this.h_val || 0; }
    q() { return this.q_val || 0; }
    p() { return this.p_val || 0; }
}

function CYCLE(x) {
    return x - 6.283185307179586 * Math.floor(0.5 * (x * 0.3183098861837907 + 1));
}

importScripts('vsop2013.js', 'ElpMpp02DE_min.js');

self.postMessage({ type: 'READY', status: 'ANALYTICAL_KERNEL_READY' });

self.onmessage = function(e) {
    const dataMsg = e.data;
    const jd = dataMsg.jd || (dataMsg.data ? dataMsg.data.jd : null);
    const station = dataMsg.station || (dataMsg.data ? { lat: dataMsg.data.lat, lon: dataMsg.data.lon, alt: dataMsg.data.alt } : null);

    if (!jd || !station) return;

    if (dataMsg.type === 'COMPUTE' || dataMsg.type === 'TICK' || dataMsg.command === 'COMPUTE_POSITION') {
        try {
            let results = {};
            const T = (jd - 2451545.0) / 36525.0;

            const earthObj = vsop2013.ear || vsop2013.emb;
            if (!earthObj) {
                throw new Error("Modèle Terre (ear/emb) manquant dans VSOP2013.");
            }
            const earthPos = resoudreObjetAstre(earthObj, jd);
            const ex = getCoord(earthPos, 'x');
            const ey = getCoord(earthPos, 'y');
            const ez = getCoord(earthPos, 'z');

            const planetes = {
                'mercure': vsop2013.mer,
                'venus': vsop2013.ven,
                'mars': vsop2013.mar,
                'jupiter': vsop2013.jup,
                'saturne': vsop2013.sat,
                'uranus': vsop2013.ura,
                'neptune': vsop2013.nep
            };

            // Calcul Soleil (depuis la Terre)
            results['soleil'] = executerCalculTopocentriqueAnalytiqueVectoriel(-ex, -ey, -ez, jd, T, station);

            // Calcul Planètes via boucle corrigée
            for (const [nom, modulePlanete] of Object.entries(planetes)) {
                if (modulePlanete) {
                    const pPos = resoudreObjetAstre(modulePlanete, jd);
                    const px = getCoord(pPos, 'x');
                    const py = getCoord(pPos, 'y');
                    const pz = getCoord(pPos, 'z');
                    results[nom] = executerCalculTopocentriqueAnalytiqueVectoriel(px - ex, py - ey, pz - ez, jd, T, station);
                }
            }

            // Calcul Lune (ELP-2000)
            if (typeof getX2000_DE === 'function') {
                const posLune = getX2000_DE(T);
                const lx = getCoord(posLune, 'x');
                const ly = getCoord(posLune, 'y');
                const lz = getCoord(posLune, 'z');
                results['lune'] = executerCalculTopocentriqueAnalytiqueVectoriel(lx / 149597870.7, ly / 149597870.7, lz / 149597870.7, jd, T, station, true);
            }

            self.postMessage({
                type: 'RESULTS',
                results: results
            });
        } catch (err) {
            self.postMessage({ type: 'ERROR', message: `Erreur analytique critique dans le worker : ${err.toString()}` });
        }
    }
};

function getCoord(p, coordName) {
    if (!p) return 0;
    if (Array.isArray(p)) {
        if (coordName === 'x') return p[0] !== undefined ? p[0] : 0;
        if (coordName === 'y') return p[1] !== undefined ? p[1] : 0;
        if (coordName === 'z') return p[2] !== undefined ? p[2] : 0;
    }
    if (typeof p === 'object') {
        if (p[coordName] !== undefined) return p[coordName];
        if (p.r) {
            if (typeof p.r === 'object' && p.r[coordName] !== undefined) return p.r[coordName];
            if (Array.isArray(p.r)) {
                if (coordName === 'x') return p.r[0] !== undefined ? p.r[0] : 0;
                if (coordName === 'y') return p.r[1] !== undefined ? p.r[1] : 0;
                if (coordName === 'z') return p.r[2] !== undefined ? p.r[2] : 0;
            }
        }
        if (coordName === 'x' && p[0] !== undefined) return p[0];
        if (coordName === 'y' && p[1] !== undefined) return p[1];
        if (coordName === 'z' && p[2] !== undefined) return p[2];
    }
    return 0;
}

function resoudreObjetAstre(planetObj, jd) {
    if (!planetObj) return null;
    try {
        if (typeof planetObj.position === 'function') return planetObj.position(jd);
        if (typeof planetObj.vsop === 'function') return planetObj.vsop(jd);
        if (typeof planetObj.state === 'function') return planetObj.state(jd);
        if (typeof planetObj.orbit === 'function') return planetObj.orbit(jd);
        if (typeof planetObj === 'function') return planetObj(jd);
    } catch (ex) {}
    return planetObj;
}

function executerCalculTopocentriqueAnalytiqueVectoriel(geoX, geoY, geoZ, jd, T, station, isAlreadyKm = false) {
    let x = isAlreadyKm ? geoX : geoX * 149597870.7;
    let y = isAlreadyKm ? geoY : geoY * 149597870.7;
    let z = isAlreadyKm ? geoZ : geoZ * 149597870.7;
    let distanceKm = Math.sqrt(x*x + y*y + z*z);

    const rXY = Math.sqrt(x*x + y*y);
    const declinaisonRad = Math.atan2(z, rXY);
    const ascensionDroiteRad = Math.atan2(y, x);

    let gmstDeg = 280.46061837 + 360.98564736629 * (jd - 2451545.0) + 0.000387933 * T * T - (T * T * T) / 38710000.0;
    gmstDeg = (gmstDeg % 360.0 + 360.0) % 360.0;
    const gmstRad = gmstDeg * Math.PI / 180.0;

    const lstRad = gmstRad + (station.lon * Math.PI / 180.0);
    const angleHoraireRad = lstRad - ascensionDroiteRad;

    const latRad = station.lat * Math.PI / 180.0;

    const sinEl = Math.sin(latRad) * Math.sin(declinaisonRad) + Math.cos(latRad) * Math.cos(declinaisonRad) * Math.cos(angleHoraireRad);
    const elevationRad = Math.asin(Math.max(-1, Math.min(1, sinEl)));

    const yAz = -Math.sin(angleHoraireRad);
    const xAz = Math.tan(declinaisonRad) * Math.cos(latRad) - Math.sin(latRad) * Math.cos(angleHoraireRad);
    let azimutRad = Math.atan2(yAz, xAz);
    if (azimutRad < 0) azimutRad += 2 * Math.PI;

    return {
        azimuth: parseFloat((azimutRad * 180.0 / Math.PI).toFixed(2)),
        elevation: parseFloat((elevationRad * 180.0 / Math.PI).toFixed(2)),
        distance: Math.round(distanceKm)
    };
        }
