importScripts('wasm_astronomie.js');

let wasmReady = false;

if (typeof Module !== 'undefined') {
    Module.onRuntimeInitialized = function() {
        wasmReady = true;
        postMessage({ type: 'WASM_READY', status: 'ok' });
    };
} else {
    self.Module = {
        onRuntimeInitialized: function() {
            wasmReady = true;
            postMessage({ type: 'WASM_READY', status: 'ok' });
        }
    };
}

onmessage = function(e) {
    const data = e.data;
    if (!data || !data.type) return;

    if (data.type === 'INIT_WMM') {
        postMessage({ type: 'LOG', message: 'Modèle WMM initialisé dans le Worker.' });
        return;
    }

    if (data.type === 'COMPUTE') {
        if (!wasmReady) {
            postMessage({ type: 'ERROR', message: 'Le module WebAssembly n est pas prêt.' });
            return;
        }

        try {
            const jde = data.jde;
            const ephemeridesFlux = data.ephemeridesFlux;
            let bodiesResults = {};

            for (const [nomAstre, astreData] of Object.entries(ephemeridesFlux)) {
                let elevationGeometrique = astreData.elevationGeometrique || 0.0;
                let az = astreData.azimuth || 0.0;
                let distanceAu = astreData.distanceAu || 1.0;
                let magnitude = astreData.magnitude || 0.0;
                let raDeg = astreData.raDeg || 0.0;
                let decDeg = astreData.decDeg || 0.0;
                let orbitVelocity = astreData.orbitVelocity || "0.00 km/s";
                let airMass = astreData.airMass || 1.0;

                // Calcul direct ou via les fonctions exportées Wasm du GMST/GHA
                let gmst = (280.46061837 + 360.98564736629 * (jde - 2451545.0)) % 360;
                if (gmst < 0) gmst += 360;
                let gha = (gmst - raDeg) % 360;
                if (gha < 0) gha += 360;

                bodiesResults[nomAstre] = {
                    elevationGeometrique: elevationGeometrique,
                    azimuth: az,
                    distanceAu: distanceAu,
                    minMaxAu: astreData.minMaxAu || "0.98 - 1.02 UA",
                    magnitude: magnitude,
                    raDeg: raDeg,
                    decDeg: decDeg,
                    constellationDisplay: astreData.constellation || "ORI",
                    orbitPeriod: astreData.orbitPeriod || "365.25 j",
                    lengthOfDay: astreData.lengthOfDay || "24h 00m",
                    orbitVelocity: orbitVelocity,
                    shadowLength: 0.0,
                    shadowLengthDisplay: "Normal",
                    sunrise: "06:30",
                    sunset: "18:45",
                    jde: jde,
                    deltat: astreData.deltat || 69.0,
                    gha: gha,
                    airMass: airMass,
                    irradiance: 1361.0 / (airMass > 0 ? airMass : 1),
                    visibiliteCode: elevationGeometrique > 0 ? 1 : 0
                };
            }

            postMessage({
                type: 'COMPUTE_RESULT',
                bodiesResults: bodiesResults
            });

        } catch (error) {
            postMessage({ type: 'ERROR', message: 'Erreur d execution dans le Worker : ' + error.toString() });
        }
    }
};
