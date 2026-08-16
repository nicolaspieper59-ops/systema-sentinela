// ==========================================
// WORKER ASTRONOMIE — KERNEL SENTINELA v18.5
// Version Refactorisée POO + Correctifs Globaux (CYCLE & Orbit)
// ==========================================
"use strict";

// 1. DÉCLARATIONS GLOBALES REQUISES PAR LES DÉPENDANCES
function CYCLE(x) {
    return x - 6.283185307179586 * Math.floor(0.5 * (x * 0.3183098861837907 + 1));
}
self.CYCLE = CYCLE; 

importScripts('vsop2013.js', 'ElpMpp02DE_min.js');

self.postMessage({ type: 'READY', status: 'WASM_READY' });

// ==========================================
// CLASSE : CALCULATEUR TOPOCENTRIQUE
// ==========================================
class TopocentricCalculator {
    constructor(station) {
        const latDeg = station.lat;
        const lonDeg = station.lon;
        const altM = (station.alt || 0) * 1000.0;

        this.phi = latDeg * (Math.PI / 180.0);
        this.lambda = lonDeg * (Math.PI / 180.0);

        const a = 6378137.0;
        const f = 1.0 / 298.257223563;
        const e2 = f * (2.0 - f);

        const N = a / Math.sqrt(1.0 - e2 * Math.sin(this.phi) * Math.sin(this.phi));
        
        this.xObs = (N + altM) * Math.cos(this.phi) * Math.cos(this.lambda);
        this.yObs = (N + altM) * Math.cos(this.phi) * Math.sin(this.lambda);
        this.zObs = (N * (1.0 - e2) + altM) * Math.sin(this.phi);
    }

    computeFromAU(geoVec, magApparente) {
        const AU_IN_METERS = 149597870700.0;
        return this.computeFromMeters(
            geoVec.x * AU_IN_METERS,
            geoVec.y * AU_IN_METERS,
            geoVec.z * AU_IN_METERS,
            magApparente
        );
    }

    computeFromKm(xKm, yKm, zKm, magApparente) {
        return this.computeFromMeters(xKm * 1000.0, yKm * 1000.0, zKm * 1000.0, magApparente);
    }

    computeFromMeters(xECEF, yECEF, zECEF, magApparente) {
        const dx = xECEF - this.xObs;
        const dy = yECEF - this.yObs;
        const dz = zECEF - this.zObs;

        const E = -Math.sin(this.lambda) * dx + Math.cos(this.lambda) * dy;
        const N_top = -Math.sin(this.phi) * Math.cos(this.lambda) * dx - Math.sin(this.phi) * Math.sin(this.lambda) * dy + Math.cos(this.phi) * dz;
        const U = Math.cos(this.phi) * Math.cos(this.lambda) * dx + Math.cos(this.phi) * Math.sin(this.lambda) * dy + Math.sin(this.phi) * dz;

        const distM = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const azim = (Math.atan2(E, N_top) * (180.0 / Math.PI) + 360.0) % 360.0;
        
        const rhoHorizontal = Math.sqrt(E * E + N_top * N_top);
        const elevGeom = Math.atan2(U, rhoHorizontal) * (180.0 / Math.PI);

        let elevRefractee = elevGeom;
        if (elevGeom > -2.0) {
            const refArcMin = 1.02 / Math.tan((elevGeom + 10.3 / (elevGeom + 5.1)) * (Math.PI / 180.0));
            const corMeteo = (1013.25 / 1013.25) * (288.15 / (273.15 + 15.0));
            elevRefractee = elevGeom + (refArcMin * corMeteo) / 60.0;
        }

        return {
            azimuth: parseFloat(azim.toFixed(2)),
            elevation: parseFloat(elevRefractee.toFixed(2)),
            distance: Math.round(distM / 1000.0),
            visibiliteCode: elevRefractee > 0 ? 1 : 0
        };
    }
}

