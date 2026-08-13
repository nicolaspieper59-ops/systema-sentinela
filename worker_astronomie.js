// Dans worker_astronomie.js
importScripts('astro_engine.js');

let astroWasmInstance = null;

// Initialisation asynchrone du module Wasm
AstroEngineModule().then(Module => {
    astroWasmInstance = Module;
    
    // Liaison d'une fonction C++ (exemple : calculer_position)
    // C++ : double calculer_azimuth(double julianDay, double lat, double lon)
    self.calculerAzimuth = Module.cwrap('calculer_azimuth', 'number', ['number', 'number', 'number']);
    
    console.log("[Worker] Moteur C++/Wasm chargé avec succès.");
    self.postMessage({ status: 'WASM_READY' });
});

self.onmessage = function(e) {
    if (!astroWasmInstance) return;
    
    const { command, data } = e.data;
    if (command === 'COMPUTE_POSITION') {
        const az = self.calculerAzimuth(data.jd, data.lat, data.lon);
        self.postMessage({ command: 'POSITION_RESULT', result: { azimuth: az } });
    }
};
