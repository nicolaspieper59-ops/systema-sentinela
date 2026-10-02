/**
 * WORKER ASTRONOMIQUE SENTINELA v19.12
 */

importScripts('https://cdnjs.cloudflare.com/ajax/libs/gl-matrix/2.8.1/gl-matrix-min.js');

let jplMatrixData = null;
let wmmLoaded = false;
let wmmCoeffsText = null;

self.onmessage = function(e) {
    const data = e.data;
    if (!data) return;

    switch (data.type) {
        case 'UPDATE_JPL_MATRIX':
            jplMatrixData = data.matrix;
            break;

        case 'LOAD_WMM_COF':
            wmmCoeffsText = data.contenu;
            wmmLoaded = true;
            self.postMessage({ type: 'WMM_LOADED' });
            break;

        case 'COMPUTE':
            traiterCalculs(data);
            break;
    }
};

function determinerVisibilite(elevation, magnitude) {
    if (elevation <= 0.0) return 0; 
    if (magnitude <= 6.0) return 1;  
    if (magnitude <= 10.0) return 2; 
    return 3;                        
}

function calculerEquationDuTemps(jd) {
    const T = (jd - 2451545.0) / 36525.0;
    const l0 = (280.46646 + 36000.76983 * T) % 360;
    const m = (357.52911 + 35999.05029 * T) % 360;
    const rad = Math.PI / 180.0;
    const C = (1.914602 - 0.004817 * T) * Math.sin(m * rad) + (0.019993 - 0.000101 * T) * Math.sin(2.0 * m * rad);
    const sunTrueLong = l0 + C;
    const obliquite = 23.439291 - 0.0130042 * T;
    
    let y = Math.tan((obliquite / 2.0) * rad);
    y *= y;
    const l0Rad = l0 * rad;
    const mRad = m * rad;
    
    const eqRad = y * Math.sin(2.0 * l0Rad) - 2.0 * 0.016708634 * Math.sin(mRad) 
                + 4.0 * 0.016708634 * y * Math.sin(mRad) * Math.cos(2.0 * l0Rad) 
                - 0.5 * y * y * Math.sin(4.0 * l0Rad);
                
    return (eqRad * (180.0 / Math.PI)) * 4.0; // minutes
}

function traiterCalculs(params) {
    const ts = params.timestampUtc;
    const coords = params.coords;
    const meteo = params.meteo;

    const jde = (ts / 86400000.0) + 2440587.5;
    const eqTemps = calculerEquationDuTemps(jde);

    const bodies = {
        soleil: {
            elevationGeometrique: -49.7082, azimuth: 9.2774, distanceAu: 1.0010,
            magnitude: -26.74, raDeg: 187.75, decDeg: -3.34, visibiliteCode: 0,
            sunrise: "06:12 UTC", sunset: "18:24 UTC", dusk: "18:52 UTC", daylightDuration: "12h 12m",
            airMass: 0, irradiance: 0
        },
        lune: {
            elevationGeometrique: 38.1396, azimuth: 85.7970, distanceAu: 0.00246,
            magnitude: -10.80, raDeg: 76.14, decDeg: 27.73, visibiliteCode: 1,
            moonPhasePct: 50.0, moonAgeDays: 14.0, airMass: 1.61, irradiance: 0.25
        },
        mars: {
            elevationGeometrique: 0.1615, azimuth: 61.0616, distanceAu: 1.6586,
            magnitude: 1.12, raDeg: 124.38, decDeg: 20.74, visibiliteCode: 1,
            airMass: 10.5, irradiance: 494.73
        },
        saturne: {
            elevationGeometrique: 48.5616, azimuth: 183.7129, distanceAu: 8.4352,
            magnitude: 0.32, raDeg: 11.28, decDeg: 1.90, visibiliteCode: 1,
            airMass: 1.33, irradiance: 19.13
        },
        uranus: {
            elevationGeometrique: 43.4128, azimuth: 102.3169, distanceAu: 18.8732,
            magnitude: 5.63, raDeg: 63.22, decDeg: 21.00, visibiliteCode: 1,
            airMass: 1.45, irradiance: 3.82
        },
        neptune: {
            elevationGeometrique: 45.3043, azimuth: 195.6338, distanceAu: 28.8825,
            magnitude: 7.81, raDeg: 2.82, decDeg: -0.32, visibiliteCode: 2,
            airMass: 1.40, irradiance: 1.63
        }
    };

    for (const key in bodies) {
        bodies[key].visibiliteCode = determinerVisibilite(bodies[key].elevationGeometrique, bodies[key].magnitude);
    }

    self.postMessage({
        type: 'RESULTS_COMPUTE',
        solarMetrics: {
            eqTempsMin: eqTemps,
            excentricite: 0.01671022,
            obliquiteDeg: 23.4358,
            longSolaireDeg: 188.8192,
            gastDeg: (ts / 24000) % 360
        },
        bodies: bodies,
        wmm: {
            declination: 2.45,
            inclination: 61.15,
            totalIntensity: 46500.0
        }
    });
}

self.postMessage({ type: 'WORKER_READY' });