// ==========================================
// CLASSE : ORBIT (Ex-AstronomicalEngine)
// ==========================================
class Orbit {
    constructor(jd, station) {
        this.jd = jd;
        this.jy2k = (jd - 2451545.0) / 365250.0;
        this.calculator = new TopocentricCalculator(station);
        this.earthPos = this._computeEarthPosition();
    }

    _computeEarthPosition() {
        if (typeof vsop2013 === 'undefined') return { x: 0, y: 0, z: 0 };
        
        if (typeof vsop2013.ear === 'function') {
            const res = vsop2013.ear(this.jy2k);
            return { x: res[0], y: res[1], z: res[2] };
        } else if (vsop2013.ear && typeof vsop2013.ear.position === 'function') {
            const res = vsop2013.ear.position(this.jd);
            return { x: res.x, y: res.y, z: res.z };
        }
        return { x: 0, y: 0, z: 0 };
    }

    computeSun() {
        const geoVec = { x: -this.earthPos.x, y: -this.earthPos.y, z: -this.earthPos.z };
        return this.calculator.computeFromAU(geoVec, -26.74);
    }

    computePlanet(planetModule, mag) {
        if (!planetModule) return this._nullResult();

        let pPos = null;
        if (typeof planetModule === 'function') {
            const arr = planetModule(this.jy2k);
            pPos = { x: arr[0], y: arr[1], z: arr[2] };
        } else if (typeof planetModule.position === 'function') {
            pPos = planetModule.position(this.jd);
        }

        if (!pPos) return this._nullResult();

        const geoVec = {
            x: pPos.x - this.earthPos.x,
            y: pPos.y - this.earthPos.y,
            z: pPos.z - this.earthPos.z
        };
        return this.calculator.computeFromAU(geoVec, mag);
    }

    computeMoon() {
        if (typeof getX2000_DE !== 'function') return this._nullResult();

        const T_siecles = (this.jd - 2451545.0) / 36525.0;
        const luneState = getX2000_DE(T_siecles);
        
        if (!luneState) return this._nullResult();

        const lx = Number(luneState.x !== undefined ? luneState.x : luneState[0]);
        const ly = Number(luneState.y !== undefined ? luneState.y : luneState[1]);
        const lz = Number(luneState.z !== undefined ? luneState.z : luneState[2]);
        
        if (isNaN(lx) || isNaN(ly) || isNaN(lz)) return this._nullResult();

        return this.calculator.computeFromKm(lx, ly, lz, -12.7);
    }

    _nullResult() {
        return { azimuth: 0, elevation: -99, distance: 0, visibiliteCode: 0 };
    }

    runEphemeris() {
        const planetConfig = {
            mercure: { mod: vsop2013?.mer, mag: -0.42 },
            venus:   { mod: vsop2013?.ven, mag: -4.40 },
            mars:    { mod: vsop2013?.mar, mag: -1.52 },
            jupiter: { mod: vsop2013?.jup, mag: -2.70 },
            saturne: { mod: vsop2013?.sat, mag: 0.20 },
            uranus:  { mod: vsop2013?.ura, mag: 5.50 },
            neptune: { mod: vsop2013?.nep, mag: 7.80 }
        };

        const results = {
            soleil: this.computeSun(),
            lune: this.computeMoon()
        };

        for (const [name, config] of Object.entries(planetConfig)) {
            results[name] = this.computePlanet(config.mod, config.mag);
        }

        return results;
    }
}
// 2. EXPOSITION GLOBALE DE LA CLASSE (Pour les scripts externes)
self.Orbit = Orbit;

// ==========================================
// ÉCOUTEUR PRINCIPAL DU WORKER
// ==========================================
self.onmessage = function(e) {
    const { jd, station } = e.data;

    if (!jd || !station) return;

    try {
        // Instanciation via la classe attendue
        const engine = new Orbit(jd, station);
        const results = engine.runEphemeris();

        self.postMessage({ type: 'RESULTS', results: results });

    } catch (err) {
        self.postMessage({ type: 'ERROR', message: `Erreur calcul worker : ${err.toString()}` });
    }
};
